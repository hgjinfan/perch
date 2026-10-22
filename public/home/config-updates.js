import { CONFIG_CHANNEL } from '../core/config-events.js';
export function createConfigWatcher({
  baseline,
  onChange,
  fetcher = fetch,
  now = Date.now,
  active = () => !document.hidden && navigator.onLine,
  interval = 30000,
}) {
  let checkedAt = -Infinity,
    flight,
    changed = false;
  function check(force = false) {
    if (!baseline || changed || !active()) return Promise.resolve(false);
    if (flight) return flight;
    if (now() - checkedAt < (force ? 2000 : interval)) return Promise.resolve(false);
    checkedAt = now();
    flight = Promise.resolve()
      .then(async () => {
        try {
          const response = await fetcher('/page-version', {
            method: 'HEAD',
            cache: 'no-store',
            credentials: 'omit',
            headers: { 'If-None-Match': `"${baseline}"` },
            signal: AbortSignal.timeout(5000),
          });
          if (response.status === 304 || !response.ok || !active()) return false;
          const tag = response.headers.get('etag');
          if (!/^"[a-f0-9]{20}-[a-f0-9]{32}"$/.test(tag || '') || tag === `"${baseline}"`)
            return false;
          changed = true;
          onChange({ reason: tag.slice(1, 21) === baseline.slice(0, 20) ? 'config' : 'page' });
          return true;
        } catch {
          return false;
        }
      })
      .finally(() => {
        flight = null;
      });
    return flight;
  }
  return { check };
}
export function setupConfigUpdates() {
  const notice = document.querySelector('#config-update');
  const watcher = createConfigWatcher({
    baseline: document.documentElement.dataset.pageVersion,
    onChange: ({ reason }) => {
      if (notice) {
        notice.querySelector('span').textContent =
          reason === 'page' ? '首页已有新版本' : '首页配置已更新';
        notice.hidden = false;
      }
    },
  });
  const button = document.querySelector('#refresh-config');
  if (button) button.onclick = () => location.reload();
  try {
    if (globalThis.BroadcastChannel) {
      const channel = new BroadcastChannel(CONFIG_CHANNEL);
      channel.onmessage = (event) => {
        if (event.data?.type === 'changed') watcher.check(true);
      };
    }
  } catch {
    /* Cross-tab updates are optional. */
  }
  return watcher;
}
