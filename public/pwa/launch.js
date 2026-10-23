import { restoreLayout } from './layout-cache.js';
import { launchHomepage } from './startup.js';
const message = document.querySelector('#launch-message'),
  retry = document.querySelector('#launch-retry'),
  actions = document.querySelector('#launch-actions');
const stopLayout = restoreLayout();
let busy = false,
  completed = false;
async function start() {
  if (busy || completed) return;
  busy = true;
  retry.hidden = true;
  actions.hidden = true;
  message.textContent = '正在加载…';
  try {
    await launchHomepage();
    completed = true;
    stopLayout?.();
    window.removeEventListener('online', start);
  } catch {
    message.textContent = navigator.onLine
      ? '连接较慢或暂时不可用，请重试。'
      : '当前离线，联网后将自动打开首页。';
    retry.hidden = false;
    actions.hidden = false;
  } finally {
    busy = false;
  }
}
retry.onclick = start;
window.addEventListener('online', start);
start();
