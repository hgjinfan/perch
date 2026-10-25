import { isPhone } from '../home/phone-layout.js';
import { setupTileLayout } from '../home/tile-layout.js';

export const LAYOUT_CACHE_KEY = 'perch-startup-layout-v1';
const kinds = new Set(['list', 'weather', 'metric', 'metrics', 'progress', 'links', 'text']);
const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const lifetime = 30 * 24 * 60 * 60 * 1000;

// Reconstruct an allowlisted record. Never retain text, IDs, URLs or arbitrary DOM attributes.
export function normalizeLayout(value, now = Date.now()) {
  if (
    !value ||
    value.version !== 1 ||
    !integer(value.savedAt, 0, Number.MAX_SAFE_INTEGER) ||
    value.savedAt > now + 60000 ||
    now - value.savedAt > lifetime ||
    !/^[a-f0-9]{20}-[a-f0-9]{32}$/.test(value.pageVersion || '') ||
    !['comfortable', 'compact'].includes(value.density) ||
    !integer(value.services, 0, 40) ||
    !Array.isArray(value.groups) ||
    value.groups.length > 12
  )
    return null;
  let count = 0;
  const groups = [];
  for (const group of value.groups) {
    if (
      !group ||
      !integer(group.columns, 1, 4) ||
      typeof group.heading !== 'boolean' ||
      !Array.isArray(group.tiles) ||
      group.tiles.length > 64
    )
      return null;
    const tiles = [];
    for (const tile of group.tiles) {
      if (
        !tile ||
        !kinds.has(tile.kind) ||
        !(tile.span === 'full' || integer(tile.span, 1, 4)) ||
        !integer(tile.rows, 1, 8) ||
        ++count > 64
      )
        return null;
      tiles.push({ kind: tile.kind, span: tile.span, rows: tile.rows });
    }
    if (tiles.length) groups.push({ columns: group.columns, heading: group.heading, tiles });
  }
  return {
    version: 1,
    savedAt: value.savedAt,
    pageVersion: value.pageVersion,
    density: value.density,
    services: value.services,
    groups,
  };
}
export function captureLayout(host = document, now = Date.now()) {
  const board = host.querySelector('#board');
  if (!board) return null;
  return normalizeLayout(
    {
      version: 1,
      savedAt: now,
      pageVersion: host.documentElement.dataset.pageVersion,
      density: host.documentElement.dataset.density || 'comfortable',
      services: board.querySelectorAll('[data-service]').length,
      groups: [...board.querySelectorAll('.board-group')]
        .filter((group) => !group.hidden && (!group.matches('details') || group.open))
        .map((group) => {
          const grid = group.querySelector('.content-board');
          return {
            columns: Number(grid?.dataset.columns),
            heading: Boolean(group.querySelector('.group-title')),
            tiles: [...(grid?.children || [])]
              .filter((node) => node.matches('.module') && !node.hidden)
              .map((node) => ({
                kind: node.dataset.placeholderKind || 'list',
                span: node.dataset.span === 'full' ? 'full' : Number(node.dataset.span || 1),
                rows: Math.max(1, Math.min(8, Number(node.dataset.placeholderRows) || 3)),
              })),
          };
        }),
    },
    now,
  );
}
export function rememberLayout(
  host = document,
  { storage, now = Date.now(), phone = isPhone() } = {},
) {
  try {
    const record = captureLayout(host, now);
    if (record)
      (storage || localStorage).setItem(
        phone ? LAYOUT_CACHE_KEY + ':phone' : LAYOUT_CACHE_KEY,
        JSON.stringify(record),
      );
  } catch {
    /* Disabled storage must not interfere with opening the homepage. */
  }
}
export function readLayout({ storage, now = Date.now(), phone = isPhone() } = {}) {
  try {
    const raw = (storage || localStorage).getItem(
      phone ? LAYOUT_CACHE_KEY + ':phone' : LAYOUT_CACHE_KEY,
    );
    if (!raw || raw.length > 16000) return null;
    return normalizeLayout(JSON.parse(raw), now);
  } catch {
    return null;
  }
}
function placeholder(host, { kind, rows }) {
  const root = host.createElement('div');
  root.className = `skeleton skeleton-${kind}`;
  if (kind === 'metrics') root.classList.add('widget-metrics');
  if (kind === 'links') root.classList.add('skeleton-chips');
  const bar = (parent, size = 'long') => {
    const el = host.createElement('span');
    el.className = `skeleton-bar skeleton-${size}`;
    parent.append(el);
  };
  if (kind === 'weather') {
    const main = host.createElement('div');
    main.className = 'skeleton-weather-main';
    bar(main, 'temperature');
    bar(main, 'weather-icon');
    root.append(main);
    bar(root, 'medium');
    const hours = host.createElement('div');
    hours.className = 'skeleton-hours';
    for (let i = 0; i < 12; i++) {
      const hour = host.createElement('div');
      bar(hour, 'short');
      bar(hour, 'short');
      hours.append(hour);
    }
    root.append(hours);
  } else if (kind === 'metric') bar(root, 'number');
  else if (kind === 'progress') {
    bar(root, 'medium');
    bar(root, 'track');
  } else if (kind === 'links') {
    for (let i = 0; i < rows; i++) bar(root, 'chip');
  } else if (kind === 'text') {
    bar(root);
    bar(root, 'medium');
    bar(root);
  } else
    for (let i = 0; i < rows; i++) {
      const row = host.createElement('div');
      row.className = kind === 'metrics' ? '' : 'skeleton-row';
      bar(row, kind === 'metrics' ? 'medium' : 'long');
      bar(row, kind === 'metrics' ? 'number' : 'medium');
      root.append(row);
    }
  return root;
}
export function restoreLayout(host = document, options = {}) {
  const record = readLayout(options),
    root = host.querySelector('.launch-skeleton');
  if (!record || !root) return;
  const content = host.createDocumentFragment();
  if (record.services) {
    const services = host.createElement('div');
    services.className = 'service-grid';
    for (let i = 0; i < record.services; i++) {
      const tile = host.createElement('div');
      tile.className = 'tile app';
      for (const size of ['app-icon', 'medium']) {
        const bar = host.createElement('span');
        bar.className = `skeleton-bar skeleton-${size}`;
        tile.append(bar);
      }
      services.append(tile);
    }
    content.append(services);
  }
  for (const group of record.groups) {
    const section = host.createElement('section');
    section.className = 'board-group';
    if (group.heading) {
      const heading = host.createElement('div');
      heading.className = 'group-title';
      const bar = host.createElement('span');
      bar.className = 'skeleton-bar skeleton-heading';
      heading.append(bar);
      section.append(heading);
    }
    const grid = host.createElement('div');
    grid.className = 'content-board';
    grid.dataset.columns = String(group.columns);
    for (const item of group.tiles) {
      const tile = host.createElement('div');
      tile.className = 'tile module';
      tile.dataset.span = String(item.span);
      const heading = host.createElement('span');
      heading.className = 'skeleton-bar skeleton-heading';
      tile.append(heading, placeholder(host, item));
      grid.append(tile);
    }
    section.append(grid);
    content.append(section);
  }
  root.replaceChildren(content);
  root.dataset.layoutVersion = record.pageVersion;
  host.documentElement.dataset.density = record.density;
  return setupTileLayout(root);
}
