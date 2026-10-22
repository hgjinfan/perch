import { safeUrl } from '../../shared/url.js';

export function escapeHtml(value = '') {
  return String(value).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
}
export const text = escapeHtml;
export function icon(name) {
  const safe = /^[a-z0-9-]{1,60}$/.test(name || '') ? name : 'box';
  return `<i data-lucide="${safe}" aria-hidden="true"></i>`;
}
export function link(url, label, className = '') {
  const href = safeUrl(url);
  return href
    ? `<a class="${escapeHtml(className)}" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`
    : `<span class="${escapeHtml(className)}">${label}</span>`;
}
export function empty(title, description, retry = false) {
  return `<div class="empty"><strong>${text(title)}</strong><p>${text(description)}</p>${retry ? '<button type="button" class="retry" data-retry>重新加载</button>' : ''}</div>`;
}
export function html(response, body, status = 200, method = 'GET') {
  response.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(method === 'HEAD' ? undefined : body);
}
