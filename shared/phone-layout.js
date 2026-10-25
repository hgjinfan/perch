import { layoutEntries } from './layout.js';
export function phoneItemLimit(config, id) {
  if (id.startsWith('feed-')) return config.feeds.find((f) => `feed-${f.id}` === id)?.limit || 0;
  if (id.startsWith('widget-')) {
    const widget = config.widgets.find((w) => `widget-${w.id}` === id);
    return widget && ['links', 'list'].includes(widget.type) ? widget.limit : 0;
  }
  if (id === 'bookmarks' || id === 'projects') return Math.min(40, config[id].length);
  return 0;
}
export function phoneOrder(config) {
  const defaults = (config.layout.groups || []).flatMap((group) =>
    group.items.map((item) => item.id),
  );
  const allowed = new Set(layoutEntries(config).map((item) => item.id));
  const order = (config.layout.phone?.order || []).filter((id) => allowed.has(id));
  return [...new Set([...order, ...defaults, ...allowed])];
}
export function normalizePhoneLayout(value, config) {
  if (value === undefined) return { enabled: false, order: [], hidden: [], limits: {} };
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    typeof value.enabled !== 'boolean'
  )
    throw new Error('手机展示配置无效');
  const allowed = new Set(layoutEntries(config).map((item) => item.id));
  const ids = (key) => {
    const entries = value[key] ?? [];
    if (
      !Array.isArray(entries) ||
      entries.length > 64 ||
      entries.some((id) => typeof id !== 'string' || !/^[a-z0-9_-]{1,60}$/.test(id)) ||
      new Set(entries).size !== entries.length
    )
      throw new Error('手机磁块顺序或隐藏项无效');
    return entries.filter((id) => allowed.has(id));
  };
  const limits = value.limits ?? {};
  if (
    !limits ||
    typeof limits !== 'object' ||
    Array.isArray(limits) ||
    Object.keys(limits).length > 64
  )
    throw new Error('手机内容条数无效');
  const normalized = {};
  for (const [id, limit] of Object.entries(limits)) {
    if (!allowed.has(id)) continue;
    const max = phoneItemLimit(config, id);
    if (!Number.isInteger(limit) || limit < 1 || limit > 40)
      throw new Error('手机条数须为 1 到桌面显示数量之间的整数');
    if (max) normalized[id] = Math.min(limit, max);
  }
  return { enabled: value.enabled, order: ids('order'), hidden: ids('hidden'), limits: normalized };
}
