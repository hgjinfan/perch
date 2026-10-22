import { bindWeatherHours, restoreWeatherHour } from './weather-hours.js';
import { requestHtml } from '../core/api.js';
import { icons } from '../core/dom.js';
import { bindWeatherPicker, weatherFragmentUrl } from './weather.js';

export function createLoaders({ modules, serviceTiles }) {
  const loaders = new Map();
  for (const [id, module] of modules) {
    if (!module.node.dataset.fragment) continue;
    let sequence = 0;
    async function load() {
      if (module.node.hidden || !module.node.isConnected || !module.node.dataset.fragment) return;
      const current = ++sequence;
      module.loading.start();
      try {
        const base = module.node.dataset.fragment;
        const markup = await requestHtml(id === 'weather' ? weatherFragmentUrl(base) : base);
        if (current !== sequence) return;
        const template = document.createElement('template');
        template.innerHTML = markup;
        const fragment = template.content.querySelector('[data-fragment-result]');
        if (!fragment) throw new Error('Invalid fragment');
        const title = fragment.dataset.title;
        const focusedKey =
          id === 'weather' && module.content.contains(document.activeElement)
            ? document.activeElement.closest('[data-weather-hour]')?.dataset.weatherHour
            : null;
        if (id !== 'status') module.content.replaceChildren(...fragment.childNodes);
        if (title) module.node.querySelector('[data-module-title]').textContent = title;
        if (id === 'weather') restoreWeatherHour(module, focusedKey);
        if (id === 'status') {
          for (const state of fragment.querySelectorAll('[data-service-status]')) {
            const tile = serviceTiles.get(state.dataset.serviceStatus),
              slot = tile?.querySelector('[data-service-state-slot]');
            if (!slot) continue;
            slot.replaceWith(state);
            tile.title = state.title;
            if (fragment.dataset.state === 'stale') {
              state.classList.add('service-stale');
              tile.title += '（上次检测结果）';
              state.querySelector('.service-detail').textContent = tile.title;
            }
          }
        }
        module.loading.settle();
        icons();
      } catch (error) {
        if (current !== sequence) return;
        if (error.reload) {
          window.dispatchEvent(new Event('homepage:update-required'));
          module.loading.fail('页面已有新版本', '请点击更新页面。', () => location.reload());
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
          } else module.node.hidden = true;
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
    loaders.set(id, load);
  }
  return loaders;
}
