import { appPath } from '../core/base-path.js';
import { parseFragment, applyFragment } from './fragment-content.js';
import { bindWeatherHours, restoreWeatherHour } from './weather-hours.js';
import { requestHtml } from '../core/api.js';
import { bindWeatherPicker, weatherFragmentUrl } from './weather.js';
import { updateFreshness } from './freshness.js';

export function createLoaders({ modules, serviceTiles }) {
  const loaders = new Map();
  for (const [id, module] of modules) {
    if (!module.node.dataset.fragment) continue;
    let sequence = 0,
      controller;
    const dispose = () => {
      sequence++;
      controller?.abort();
    };
    async function load() {
      if (module.node.closest('details.board-group:not([open])')) return;
      if (module.node.hidden || !module.node.isConnected || !module.node.dataset.fragment) return;
      if (module.node.dataset.initialHydrated === 'true') {
        delete module.node.dataset.initialHydrated;
        return;
      }
      controller?.abort();
      controller = new AbortController();
      const current = ++sequence;
      module.loading.start();
      try {
        const base = module.node.dataset.fragment;
        const markup = await requestHtml(id === 'weather' ? weatherFragmentUrl(base) : base, {
          signal: controller.signal,
        });
        if (current !== sequence || !module.node.isConnected) return;
        const fragment = parseFragment(markup);
        const focusedKey =
          id === 'weather' && module.content.contains(document.activeElement)
            ? document.activeElement.closest('[data-weather-hour]')?.dataset.weatherHour
            : null;
        applyFragment(module, fragment, serviceTiles);
        if (id === 'weather') restoreWeatherHour(module, focusedKey);
        module.loading.settle();
      } catch (error) {
        if (current !== sequence || !module.node.isConnected) return;
        if (error.reload) {
          window.dispatchEvent(new Event('homepage:update-required'));
          module.loading.fail('页面已有新版本', '请点击更新页面。', () =>
            location.assign(appPath('/page/latest')),
          );
          return;
        }
        if (error.status === 404) {
          if (id === 'status') {
            module.node.removeAttribute('data-fragment');
            for (const slot of module.node.querySelectorAll('[data-service-state-slot]')) {
              if (slot.dataset.state === 'unconfigured')
                slot.replaceWith(slot.querySelector('.service-health'));
              else slot.remove();
            }
            for (const tile of serviceTiles.values()) {
              tile.removeAttribute('title');
              tile.removeAttribute('aria-describedby');
            }
          } else {
            module.node.hidden = true;
            module.node.dataset.moduleUnavailable = 'true';
          }
          module.loading.settle();
          return;
        }
        if (id === 'status')
          for (const slot of module.node.querySelectorAll('[data-service-state-slot]')) {
            if (slot.dataset.state === 'pending')
              slot.querySelector('.service-health').textContent = '状态暂不可用';
            slot.classList.add('service-stale');
            const tile = slot.closest('[data-service]');
            if (tile) {
              tile.title = slot.title + '（更新失败）';
              slot.querySelector('.service-detail').textContent = tile.title;
            }
          }
        const freshness =
          id === 'status'
            ? document.querySelector('#service-freshness')
            : module.content.querySelector('[data-freshness]');
        if (freshness && !freshness.hidden) {
          freshness.classList.add('stale');
          updateFreshness(freshness.parentNode);
        }
        module.loading.fail(
          '暂时无法更新',
          '请稍后重试。',
          load,
          id === 'status' ? '服务状态暂时无法更新' : '更新失败，保留上次内容',
        );
      }
    }
    // Delegation survives content replacement and handles server-rendered retry controls.
    module.node.addEventListener('click', (event) => {
      const retry = event.target.closest('[data-retry]');
      if (retry) {
        event.preventDefault();
        load();
      }
    });
    if (id === 'weather') {
      bindWeatherPicker(module, load);
      bindWeatherHours(module);
    }
    load.dispose = dispose;
    loaders.set(id, load);
  }
  return loaders;
}
