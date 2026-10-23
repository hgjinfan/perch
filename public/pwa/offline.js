import { appPath } from '../core/base-path.js';
import { applyPreferences } from '../core/preferences.js';
applyPreferences();
window.addEventListener('online', () => location.replace(appPath('/')));
if (navigator.onLine) {
  fetch(appPath('/healthz'), { cache: 'no-store' })
    .then((response) => {
      if (response.ok) location.replace(appPath('/'));
    })
    .catch(() => {});
}
