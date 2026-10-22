import { text, link, empty } from './html.js';

const number = (widget, value) =>
  text(
    new Intl.NumberFormat('zh-CN', { maximumFractionDigits: widget.decimals ?? 1 }).format(value),
  );
const unit = (value) => `<span class="widget-unit">${text(value || '')}</span>`;
export const widgetRenderers = {
  text: (widget, data) => `<div class="widget-text">${text(data.text)}</div>`,
  metric: (widget, data) =>
    `<div class="widget-value">${number(widget, data.value)}${unit(widget.unit)}</div>`,
  metrics: (widget, data) =>
    `<div class="widget-metrics">${data.values.map((item) => `<div><div class="muted">${text(item.label)}</div><div class="widget-number">${number(widget, item.value)}${unit(item.unit)}</div></div>`).join('')}</div>`,
  progress: (widget, data) =>
    `<div class="widget-progress-label">${number(widget, data.value)} / ${number(widget, data.max)} ${text(widget.unit || '')}<span>${number(widget, data.percent)}%</span></div><progress ${data.warning ? 'class="warning"' : ''} max="${text(data.max)}" value="${text(Math.min(data.value, data.max))}" aria-label="${text(widget.title)}"></progress>${data.warning ? '<div class="widget-warning">已达到告警阈值</div>' : ''}`,
  links: (widget, data) =>
    `<div class="chips">${data.items.length ? data.items.map((item) => link(item.url, text(item.label))).join('') : '<div class="muted">暂无内容</div>'}</div>`,
  list: (widget, data) =>
    `<div class="widget-list">${data.items.length ? data.items.map((item) => `<div class="widget-list-row">${link(item.url, text(item.label))}${item.detail ? `<div class="muted">${text(item.detail)}</div>` : ''}</div>`).join('') : '<div class="muted">暂无内容</div>'}</div>`,
};
export function renderWidget(widget, data) {
  const render = widgetRenderers[widget.type];
  if (!render) throw new Error('Unknown widget renderer');
  return render(widget, data);
}

export function renderPreview(widget, data) {
  return `<section class="widget-preview-content"><h3>${text(widget.title)}</h3>${widget.description ? `<p class="widget-description">${text(widget.description)}</p>` : ''}${renderWidget(widget, data)}</section>`;
}
