import { updateFreshness } from './freshness.js';

// Both startup hydration and later refreshes apply the same server-rendered fragment contract.
export function parseFragment(markup, host = document) {
  const template = host.createElement('template');
  template.innerHTML = markup;
  const fragment = template.content.querySelector('[data-fragment-result]');
  if (!fragment) throw new Error('Invalid fragment');
  return fragment;
}
export function applyFragment(module, fragment, serviceTiles) {
  const id = module.node.dataset.module;
  if (fragment.dataset.updatedAt) {
    const time = id === 'status' ? module.node.querySelector('#service-freshness') : null;
    if (time) {
      time.setAttribute('datetime', fragment.dataset.updatedAt);
      time.classList.toggle('stale', fragment.dataset.state === 'stale');
      time.hidden = false;
      updateFreshness(time.parentNode);
    }
  }
  if (id !== 'status') module.content.replaceChildren(...fragment.childNodes);
  if (fragment.dataset.title)
    module.node.querySelector('[data-module-title]').textContent = fragment.dataset.title;
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
}
