import { applyPreferences } from '../core/preferences.js';
applyPreferences();
window.addEventListener('online', () => location.replace('/'));
if (navigator.onLine) {
  fetch('/healthz', { cache: 'no-store' })
    .then((response) => {
      if (response.ok) location.replace('/');
    })
    .catch(() => {});
}
