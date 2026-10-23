import { renderWeather } from './weather.js';
import { moduleVisible } from '../config/visibility.js';
import { text, icon, link, empty } from './html.js';
import { skeleton } from './skeleton.js';
import { renderWidget } from './widgets.js';
import { safeUrl } from '../../shared/url.js';

export function describeModules(config) {
  const modules = [];
  const weather = () => ({
    id: 'weather',
    kind: 'weather',
    title: config.titles.weather || config.weather?.name || '天气',
    icon: 'cloud-sun',
    dynamic: Boolean(config.weather),
    interval: 60000,
    customTitle: Boolean(config.titles.weather),
  });
  config.feeds
    .filter((feed) => moduleVisible(config, `feed-${feed.id}`))
    .forEach((feed, i) => {
      modules.push({
        id: `feed-${feed.id}`,
        kind: 'feed',
        title: feed.name,
        icon: feed.icon || 'rss',
        site: feed.site,
        limit: feed.limit,
        dynamic: Boolean(feed.url),
        interval: 60000,
        sourceId: feed.id,
      });
      if (i === 1 && moduleVisible(config, 'weather')) modules.push(weather());
    });
  if (moduleVisible(config, 'weather') && !modules.some((m) => m.id === 'weather'))
    modules.push(weather());
  for (const [id, title, glyph] of [
    ['bookmarks', '常用书签', 'bookmark'],
    ['projects', '关注项目', 'package'],
  ]) {
    if (moduleVisible(config, id))
      modules.push({
        id,
        kind: 'links',
        title: config.titles[id] || title,
        icon: glyph,
        items: config[id],
        dynamic: false,
      });
  }
  for (const widget of config.widgets)
    if (moduleVisible(config, `widget-${widget.id}`))
      modules.push({
        id: `widget-${widget.id}`,
        kind: 'widget',
        title: widget.title,
        icon: widget.icon,
        description: widget.description,
        dynamic: true,
        interval: widget.refresh * 1000,
        sourceId: widget.id,
        widget,
      });
  return modules;
}
function staticBody(module) {
  if (module.kind === 'feed') return empty('还没有添加订阅', '这里暂时还没有发布内容。');
  if (module.kind === 'weather') return empty('未设置城市', '天气信息尚未启用。');
  return `<div class="chips">${(module.items || [])
    .filter((item) => safeUrl(item.url))
    .map((item) => link(item.url, `${text(item.name)}${icon('arrow-up-right')}`))
    .join('')}</div>`;
}
const picker = () =>
  `<details class="city-picker"><summary>切换城市</summary><form class="city-search"><input type="search" placeholder="输入城市名称" minlength="2" maxlength="80" required aria-label="城市名称"><button type="submit">搜索</button></form><div class="city-results" aria-live="polite"></div><button type="button" class="city-auto">恢复默认位置</button></details>`;
export function renderModule(module) {
  const shape =
    module.kind === 'widget' ? module.widget.type : module.kind === 'feed' ? 'list' : module.kind;
  const count =
    module.kind === 'widget'
      ? module.widget.type === 'metrics'
        ? module.widget.fields.length
        : module.widget.limit
      : module.limit;
  const placeholder = skeleton(shape, count);
  const attributes = module.dynamic
    ? ` data-fragment="/fragments/${text(module.id)}" data-refresh="${module.interval}"`
    : '';
  return `<section class="tile module${module.kind === 'weather' ? ' weather' : ''}" data-module="${text(module.id)}" data-placeholder-kind="${shape}" data-placeholder-rows="${Math.max(1, Math.min(8, Number(count ?? module.items?.length) || 3))}"${attributes}><h2>${icon(module.icon)}<span data-module-title>${text(module.title)}</span>${safeUrl(module.site) ? link(module.site, icon('arrow-up-right'), 'heading-link') : ''}<span class="module-update" role="status" hidden>更新中</span></h2>${module.description ? `<p class="widget-description">${text(module.description)}</p>` : ''}<div class="module-content" aria-busy="${module.dynamic ? 'true' : 'false'}" data-load-state="${module.dynamic ? 'loading' : 'ready'}">${module.dynamic ? placeholder : staticBody(module)}</div>${module.dynamic ? `<template data-loading-placeholder>${placeholder}</template>` : ''}${module.kind === 'weather' && module.dynamic ? picker() : ''}</section>`;
}

function age(date) {
  if (!date) return '';
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(date)) / 60000));
  return minutes < 60
    ? `${minutes}m`
    : minutes < 1440
      ? `${Math.floor(minutes / 60)}h`
      : `${Math.floor(minutes / 1440)}d`;
}
function renderFeed(items) {
  return items.length
    ? items
        .map(
          (item, i) =>
            `<article class="news"><span class="rank">${i + 1}</span>${link(item.url, text(item.title))}<time${item.date ? ` datetime="${text(item.date)}" title="${text(item.date)}"` : ''}>${text(age(item.date))}</time></article>`,
        )
        .join('')
    : empty('暂无文章', '订阅源已连接，暂时没有可显示的内容。');
}
export function renderModuleResult(module, result, config) {
  let body, title;
  if (result.state === 'unconfigured') body = staticBody(module);
  else {
    if (!result.data) throw new Error('No module data');
    if (module.kind === 'feed') body = renderFeed(result.data);
    if (module.kind === 'weather') {
      body = renderWeather(result);
      if (!module.customTitle) title = result.location?.name;
    }
    if (module.kind === 'widget') body = renderWidget(module.widget, result.data);
  }
  if (result.state === 'stale')
    body += `<div class="state-label stale">${text(result.message || '更新失败，保留上次内容')}</div>`;
  if (result.updatedAt) {
    const date = text(result.updatedAt);
    body += `<time class="state-label freshness${result.state === 'stale' ? ' stale' : ''}" data-freshness datetime="${date}" aria-label="数据更新时间">${result.state === 'stale' ? '上次成功' : '更新于'} ${text(new Date(result.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }))}</time>`;
  }
  return `<div data-fragment-result data-state="${result.state === 'stale' ? 'stale' : 'ready'}"${result.updatedAt ? ` data-updated-at="${text(result.updatedAt)}"` : ''}${title ? ` data-title="${text(title)}"` : ''}>${body || ''}</div>`;
}
export function renderCities(cities) {
  return cities.length
    ? cities
        .map(
          (city) =>
            `<button type="button" class="city-option" data-city-name="${text(city.name)}" data-latitude="${text(city.latitude)}" data-longitude="${text(city.longitude)}" data-timezone="${text(city.timezone)}">${text(city.name)}${city.region ? ' · ' + text(city.region) : ''}</button>`,
        )
        .join('')
    : '<p class="muted">未找到城市，请尝试拼音或英文名称。</p>';
}
