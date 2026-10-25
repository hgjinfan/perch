import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { validateConfig } from '../src/config/schema.js';
import { renderGroups } from '../src/render/groups.js';
import { renderServiceGrid } from '../src/render/services.js';
import { checkService } from '../src/data.js';
import { setupGroupCollapse, restoreGroupCollapse } from '../public/home/group-collapse.js';
import { setupServiceRoutes } from '../public/home/service-routes.js';
import { hydrateInitialContent } from '../public/pwa/initial-content.js';
import { compareConfigs } from '../src/config/diff.js';
const raw = JSON.parse(await readFile(fileURLToPath(new URL('../config.json', import.meta.url))));
function store() {
  const values = new Map();
  return { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) };
}

test('dual service addresses validate and render safely, health URL stays server-side', async () => {
  const config = validateConfig({
    ...raw,
    services: [
      {
        id: 'dual',
        name: 'Dual',
        url: 'https://public.example',
        internalUrl: 'http://192.168.1.10:8080',
        healthUrl: 'http://health.private/check',
      },
      { id: 'local', name: 'Local', url: '', internalUrl: 'http://local.example' },
    ],
  });
  const markup = renderServiceGrid(config);
  assert.match(markup, /data-service-route/);
  assert.match(markup, /data-internal-url="http:\/\/192.168.1.10:8080\//);
  assert.ok(!markup.includes('health.private'));
  assert.match(markup, /href="http:\/\/local.example\//);
  let requested;
  await checkService(config.services[0], async (url) => {
    requested = url;
    return new Response('');
  });
  assert.equal(requested, 'http://health.private/check');
  await checkService(config.services[1], async (url) => {
    requested = url;
    return new Response('');
  });
  assert.equal(requested, 'http://local.example/');
  assert.throws(() =>
    validateConfig({
      ...config,
      services: [{ ...config.services[0], internalUrl: 'javascript:alert(1)' }],
    }),
  );
  const diff = compareConfigs(config, {
    ...config,
    services: [{ ...config.services[0], internalUrl: 'http://secret.internal' }],
  });
  assert.ok(!JSON.stringify(diff).includes('secret.internal'));
});

test('route preference switches real links, falls back and survives remount without saving URLs', (t) => {
  const config = validateConfig({
    ...raw,
    services: [
      {
        id: 'dual',
        name: 'Dual',
        url: 'https://public.example',
        internalUrl: 'http://local.example',
      },
      { id: 'single', name: 'Single', url: 'https://single.example' },
    ],
  });
  const { document, window } = parseHTML(
    '<html data-base-path="/perch"><body><main>' +
      renderServiceGrid(config) +
      '</main></body></html>',
  );
  Object.defineProperty(window.HTMLSelectElement.prototype, 'value', {
    configurable: true,
    get() {
      return this.querySelector('option[selected]')?.value || '';
    },
    set(value) {
      for (const option of this.querySelectorAll('option'))
        option.toggleAttribute('selected', option.value === value);
    },
  });
  const root = document.querySelector('main'),
    storage = store();
  const stop = setupServiceRoutes(root, storage);
  const control = root.querySelector('select');
  control.value = 'internal';
  control.onchange();
  assert.equal(
    root.querySelector('[data-service="dual"]').getAttribute('href'),
    'http://local.example/',
  );
  assert.equal(
    root.querySelector('[data-service="single"]').getAttribute('href'),
    'https://single.example/',
  );
  assert.equal(storage.getItem('perch-service-route-v1:/perch'), 'internal');
  stop();
  setupServiceRoutes(root, storage);
  assert.equal(control.value, 'internal');
  assert.doesNotThrow(() =>
    setupServiceRoutes(root, {
      getItem() {
        throw Error('blocked');
      },
      setItem() {
        throw Error('blocked');
      },
    }),
  );
});

test('named groups use accessible details; collapse preferences survive remount and skip startup requests', async (t) => {
  const config = validateConfig({
    ...raw,
    feeds: [{ id: 'one', name: 'One', url: 'https://example.com/feed', site: '', limit: 5 }],
    layout: {
      density: 'comfortable',
      hidden: [],
      groups: [{ id: 'news', title: 'News', columns: 2, items: [{ id: 'feed-one', span: 1 }] }],
    },
  });
  const { document, window } = parseHTML(
    '<html><body><main>' + renderGroups(config) + '</main></body></html>',
  );
  Object.defineProperty(window.HTMLElement.prototype, 'open', {
    configurable: true,
    get() {
      return this.hasAttribute('open');
    },
    set(value) {
      this.toggleAttribute('open', value);
    },
  });
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const storage = store();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: storage,
  });
  t.after(() =>
    previous
      ? Object.defineProperty(globalThis, 'localStorage', previous)
      : delete globalThis.localStorage,
  );
  const root = document.querySelector('main');
  let changes = 0;
  const stop = setupGroupCollapse(root, () => changes++);
  const group = root.querySelector('details');
  assert.ok(group.querySelector('summary'));
  assert.equal(group.hasAttribute('open'), true);
  group.open = false;
  group.dispatchEvent(new window.Event('toggle'));
  assert.equal(changes, 1);
  assert.equal(storage.getItem('perch-group-collapse-v1:'), '{"news":true}');
  group.open = true;
  restoreGroupCollapse(root, storage);
  assert.equal(group.open, false);
  const calls = [];
  await hydrateInitialContent(document, {
    fetcher: async (path) => {
      calls.push(path);
      return new Response('');
    },
  });
  assert.deepEqual(calls, []);
  stop();
});
