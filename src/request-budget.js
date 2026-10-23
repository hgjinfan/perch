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
  perKeyConcurrency = concurrency,
  maxQueue = 12,
  waitMs = 2000,
  cooldownMs = 30000,
  now = Date.now,
} = {}) {
  let active = 0,
    backgroundActive = 0;
  const queue = [],
    failures = new Map(),
    activeKeys = new Map();
  const counts = { completed: 0, failed: 0, rejected: 0, cancelled: 0 };
  const blocked = (key) => (failures.get(key)?.until || 0) > now();
  function unavailable() {
    const error = new HttpError(503, '数据服务繁忙，请稍后重试');
    error.retryAfter = 2;
    return error;
  }
  function eligible(job) {
    return (
      active < concurrency &&
      (activeKeys.get(job.key) || 0) < perKeyConcurrency &&
      (!job.background || backgroundActive < Math.max(1, concurrency - 1))
    );
  }
  function cleanup(job) {
    clearTimeout(job.timer);
    job.signal?.removeEventListener('abort', job.abort);
  }
  function drain() {
    while (active < concurrency) {
      let index = queue.findIndex((job) => !job.background && eligible(job));
      if (index < 0) index = queue.findIndex(eligible);
      if (index < 0) break;
      start(queue.splice(index, 1)[0]);
    }
  }
  async function start(job) {
    cleanup(job);
    active++;
    if (job.background) backgroundActive++;
    activeKeys.set(job.key, (activeKeys.get(job.key) || 0) + 1);
    const previousFailure = failures.get(job.key);
    try {
      job.signal?.throwIfAborted();
      if (blocked(job.key)) throw unavailable();
      const result = await job.task();
      if (failures.get(job.key) === previousFailure) failures.delete(job.key);
      counts.completed++;
      job.resolve(result);
    } catch (error) {
      counts.failed++;
      if (error.status !== 503 && !job.signal?.aborted) {
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
      if (job.background) backgroundActive--;
      const remaining = activeKeys.get(job.key) - 1;
      if (remaining) activeKeys.set(job.key, remaining);
      else activeKeys.delete(job.key);
      drain();
    }
  }
  return {
    snapshot() {
      return {
        active,
        queued: queue.length,
        backgroundActive,
        cooling: [...failures.values()].filter((item) => item.until > now()).length,
        concurrency,
        perOrigin: perKeyConcurrency,
        maxQueue,
        ...counts,
      };
    },
    run(key, task, { signal, background = false } = {}) {
      if (signal?.aborted) return Promise.reject(signal.reason);
      if (blocked(key)) {
        counts.rejected++;
        return Promise.reject(unavailable());
      }
      return new Promise((resolve, reject) => {
        const job = { key, task, resolve, reject, signal, background };
        if (eligible(job) && !queue.some((item) => !item.background && eligible(item))) {
          start(job);
          return;
        }
        if (queue.length >= maxQueue) {
          counts.rejected++;
          reject(unavailable());
          return;
        }
        function remove(error, cancelled = false) {
          const index = queue.indexOf(job);
          if (index < 0) return;
          queue.splice(index, 1);
          cleanup(job);
          counts[cancelled ? 'cancelled' : 'rejected']++;
          reject(error);
          drain();
        }
        job.abort = () => remove(signal.reason, true);
        job.timer = setTimeout(() => remove(unavailable()), waitMs);
        queue.push(job);
        signal?.addEventListener('abort', job.abort, { once: true });
        if (signal?.aborted) job.abort();
      });
    },
  };
}

// One instance per application. No URLs, credentials or body values in snapshots.
export function createBudgetedFetcher(fetcher, { env = process.env } = {}) {
  const concurrency = boundedInteger(env.UPSTREAM_CONCURRENCY, 8, 1, 32);
  const budget = createUpstreamBudget({
    concurrency,
    perKeyConcurrency: Math.min(concurrency, boundedInteger(env.UPSTREAM_PER_ORIGIN, 2, 1, 32)),
    maxQueue: boundedInteger(env.UPSTREAM_MAX_QUEUE, 24, 0, 128),
    waitMs: boundedInteger(env.UPSTREAM_QUEUE_WAIT_MS, 2000, 10, 10000),
  });
  const timeout = boundedInteger(env.UPSTREAM_TIMEOUT_MS, 8000, 100, 30000);
  const read = async (url, options = {}, background = false) => {
    const { headersOnly = false, ...init } = options;
    const deadline = AbortSignal.timeout(timeout);
    const signal = init.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
    try {
      return await budget.run(
        new URL(url).origin,
        async () => {
          signal.throwIfAborted();
          const response = await fetcher(url, { ...init, signal });
          if (!response.ok || headersOnly) {
            await response.body?.cancel();
            if ([429, 503].includes(response.status)) {
              const error = new Error(`HTTP ${response.status}`);
              error.response = response;
              throw error;
            }
            return response;
          }
          const chunks = [];
          let bytes = 0;
          for await (const chunk of response.body || []) {
            signal.throwIfAborted();
            bytes += chunk.length;
            if (bytes > 1024 * 1024) throw new Error('Response too large');
            chunks.push(chunk);
          }
          signal.throwIfAborted();
          return new Response(response.body === null ? null : new Blob(chunks), {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          });
        },
        { signal, background },
      );
    } catch (error) {
      if (error.response) return error.response;
      throw error;
    }
  };
  const result = (url, options) => read(url, options);
  result.background = (url, options) => read(url, options, true);
  result.snapshot = () => budget.snapshot();
  return result;
}
