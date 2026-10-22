import { HttpError } from './http.js';

export function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}
export function createRequestLimiter({
  limit = 60,
  windowMs = 60000,
  maxEntries = 4096,
  now = Date.now,
} = {}) {
  const clients = new Map();
  return (key) => {
    const time = now();
    let entry = clients.get(key);
    if (!entry || entry.until <= time) {
      entry = { count: 0, until: time + windowMs };
      clients.set(key, entry);
    }
    if (entry.count >= limit) {
      const error = new HttpError(429, '请求较频繁，请稍后再试');
      error.retryAfter = Math.max(1, Math.ceil((entry.until - time) / 1000));
      throw error;
    }
    entry.count++;
    if (clients.size > maxEntries) {
      for (const [id, item] of clients) if (item.until <= time) clients.delete(id);
      while (clients.size > maxEntries) clients.delete(clients.keys().next().value);
    }
  };
}

export function createUpstreamBudget({
  concurrency = 4,
  maxQueue = 12,
  waitMs = 2000,
  cooldownMs = 30000,
  now = Date.now,
} = {}) {
  let active = 0;
  const queue = [],
    failures = new Map();
  function blocked(key) {
    return (failures.get(key)?.until || 0) > now();
  }
  function unavailable() {
    const error = new HttpError(503, '数据服务繁忙，请稍后重试');
    error.retryAfter = 2;
    return error;
  }
  function drain() {
    while (active < concurrency && queue.length) start(queue.shift());
  }
  async function start(job) {
    clearTimeout(job.timer);
    active++;
    try {
      if (blocked(job.key)) throw unavailable();
      const result = await job.task();
      failures.delete(job.key);
      job.resolve(result);
    } catch (error) {
      if (error.status !== 503) {
        const count = (failures.get(job.key)?.count || 0) + 1;
        if (!failures.has(job.key) && failures.size >= 512)
          failures.delete(failures.keys().next().value);
        failures.set(job.key, {
          count,
          until: /^HTTP (429|503)/.test(error.message) || count >= 3 ? now() + cooldownMs : 0,
        });
      }
      job.reject(error);
    } finally {
      active--;
      drain();
    }
  }
  return {
    run(key, task) {
      if (blocked(key)) return Promise.reject(unavailable());
      return new Promise((resolve, reject) => {
        const job = { key, task, resolve, reject };
        if (active < concurrency) {
          start(job);
          return;
        }
        if (queue.length >= maxQueue) {
          reject(unavailable());
          return;
        }
        job.timer = setTimeout(() => {
          const index = queue.indexOf(job);
          if (index >= 0) {
            queue.splice(index, 1);
            reject(unavailable());
          }
        }, waitMs);
        queue.push(job);
      });
    },
  };
}

// One instance per application, shared by public data and administrator previews.
export function createBudgetedFetcher(fetcher, { env = process.env } = {}) {
  const budget = createUpstreamBudget({
    concurrency: boundedInteger(env.UPSTREAM_CONCURRENCY, 8, 1, 32),
    maxQueue: boundedInteger(env.UPSTREAM_MAX_QUEUE, 24, 0, 128),
    waitMs: boundedInteger(env.UPSTREAM_QUEUE_WAIT_MS, 2000, 10, 10000),
  });
  const timeout = boundedInteger(env.UPSTREAM_TIMEOUT_MS, 8000, 100, 30000);
  return (url, options = {}) => {
    const deadline = AbortSignal.timeout(timeout);
    const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
    return budget.run(new URL(url).origin, async () => {
      signal.throwIfAborted();
      const response = await fetcher(url, { ...options, signal });
      if (!response.ok) {
        await response.body?.cancel();
        if ([429, 503].includes(response.status)) throw new Error(`HTTP ${response.status}`);
        return response;
      }
      // Keep the permit until the body finishes, not merely until headers arrive.
      const chunks = [];
      let bytes = 0;
      for await (const chunk of response.body || []) {
        signal.throwIfAborted();
        bytes += chunk.length;
        if (bytes > 1024 * 1024) throw new Error('Response too large');
        chunks.push(Buffer.from(chunk));
      }
      signal.throwIfAborted();
      return new Response(response.body === null ? null : Buffer.concat(chunks), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    });
  };
}
