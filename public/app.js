import { setupConfigUpdates } from './home/config-updates.js';
import { setupTileLayout } from './home/tile-layout.js';
import { setupPwa } from './pwa/client.js';
import { icons } from './core/dom.js';
import { applyPreferences, toggleTheme } from './core/preferences.js';
import { createScheduler } from './core/scheduler.js';
import { mountModules } from './home/board.js';
import { createLoaders } from './home/loaders.js';

const scheduler = createScheduler();
const configUpdates = setupConfigUpdates();
const board = mountModules(document.querySelector('#board'));
const loaders = createLoaders(board);
setupTileLayout(document.querySelector('#board'));
let busy = false;
function updateDate() {
  const date = document.querySelector('#date');
  date.textContent = new Intl.DateTimeFormat('zh-CN', {
    timeZone: date.dataset.timezone || 'Asia/Shanghai',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(new Date());
}
async function refresh(force = false) {
  if (busy) return;
  busy = true;
  try {
    if (await scheduler.refresh(force))
      document.querySelector('#updated').textContent =
        `上次检查 ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
  } finally {
    busy = false;
  }
}
for (const [id, load] of loaders) {
  const interval = Number(board.modules.get(id).node.dataset.refresh);
  scheduler.register(id, load, Math.max(30000, interval || 60000));
}
function resume(force = false) {
  updateDate();
  if (!document.hidden && navigator.onLine) {
    configUpdates.check(force);
    refresh();
  }
}
document.querySelector('#theme').onclick = toggleTheme;
applyPreferences();
icons();
updateDate();
setupPwa({
  reconnect: () => {
    configUpdates.check(true);
    refresh(true);
  },
});
refresh(true);
configUpdates.check();
setInterval(resume, 5000);
document.addEventListener('visibilitychange', () => resume(true));
window.addEventListener('focus', () => resume(true));
