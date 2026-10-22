import { safeUrl } from '../../shared/url.js';
export { safeUrl } from '../../shared/url.js';
export const icons = () => window.lucide?.createIcons();
export const icon = (name) => {
  const el = document.createElement('i');
  el.dataset.lucide = name;
  el.setAttribute('aria-hidden', 'true');
  return el;
};
export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
export function link(url, className, text) {
  const node = el('a', className, text);
  const href = safeUrl(url);
  if (!href) return el('span', className, text);
  node.href = href;
  node.target = '_blank';
  node.rel = 'noopener noreferrer';
  return node;
}
export function empty(target, title, description, retry) {
  const box = el('div', 'empty');
  box.append(el('strong', '', title), el('p', '', description));
  if (retry) {
    const button = el('button', 'retry', '重新加载');
    button.onclick = async () => {
      button.disabled = true;
      await retry();
    };
    box.append(button);
  }
  target.replaceChildren(box);
}

export const node = (tag, text) => el(tag, '', text);
export const safeLink = (url, label) => link(url, '', label);
