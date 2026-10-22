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
    return new HttpError(503, '数据服务繁忙，请稍后重试');
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
