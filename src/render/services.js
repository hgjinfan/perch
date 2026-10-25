import { text, icon, link } from './html.js';
import { safeUrl } from '../../shared/url.js';
import { moduleVisible } from '../config/visibility.js';

export function renderServiceState(service, item = { state: 'pending' }) {
  const state = !safeUrl(service.url || service.internalUrl) ? 'unconfigured' : item.state;
  const labels = {
    pending: ['检测中', '正在检测服务状态'],
    unconfigured: ['待配置', '尚未配置访问地址'],
    online: [
      `${item.latency} ms`,
      `在线，响应 ${item.latency} ms${[401, 403].includes(item.status) ? '，需要登录' : ''}`,
    ],
    degraded: [`HTTP ${item.status}`, `服务异常：HTTP ${item.status}`],
    offline: ['无法连接', '无法连接服务，请检查服务或网络'],
  };
  const [label, description] = labels[state] || ['状态未知', '暂时无法确定服务状态'];
  const safeState = Object.hasOwn(labels, state) ? state : 'pending';
  return `<span class="service-state-slot" data-service-state-slot data-service-status="${text(service.id)}" data-state="${safeState}" title="${text(description)}">${state !== 'unconfigured' ? `<span class="status-dot ${safeState}" aria-label="${text(description)}"></span>` : ''}<span class="service-health">${text(label)}</span><span class="service-detail" id="service-detail-${text(service.id)}" role="tooltip">${text(description)}</span></span>`;
}

export function renderServiceGrid(config) {
  const enabled = moduleVisible(config, 'status') && config.services.length > 0;
  const tiles = config.services
    .map((service) => {
      const configured = Boolean(safeUrl(service.url || service.internalUrl));
      const status = enabled
        ? renderServiceState(service)
        : configured
          ? ''
          : '<span class="service-health">待配置</span>';
      const body = `${icon(service.icon)}<span class="app-name">${text(service.name)}</span>${status}`;
      const attributes = ` data-external-url="${text(safeUrl(service.url) || '')}" data-internal-url="${text(safeUrl(service.internalUrl) || '')}" data-service="${text(service.id)}" aria-label="${text(service.name)}"${enabled ? ` aria-describedby="service-detail-${text(service.id)}"` : ''}`;
      return configured
        ? link(service.url || service.internalUrl, body, 'tile app').replace(
            '<a ',
            `<a${attributes} `,
          )
        : `<div class="tile app unconfigured"${attributes}>${body}</div>`;
    })
    .join('');
  const switcher = config.services.some((s) => safeUrl(s.internalUrl))
    ? '<label class="service-route-label">访问入口<select data-service-route aria-label="服务访问入口"><option value="external">公网优先</option><option value="internal">内网优先</option></select></label>'
    : '';
  return `${switcher}<div class="service-region" role="group" aria-label="服务入口与状态"${enabled ? ' data-module="status" data-fragment="/fragments/status" data-refresh="60000"' : ''}><div class="service-grid module-content" data-load-state="ready" aria-busy="false">${tiles}</div>${enabled ? '<span class="module-update visually-hidden" role="status" hidden>正在更新服务状态</span><time id="service-freshness" class="service-freshness" data-freshness hidden></time><div data-load-feedback></div>' : ''}</div>`;
}

export function renderServiceResult(config, result) {
  if (!Array.isArray(result.data)) throw new Error('No service status data');
  const items = new Map(result.data.map((item) => [item.id, item]));
  return `<div data-fragment-result data-state="${result.state === 'stale' ? 'stale' : 'ready'}"${result.updatedAt ? ` data-updated-at="${text(result.updatedAt)}"` : ''}>${config.services.map((service) => renderServiceState(service, items.get(service.id))).join('')}</div>`;
}
