import { appPath } from '../core/base-path.js';
import { pageDocumentUrl } from './page-sync.js';
import { CONFIG_CHANNEL } from '../core/config-events.js';
export function createConfigWatcher({
  baseline,
  onChange,
  fetcher = fetch,
  now = Date.now,
  active = () => !document.hidden && navigator.onLine,
  interval = 30000,
  deferInitial = false,
}) {
  let checkedAt = deferInitial ? now() : -Infinity,
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
          const response = await fetcher(appPath('/page-version'), {
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
          const next = tag.slice(1, -1);
          const outcome = await onChange({
            reason: tag.slice(1, 21) === baseline.slice(0, 20) ? 'config' : 'page',
            version: next,
          });
          if (outcome === 'synced') {
            baseline = next;
            changed = false;
          } else if (outcome === false) changed = false;
          return true;
        } catch {
          changed = false;
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
export function setupConfigUpdates({ onConfig } = {}) {
  let latest;
  const notice = document.querySelector('#config-update');
  const watcher = createConfigWatcher({
    baseline: document.documentElement.dataset.pageVersion,
    interval: 10000,
    deferInitial: true,
    onChange: async ({ reason, version }) => {
      latest = version;
      if (reason === 'config' && onConfig) {
        try {
          if (await onConfig(version)) {
            if (notice) notice.hidden = true;
            return 'synced';
          }
        } catch {}
      }
      if (notice) {
        notice.querySelector('span').textContent =
          reason === 'page' ? '首页已有新版本' : '首页配置已更新';
        notice.hidden = false;
      }
      return false;
    },
  });
  const button = document.querySelector('#refresh-config');
  if (button)
    button.onclick = () =>
      location.assign(latest ? pageDocumentUrl(latest) : appPath('/page/latest'));
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
