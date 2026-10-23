import { renderIcon } from './icons.js';
import { createHash } from 'node:crypto';
import { safeUrl } from '../../shared/url.js';

export function escapeHtml(value = '') {
  return String(value).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
}
export const text = escapeHtml;
export const icon = renderIcon;
export function link(url, label, className = '') {
  const href = safeUrl(url);
  return href
    ? `<a class="${escapeHtml(className)}" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`
    : `<span class="${escapeHtml(className)}">${label}</span>`;
}
export function empty(title, description, retry = false) {
  return `<div class="empty"><strong>${text(title)}</strong><p>${text(description)}</p>${retry ? '<button type="button" class="retry" data-retry>重新加载</button>' : ''}</div>`;
}
export function html(
  response,
  body,
  status = 200,
  method = 'GET',
  { cacheControl = 'no-store', request } = {},
) {
  const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': cacheControl };
  if (status === 200 && cacheControl !== 'no-store') {
    headers.ETag = '"' + createHash('sha256').update(body).digest('hex') + '"';
    if (
      request?.headers?.['if-none-match']
        ?.split(',')
        .some((tag) => tag.trim() === '*' || tag.trim().replace(/^W\//, '') === headers.ETag)
    ) {
      response.writeHead(304, headers);
      response.end();
      return;
    }
  }
  response.writeHead(status, headers);
  response.end(method === 'HEAD' ? undefined : body);
}
