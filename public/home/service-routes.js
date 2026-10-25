import { safeUrl } from '../../shared/url.js';
export function setupServiceRoutes(root, storage) {
  const control = root.querySelector('[data-service-route]');
  if (!control) return;
  const key =
    'perch-service-route-v1:' + (root.ownerDocument.documentElement.dataset.basePath || '');
  let mode = 'external';
  try {
    storage ||= globalThis.localStorage;
    if (storage?.getItem(key) === 'internal') mode = 'internal';
  } catch {}
  const apply = () => {
    control.value = mode;
    for (const tile of root.querySelectorAll('a[data-service]')) {
      const primary = mode === 'internal' ? tile.dataset.internalUrl : tile.dataset.externalUrl;
      const fallback = mode === 'internal' ? tile.dataset.externalUrl : tile.dataset.internalUrl;
      const url = safeUrl(primary) || safeUrl(fallback);
      if (url) tile.href = url;
    }
  };
  control.onchange = () => {
    mode = control.value === 'internal' ? 'internal' : 'external';
    apply();
    try {
      storage?.setItem(key, mode);
    } catch {}
  };
  apply();
  return () => (control.onchange = null);
}
