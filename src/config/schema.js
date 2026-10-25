import { validateConnections, resolveWidgetConnection } from '../widgets/connections.js';
import { validateGroups } from '../../shared/layout.js';
import { safeUrl } from '../../shared/url.js';
import { validateWidget } from '../widgets.js';
export function validateConfig(value) {
  const fail = (message) => {
    throw new Error(message);
  };
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('配置格式无效');
  const string = (s, max = 200) => typeof s === 'string' && s.length <= max;
  const url = (s) => s === '' || (string(s, 2048) && Boolean(safeUrl(s)));
  if (!string(value.title, 60) || !value.title.trim()) fail('首页名称不能为空，最多 60 字');
  try {
    new Intl.DateTimeFormat('en', { timeZone: value.timezone }).format();
  } catch {
    fail('日期时区无效');
  }
  for (const key of ['services', 'feeds', 'bookmarks', 'projects']) {
    if (!Array.isArray(value[key]) || value[key].length > 40) fail(`${key} 最多 40 项`);
    const ids = new Set();
    for (const item of value[key]) {
      if (!item || !string(item.name, 80) || !item.name.trim() || !url(item.url))
        fail('请检查名称和网址，仅支持 HTTP(S)');
      if (['services', 'feeds'].includes(key)) {
        if (!/^[a-z0-9_-]{1,50}$/.test(item.id) || ids.has(item.id))
          fail('模块标识必须唯一且只包含小写字母、数字、横线');
        ids.add(item.id);
        if (item.icon && !/^[a-z0-9-]{1,60}$/.test(item.icon)) fail('图标名称无效');
      }
      if (key === 'services' && item.healthUrl !== undefined && !url(item.healthUrl))
        fail('健康检查地址无效');
      if (
        key === 'feeds' &&
        (!url(item.site) || !Number.isInteger(item.limit) || item.limit < 1 || item.limit > 20)
      )
        fail('订阅网址或条数无效');
    }
  }
  if (value.weather !== null) {
    const w = value.weather;
    if (
      !w ||
      !string(w.name, 80) ||
      !Number.isFinite(w.latitude) ||
      Math.abs(w.latitude) > 90 ||
      !Number.isFinite(w.longitude) ||
      Math.abs(w.longitude) > 180
    )
      fail('天气城市或经纬度无效');
    if (!['fixed', 'ip'].includes(w.mode || 'fixed')) fail('天气模式无效');
    try {
      new Intl.DateTimeFormat('en', { timeZone: w.timezone }).format();
    } catch {
      fail('天气时区无效');
    }
  }
  if (!Array.isArray(value.widgets || []) || (value.widgets || []).length > 20)
    fail('自定义磁块最多 20 个');
  const connections = validateConnections(value.connections);
  const widgets = (value.widgets || []).map(validateWidget);
  for (const widget of widgets) resolveWidgetConnection(widget, connections);
  if (new Set(widgets.map((w) => w.id)).size !== widgets.length) fail('自定义磁块标识重复');
  const titles = {};
  for (const key of ['weather', 'status', 'bookmarks', 'projects']) {
    const title = value.titles?.[key];
    if (title !== undefined && (!string(title, 80) || !title.trim()))
      fail('磁块标题不能为空，最多 80 字');
    if (title !== undefined) titles[key] = title;
  }
  const layout = value.layout || { density: 'comfortable', hidden: [] };
  const allowed = new Set([
    'weather',
    'status',
    'bookmarks',
    'projects',
    ...value.feeds.map((f) => `feed-${f.id}`),
    ...widgets.map((w) => `widget-${w.id}`),
  ]);
  if (
    !['comfortable', 'compact'].includes(layout.density) ||
    !Array.isArray(layout.hidden) ||
    layout.hidden.some((id) => !allowed.has(id))
  )
    fail('模块设置无效');
  return {
    title: value.title,
    timezone: value.timezone,
    layout: {
      density: layout.density,
      hidden: [...new Set(layout.hidden)],
      groups: validateGroups(layout.groups, { ...value, widgets }),
    },
    titles,
    connections,
    widgets,
    services: value.services.map(({ id, name, icon, url, healthUrl }) => ({
      id,
      name,
      icon,
      url,
      ...(healthUrl ? { healthUrl } : {}),
    })),
    feeds: value.feeds.map(({ id, name, icon, url, site, limit }) => ({
      id,
      name,
      icon,
      url,
      site,
      limit,
    })),
    bookmarks: value.bookmarks.map(({ name, url }) => ({ name, url })),
    projects: value.projects.map(({ name, url }) => ({ name, url })),
    weather:
      value.weather === null
        ? null
        : {
            mode: value.weather.mode || 'fixed',
            name: value.weather.name,
            latitude: value.weather.latitude,
            longitude: value.weather.longitude,
            timezone: value.weather.timezone,
          },
  };
}
