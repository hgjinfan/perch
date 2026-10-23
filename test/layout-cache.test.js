import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import {
  captureLayout,
  normalizeLayout,
  rememberLayout,
  readLayout,
  restoreLayout,
  LAYOUT_CACHE_KEY,
} from '../public/pwa/layout-cache.js';
const now = 1792700000000;
const version = 'a'.repeat(20) + '-' + 'b'.repeat(32);
const record = {
  version: 1,
  savedAt: now,
  pageVersion: version,
  density: 'compact',
  services: 2,
  groups: [
    {
      columns: 4,
      heading: true,
      tiles: [
        { kind: 'weather', span: 2, rows: 3 },
        { kind: 'metric', span: 'full', rows: 1 },
      ],
    },
  ],
};
function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}
test('layout snapshot keeps geometry only, never titles, identifiers, links or business values', () => {
  const { document } = parseHTML(
    `<html data-page-version="${version}" data-density="compact"><body><main id="board"><div data-service="private-service">Sensitive service name</div><section class="board-group" data-group="private-id"><h2 class="group-title">Private group title</h2><div class="content-board" data-columns="4"><section class="module" data-module="widget-private" data-span="full" data-placeholder-kind="metric" data-placeholder-rows="1"><h2>Private title</h2><a href="https://private.example/?token=secret">Secret business value</a></section></div></section></main></body></html>`,
  );
  const result = captureLayout(document, now);
  assert.deepEqual(result.groups, [
    { columns: 4, heading: true, tiles: [{ kind: 'metric', span: 'full', rows: 1 }] },
  ]);
  assert.equal(result.services, 1);
  assert.ok(
    !/private|Sensitive|Secret|token|https|title|href|data-module/.test(JSON.stringify(result)),
  );
  const store = storage();
  rememberLayout(document, { storage: store, now });
  assert.deepEqual(readLayout({ storage: store, now }), result);
});
test('invalid, oversized, stale and unavailable storage safely falls back', () => {
  for (const bad of [
    null,
    { ...record, version: 2 },
    { ...record, savedAt: now - 31 * 86400000 },
    { ...record, services: 41 },
    { ...record, groups: [{ ...record.groups[0], columns: 99 }] },
    {
      ...record,
      groups: [{ ...record.groups[0], tiles: [{ kind: '<img onerror=x>', span: 1, rows: 2 }] }],
    },
  ])
    assert.equal(normalizeLayout(bad, now), null);
  const store = storage();
  store.setItem(LAYOUT_CACHE_KEY, '{');
  assert.equal(readLayout({ storage: store, now }), null);
  store.setItem(LAYOUT_CACHE_KEY, ' '.repeat(16001));
  assert.equal(readLayout({ storage: store, now }), null);
  const blocked = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
  };
  assert.equal(readLayout({ storage: blocked, now }), null);
  const { document } = parseHTML(
    '<html><body><div class="launch-skeleton">Fallback</div></body></html>',
  );
  restoreLayout(document, { storage: blocked, now });
  assert.equal(document.querySelector('.launch-skeleton').textContent, 'Fallback');
  assert.doesNotThrow(() => rememberLayout(document, { storage: blocked, now }));
});
test('restored skeleton follows groups, spans and shapes using safe DOM; extra cached fields are discarded', () => {
  const store = storage();
  store.setItem(
    LAYOUT_CACHE_KEY,
    JSON.stringify({ ...record, title: 'DO_NOT_RENDER', html: '<script>bad()</script>' }),
  );
  const { document } = parseHTML(
    '<html><body><div class="launch-skeleton" aria-hidden="true">Fallback</div></body></html>',
  );
  restoreLayout(document, { storage: store, now });
  assert.equal(document.querySelectorAll('.service-grid .app').length, 2);
  assert.equal(document.querySelector('.content-board').dataset.columns, '4');
  assert.equal(document.querySelectorAll('.content-board > [data-span="full"]').length, 1);
  assert.ok(document.querySelector('.skeleton-weather'));
  assert.ok(document.querySelector('.skeleton-metric'));
  assert.equal(document.documentElement.dataset.density, 'compact');
  assert.ok(!/DO_NOT_RENDER|<script>|private/.test(document.body.innerHTML));
  assert.equal(document.querySelector('.launch-skeleton').dataset.layoutVersion, version);
});

test('the real default server document produces a usable comfortable-density record', async () => {
  const { readFile } = await import('node:fs/promises');
  const { validateConfig } = await import('../src/config/schema.js');
  const { renderHome } = await import('../src/render/page.js');
  const config = validateConfig(
    JSON.parse(await readFile(new URL('../config.json', import.meta.url), 'utf8')),
  );
  const shell = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const { document } = parseHTML(renderHome(config, shell, 'a'.repeat(20), version));
  const record = captureLayout(document, now);
  assert.ok(record);
  assert.equal(record.density, config.layout.density);
  assert.ok(record.groups.length);
  assert.ok(record.groups.flatMap((group) => group.tiles).some((tile) => tile.kind === 'weather'));
});
