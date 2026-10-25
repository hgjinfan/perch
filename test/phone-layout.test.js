import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import { validateConfig } from '../src/config/schema.js';
import { normalizePhoneLayout, phoneOrder } from '../shared/phone-layout.js';
import { renderGroups } from '../src/render/groups.js';
import { setupPhoneLayout, applyPhoneLimit } from '../public/home/phone-layout.js';
import { hydrateInitialContent } from '../public/pwa/initial-content.js';
import { captureLayout } from '../public/pwa/layout-cache.js';
const raw = JSON.parse(await readFile(fileURLToPath(new URL('../config.json', import.meta.url))));
function config() {
  return validateConfig({
    ...raw,
    feeds: [{ id: 'one', name: 'One', url: 'https://example.com/rss', site: '', limit: 5 }],
    widgets: [],
  });
}

test('phone settings inherit by default, validate overrides, reconcile deleted items and clamp counts', () => {
  const c = config();
  assert.equal(c.layout.phone.enabled, false);
  const phone = normalizePhoneLayout(
    {
      enabled: true,
      order: ['projects', 'feed-one'],
      hidden: ['weather'],
      limits: { 'feed-one': 3 },
    },
    c,
  );
  assert.deepEqual(phoneOrder({ ...c, layout: { ...c.layout, phone } }).slice(0, 2), [
    'projects',
    'feed-one',
  ]);
  assert.equal(
    normalizePhoneLayout({ ...phone, limits: { 'feed-one': 9 } }, c).limits['feed-one'],
    5,
  );
  const removed = { ...c, feeds: [] };
  const cleaned = normalizePhoneLayout(phone, removed);
  assert.deepEqual(cleaned.order, ['projects']);
  assert.deepEqual(cleaned.limits, {});
  for (const value of [
    null,
    { enabled: 'yes' },
    { enabled: true, order: ['weather', 'weather'] },
    { enabled: true, limits: { 'feed-one': 0 } },
    { enabled: true, limits: { 'feed-one': 1.5 } },
  ])
    assert.throws(() => normalizePhoneLayout(value, c));
  c.layout.phone = phone;
  c.layout.hidden.push('weather');
  const html = renderGroups(c);
  assert.ok(!html.includes('data-module="weather"'));
  assert.match(html, /data-phone-limit="3"/);
  assert.ok(!html.includes('https://example.com/rss'));
});

function dom(t) {
  const { document } = parseHTML(
    '<html data-page-version="' +
      'a'.repeat(20) +
      '-' +
      'b'.repeat(32) +
      '" data-density="compact"><body><main id="board"><section class="board-group"><h2 class="group-title">A</h2><div class="content-board" data-columns="3"><section class="module" data-module="feed-one" data-phone-order="1" data-phone-limit="1"><div class="module-content"><article class="news">One</article><article class="news">Two</article></div></section></div></section><section class="board-group"><div class="content-board" data-columns="2"><section class="module" data-module="weather" data-phone-order="0" data-phone-hidden="true"><div class="module-content">weather</div></section></div></section></main></body></html>',
  );
  let listener;
  const query = {
    matches: true,
    addEventListener: (type, fn) => (listener = fn),
    removeEventListener: () => (listener = null),
  };
  const prev = globalThis.matchMedia;
  globalThis.matchMedia = () => query;
  t.after(() => (globalThis.matchMedia = prev));
  return {
    document,
    query,
    change(value) {
      query.matches = value;
      listener?.();
    },
    hasListener: () => Boolean(listener),
  };
}
test('phone layout changes DOM reading order without cloning; desktop and row counts restore exactly', (t) => {
  const { document, change, hasListener } = dom(t);
  const root = document.querySelector('#board');
  const original = [...root.querySelectorAll('[data-module]')],
    parents = original.map((node) => node.parentNode);
  let changes = 0;
  const stop = setupPhoneLayout(root, () => changes++);
  assert.equal(root.querySelectorAll('[data-module]').length, 2);
  assert.deepEqual(
    [...root.querySelector('.phone-group .content-board').children].map(
      (node) => node.dataset.module,
    ),
    ['weather', 'feed-one'],
  );
  assert.equal(original[1].hidden, true);
  assert.equal(original[0].querySelectorAll('.news')[1].hidden, true);
  const snapshot = captureLayout(document);
  assert.equal(snapshot.groups.length, 1);
  assert.equal(snapshot.groups[0].tiles.length, 1);
  change(false);
  assert.equal(original[0].parentNode, parents[0]);
  assert.equal(original[1].parentNode, parents[1]);
  assert.equal(original[1].hidden, false);
  assert.equal(original[0].querySelectorAll('.news')[1].hidden, false);
  change(true);
  assert.equal(changes, 2);
  stop();
  assert.equal(hasListener(), false);
  assert.equal(root.querySelector('.phone-group'), null);
});

test('phone trimming reapplies to refreshed content without altering desktop results', (t) => {
  const { document } = dom(t);
  const tile = document.querySelector('[data-module="feed-one"]');
  applyPhoneLimit(tile, true);
  assert.equal(tile.querySelectorAll('[data-phone-trimmed]').length, 1);
  tile.querySelector('.module-content').innerHTML =
    '<article class="news">New</article><article class="news">Other</article><article class="news">Third</article>';
  applyPhoneLimit(tile, true);
  assert.equal(tile.querySelectorAll('[data-phone-trimmed]').length, 2);
  applyPhoneLimit(tile, false);
  assert.equal(tile.querySelectorAll('[data-phone-trimmed]').length, 0);
  assert.equal(tile.querySelectorAll('.news').length, 3);
});

test('phone startup prefetch skips hidden modules', async (t) => {
  const { document } = dom(t);
  for (const node of document.querySelectorAll('[data-module]'))
    node.dataset.fragment = '/test/' + node.dataset.module;
  const paths = [];
  await hydrateInitialContent(document, {
    fetcher: async (path) => {
      paths.push(path);
      return new Response('<div data-fragment-result>Ready</div>', {
        headers: { 'Content-Type': 'text/html' },
      });
    },
  });
  assert.deepEqual(paths, ['/test/feed-one']);
});

test('responsive switching preserves unavailable modules and viewport caches remain separate', async (t) => {
  const { rememberLayout, readLayout } = await import('../public/pwa/layout-cache.js');
  const { document, change } = dom(t);
  const root = document.querySelector('#board');
  const values = new Map(),
    storage = {
      getItem: (key) => values.get(key),
      setItem: (key, value) => values.set(key, value),
    };
  const stop = setupPhoneLayout(root);
  rememberLayout(document, { storage, phone: true });
  const phone = readLayout({ storage, phone: true });
  assert.equal(phone.groups.length, 1);
  const tile = root.querySelector('[data-module="feed-one"]');
  tile.dataset.moduleUnavailable = 'true';
  tile.hidden = true;
  change(false);
  assert.equal(tile.hidden, true);
  delete tile.dataset.moduleUnavailable;
  tile.hidden = false;
  rememberLayout(document, { storage, phone: false });
  assert.equal(readLayout({ storage, phone: false }).groups.length, 2);
  assert.deepEqual(readLayout({ storage, phone: true }), phone);
  stop();
});

test('phone numeric drafts survive renaming and reset removes invalid overrides', async (t) => {
  const { mountPhoneEditor } = await import('../public/admin/phone-layout.js');
  const { document, window } = parseHTML('<html><body><div id="editor"></div></body></html>');
  const previous = { document: globalThis.document, Event: globalThis.Event };
  Object.assign(globalThis, { document, Event: window.Event });
  t.after(() => Object.assign(globalThis, previous));
  window.HTMLElement.prototype.setCustomValidity = function (message) {
    this.message = message;
  };
  window.HTMLElement.prototype.checkValidity = function () {
    return !this.message && (!this.min || Number(this.value) >= Number(this.min));
  };
  Object.defineProperty(window.HTMLElement.prototype, 'validity', {
    get() {
      return { valid: this.checkValidity() };
    },
  });
  const c = config();
  c.layout.phone.enabled = true;
  const target = document.querySelector('#editor');
  mountPhoneEditor(target, c);
  let input = target.querySelector('[data-draft-key]');
  input.value = '0';
  input.dispatchEvent(new window.Event('input'));
  c.feeds[0].name = 'Renamed';
  mountPhoneEditor(target, c);
  input = target.querySelector('[data-draft-key]');
  assert.equal(input.value, '0');
  assert.match(input.dataset.draftKey, /phone:feed-one:limit/);
  const reset = [...target.querySelectorAll('button')].find(
    (button) => button.textContent === '恢复继承桌面',
  );
  reset.onclick();
  assert.equal(c.layout.phone.enabled, false);
  c.layout.phone.enabled = true;
  mountPhoneEditor(target, c);
  assert.equal(target.querySelector('[data-draft-key]').value, '');
});
