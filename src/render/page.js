import { renderGroups } from './groups.js';
import { text, icon } from './html.js';
import { renderServiceGrid } from './services.js';

export function renderHome(config, shell, version, pageVersion) {
  const pageTitle =
    config.title.trim().toLowerCase() === 'perch' ? '栖页 · Perch' : `${config.title} · Perch`;
  const services = renderServiceGrid(config);
  const modules = renderGroups(config);
  const date = new Intl.DateTimeFormat('zh-CN', {
    timeZone: config.timezone,
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(new Date());
  const markup = shell
    .replace(
      '<html lang="zh-CN">',
      `<html lang="zh-CN" data-density="${text(config.layout.density)}"${pageVersion ? ` data-page-version="${text(pageVersion)}"` : ''}${version ? ` data-asset-version="${version}"` : ''}>`,
    )
    .replace(/<title>[\s\S]*?<\/title>/, () => `<title>${text(pageTitle)}</title>`)
    .replace(
      /<a class="brand" href="\/">[\s\S]*?<\/a\s*>/,
      () => `<a class="brand" href="/">${text(config.title)}<span>/ home</span></a>`,
    )
    .replace(
      '<time id="date"></time>',
      () => `<time id="date" data-timezone="${text(config.timezone)}">${text(date)}</time>`,
    )
    .replace(
      /<main id="board"[^>]*>[\s\S]*?<\/main>/,
      () => `<main id="board" class="board" aria-label="个人仪表盘">${services}${modules}</main>`,
    );
  const rendered = markup.replace(/<i data-lucide="([a-z0-9-]+)">\s*<\/i>/g, (_, name) =>
    icon(name),
  );
  return version
    ? rendered.replaceAll(
        'data-fragment="/fragments/',
        `data-fragment="/fragments/${version}/${pageVersion?.slice(21) || ''}/`,
      )
    : rendered;
}
