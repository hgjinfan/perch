import { safeUrl } from './url.js';

export const validPath = (path) =>
  typeof path === 'string' &&
  path.length <= 160 &&
  (path === '' || /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(path)) &&
  !path.split('.').some((key) => ['__proto__', 'prototype', 'constructor'].includes(key));

export function getPath(data, path = '') {
  if (!validPath(path)) return undefined;
  let result = data;
  for (const key of path ? path.split('.') : []) {
    if (result == null || typeof result !== 'object' || !Object.hasOwn(result, key))
      return undefined;
    result = result[key];
  }
  return result;
}

const scalar = (value) =>
  ['string', 'number', 'boolean'].includes(typeof value) ? String(value).slice(0, 4000) : '';
function number(value) {
  if (
    value === null ||
    value === undefined ||
    value === '' ||
    typeof value === 'boolean' ||
    !['number', 'string'].includes(typeof value) ||
    !Number.isFinite(Number(value))
  ) {
    throw new Error('映射字段不是有效数字');
  }
  return Number(value);
}
export function validScale(value) {
  return Number.isFinite(value) && value >= 1e-12 && value <= 1e12;
}
function scaled(value, scale = 1) {
  if (!validScale(scale)) throw new Error('映射字段数值倍率无效');
  const result = number(value) * scale;
  if (!Number.isFinite(result)) throw new Error('映射字段数值超出范围');
  return result;
}
const read = (widget, raw, key, fallback = key) => getPath(raw, widget.mapping[key] ?? fallback);
function mapList(widget, raw) {
  const items = read(widget, raw, 'items');
  if (!Array.isArray(items)) throw new Error('列表路径没有指向数组');
  return {
    items: items
      .slice(0, widget.limit)
      .map((item) => ({
        label: scalar(read(widget, item, 'label', 'title')),
        url: safeUrl(read(widget, item, 'url')) || '',
        detail: scalar(read(widget, item, 'detail', 'description')),
      }))
      .filter((item) => item.label),
  };
}

// One definition owns editor defaults, capabilities and normalized data mapping.
// This module is browser-safe: credentials and remote requests never belong here.
export const widgetDefinitions = {
  text: {
    label: '文本',
    example: { text: '记录生活，也照看自己的数字世界。' },
    mapping: { text: 'text' },
    controls: { text: true },
    map(widget, raw) {
      const value = read(widget, raw, 'text');
      if (value === undefined || value === null || typeof value === 'object')
        throw new Error('找不到文本字段');
      return { text: scalar(value) };
    },
  },
  links: {
    label: '链接集合',
    example: { items: [{ title: 'GitHub', url: 'https://github.com/' }] },
    mapping: { items: 'items', label: 'title', url: 'url' },
    controls: { limit: true },
    map: mapList,
  },
  metric: {
    label: '单值指标',
    example: { value: 42 },
    mapping: { value: 'value' },
    controls: { unit: true, decimals: true },
    map: (widget, raw) => ({ value: scaled(read(widget, raw, 'value'), widget.scale) }),
  },
  metrics: {
    label: '多值指标',
    example: { cpu: 24, memory: 61 },
    mapping: {},
    controls: { fields: true, decimals: true },
    fields: [
      { label: 'CPU', path: 'cpu', unit: '%' },
      { label: '内存', path: 'memory', unit: '%' },
    ],
    map: (widget, raw) => ({
      values: widget.fields.map((field) => ({
        label: field.label,
        value: scaled(getPath(raw, field.path), field.scale),
        unit: field.unit,
      })),
    }),
  },
  list: {
    label: '内容列表',
    example: {
      items: [
        { title: '第一条内容', description: '这里显示补充信息', url: 'https://example.com/' },
      ],
    },
    mapping: { items: 'items', label: 'title', url: 'url', detail: 'description' },
    controls: { limit: true },
    map: mapList,
  },
  progress: {
    label: '进度条',
    example: { value: 32, max: 100 },
    mapping: { value: 'value', max: 'max' },
    controls: { unit: true, decimals: true, threshold: true },
    map(widget, raw) {
      const value = number(read(widget, raw, 'value')),
        max = number(read(widget, raw, 'max'));
      if (max <= 0 || value < 0) throw new Error('总量必须大于零，已用量不能为负');
      return {
        value,
        max,
        percent: Math.min(100, (value / max) * 100),
        warning: widget.threshold !== null && (value / max) * 100 >= widget.threshold,
      };
    },
  },
};

export function mapWidget(widget, raw) {
  const definition = widgetDefinitions[widget.type];
  if (!definition) throw new Error('Unknown widget type');
  return definition.map(widget, raw);
}
