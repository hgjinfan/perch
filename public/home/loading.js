import { el, empty } from '../core/dom.js';

export function createModuleState(module) {
  const target = module.content;
  const indicator = module.node.querySelector('.module-update');
  const placeholder = module.node.querySelector('template[data-loading-placeholder]');
  const feedback = module.node.querySelector('[data-load-feedback]') || target;
  let ready = target.dataset.loadState === 'ready';
  function stop() {
    target.setAttribute('aria-busy', 'false');
    if (indicator) indicator.hidden = true;
  }
  return {
    start() {
      feedback.querySelector('.module-load-error')?.remove();
      target.setAttribute('aria-busy', 'true');
      if (ready) {
        if (indicator) indicator.hidden = false;
      } else if (!target.querySelector('.skeleton') && placeholder)
        target.replaceChildren(placeholder.content.cloneNode(true));
    },
    settle() {
      ready = true;
      target.dataset.loadState = 'ready';
      stop();
    },
    fail(title, description, retry, retainedMessage = '更新失败，保留上次内容') {
      stop();
      if (!ready) {
        empty(target, title, description, retry);
        return;
      }
      feedback.querySelector('.module-load-error')?.remove();
      const warning = el('div', 'module-load-error');
      warning.setAttribute('role', 'status');
      const button = el('button', '', '重试');
      button.type = 'button';
      button.onclick = retry;
      warning.append(el('span', '', retainedMessage), button);
      feedback.append(warning);
    },
  };
}
