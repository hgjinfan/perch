import { rememberLayout } from './pwa/layout-cache.js';
import { synchronizePage } from './home/page-sync.js';
import { setupConfigUpdates } from './home/config-updates.js';
import { setupTileLayout } from './home/tile-layout.js';
import { setupPwa } from './pwa/client.js';
import { applyPreferences, toggleTheme } from './core/preferences.js';
import { createScheduler } from './core/scheduler.js';
import { mountModules } from './home/board.js';
import { createLoaders } from './home/loaders.js';
import { updateFreshness } from './home/freshness.js';

let scheduler,
  loaders,
  stopLayout,
  generation = 0,
  busy = false;
const configUpdates = setupConfigUpdates({
  onConfig: (version) => synchronizePage(version, { mount: mountBoard }),
});
function mountBoard() {
  generation++;
  for (const load of loaders?.values() || []) load.dispose?.();
  stopLayout?.();
  scheduler = createScheduler();
  const board = mountModules(document.querySelector('#board'));
  loaders = createLoaders(board);
  stopLayout = setupTileLayout(document.querySelector('#board'));
  for (const [id, load] of loaders) {
    const interval = Number(board.modules.get(id).node.dataset.refresh);
    scheduler.register(id, load, Math.max(30000, interval || 60000));
  }
  busy = false;
  updateDate();
  updateFreshness();
  refresh(true);
  rememberLayout();
}
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
  const current = generation;
  try {
    if ((await scheduler.refresh(force)) && current === generation)
      document.querySelector('#updated').textContent =
        `上次检查 ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
  } finally {
    if (current === generation) busy = false;
  }
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
updateDate();
setupPwa({
  reconnect: () => {
    configUpdates.check(true);
    refresh(true);
  },
});
mountBoard();
setInterval(resume, 5000);
setInterval(updateFreshness, 30000);
document.addEventListener('visibilitychange', () => resume(true));
window.addEventListener('focus', () => resume(true));
