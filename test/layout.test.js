import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import { validateConfig } from '../src/config/schema.js';
import { renderHome } from '../src/render/page.js';
import { mountLayoutEditor } from '../public/admin/layout-editor.js';
import { reconcileGroups, effectiveColumns, effectiveSpan } from '../shared/layout.js';
const raw = JSON.parse(await readFile(new URL('../config.json', import.meta.url)));
const shell = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
test('legacy layout gains complete, stable positions and natural widths', () => {
  const config = validateConfig(raw);
  assert.equal(config.layout.groups.length, 1);
  assert.equal(config.layout.groups[0].items[2].id, 'weather');
  assert.ok(config.layout.groups[0].items.every((item) => item.span === 1));
  assert.deepEqual(validateConfig(config), config);
});
test('groups retain order, span and hidden security while appending new modules', () => {
  const config = validateConfig({
    ...raw,
    layout: {
      density: 'compact',
      hidden: ['feed-hn'],
      groups: [
        {
          id: 'tools',
          title: '<Tools>',
          columns: 4,
          items: [
            { id: 'bookmarks', span: 2 },
            { id: 'feed-hn', span: 3 },
          ],
        },
        { id: 'daily', title: '日常', columns: 2, items: [{ id: 'weather', span: 4 }] },
      ],
    },
  });
  const { document } = parseHTML(renderHome(config, shell));
  assert.deepEqual(
    [...document.querySelectorAll('[data-group]')].map((n) => n.dataset.group),
    ['tools', 'daily'],
  );
  assert.equal(
    document.querySelector('[data-group=tools] [data-module]').dataset.module,
    'bookmarks',
  );
  assert.equal(document.querySelector('[data-module=weather]').dataset.span, '4');
  assert.equal(document.querySelector('[data-module=feed-hn]'), null);
  assert.equal(document.querySelector('.group-title').textContent, '<Tools>');
  assert.ok(config.layout.groups[0].items.some((i) => i.id === 'projects'));
});
test('invalid, duplicate and stale layout identities are rejected', () => {
  const group = { id: 'a', title: '', columns: 3, items: [{ id: 'weather', span: 1 }] };
  for (const groups of [
    [],
    [group, group],
    [{ ...group, columns: 5 }],
    [{ ...group, items: [{ id: 'missing', span: 1 }] }],
    [{ ...group, items: [{ id: 'weather', span: 0 }] }],
  ])
    assert.throws(() =>
      validateConfig({ ...raw, layout: { density: 'compact', hidden: [], groups } }),
    );
});
test('editor moves between groups, reorders and merges a removed group without losing tiles', () => {
  const config = validateConfig(raw),
    { document } = parseHTML('<div id="editor"></div>');
  const prototype = Object.getPrototypeOf(document.createElement('select'));
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
  Object.defineProperty(prototype, 'value', {
    configurable: true,
    get() {
      return this.querySelector('option[selected]')?.value || this.querySelector('option')?.value;
    },
    set(value) {
      for (const option of this.querySelectorAll('option'))
        option.selected = option.value === String(value);
    },
  });
  const previous = globalThis.document;
  globalThis.document = document;
  try {
    const target = document.querySelector('#editor');
    mountLayoutEditor(target, config);
    const width = target.querySelector('[data-tile-width="weather"]');
    width.value = 'full';
    width.onchange();
    assert.equal(config.layout.groups[0].items.find((i) => i.id === 'weather').span, 'full');
    assert.equal(target.querySelector('[data-preview-item="weather"]').dataset.span, 'full');
    const beforeMode = JSON.stringify(config);
    [...target.querySelectorAll('button')].find((b) => b.textContent === '手机').onclick();
    assert.equal(target.querySelector('.layout-width-preview').dataset.columns, '1');
    assert.equal(JSON.stringify(config), beforeMode);
    const click = (label) =>
      [...target.querySelectorAll('button')].find((b) => b.textContent === label).onclick();
    click('＋ 添加分组');
    assert.equal(config.layout.groups.length, 2);
    const choice = target.querySelector('[data-layout-item=weather] select');
    choice.value = config.layout.groups[1].id;
    choice.onchange();
    assert.equal(config.layout.groups[1].items[0].id, 'weather');
    const handle = target.querySelector('[data-layout-item=feed-hn] .tile-drag-handle');
    const transfer = { setData() {} };
    handle.ondragstart({ dataTransfer: transfer });
    const destination = target.querySelectorAll('.layout-tile-list')[1];
    destination.ondrop({ preventDefault() {}, target: destination, dataTransfer: transfer });
    assert.equal(config.layout.groups[1].items.at(-1).id, 'feed-hn');
    const sameGroup = target.querySelector('[data-layout-item=weather] select');
    const orderBefore = JSON.stringify(config.layout.groups);
    sameGroup.onchange();
    assert.equal(JSON.stringify(config.layout.groups), orderBefore);
    target.querySelector('[aria-label="下移 常用书签"]').onclick();
    assert.equal(config.layout.groups[0].items.at(-1).id, 'bookmarks');
    click('移除分组');
    assert.equal(config.layout.groups.length, 1);
    assert.equal(new Set(config.layout.groups[0].items.map((i) => i.id)).size, 7);
    config.feeds.shift();
    reconcileGroups(config);
    assert.ok(!config.layout.groups[0].items.some((i) => i.id === 'feed-hn'));
  } finally {
    globalThis.document = previous;
    Object.defineProperty(prototype, 'value', descriptor);
  }
});

test('full-row span survives validation and rendering while numeric spans clamp at breakpoints', () => {
  const config = validateConfig({
    ...raw,
    layout: {
      density: 'comfortable',
      hidden: [],
      groups: [
        {
          id: 'daily',
          title: '日常',
          columns: 3,
          items: [
            { id: 'weather', span: 'full' },
            { id: 'bookmarks', span: 4 },
          ],
        },
      ],
    },
  });
  assert.deepEqual(validateConfig(config), config);
  const { document } = parseHTML(renderHome(config, shell));
  assert.equal(document.querySelector('[data-module="weather"]').dataset.span, 'full');
  assert.equal(effectiveSpan('full', effectiveColumns(4, 'desktop')), 4);
  assert.equal(effectiveSpan('full', effectiveColumns(3, 'tablet')), 2);
  assert.equal(effectiveSpan(4, effectiveColumns(3, 'phone')), 1);
  assert.equal(effectiveSpan(2, effectiveColumns(4, 'desktop')), 2);
  for (const span of ['auto', '4', null, 1.5])
    assert.throws(() =>
      validateConfig({
        ...config,
        layout: {
          ...config.layout,
          groups: [{ ...config.layout.groups[0], items: [{ id: 'weather', span }] }],
        },
      }),
    );
});
