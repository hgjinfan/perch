import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import { validateConfig } from '../src/config/schema.js';
import { renderHome } from '../src/render/page.js';
import { renderServiceResult } from '../src/render/services.js';
import { describeModules, renderModuleResult } from '../src/render/modules.js';
import { widgetDefinitions } from '../shared/widget-types.js';
import { mountModules } from '../public/home/board.js';
import { createLoaders } from '../public/home/loaders.js';

async function setup(t, change = () => {}) {
  const raw = JSON.parse(await readFile(new URL('../config.json', import.meta.url)));
  change(raw);
  const config = validateConfig(raw),
    shell = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const { document, window } = parseHTML(renderHome(config, shell));
  const storage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const previous = { document: globalThis.document, window: globalThis.window };
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => null, setItem() {}, removeItem() {} },
  });
  globalThis.document = document;
  globalThis.window = window;
  t.after(() => {
    globalThis.document = previous.document;
    globalThis.window = previous.window;
    if (storage) Object.defineProperty(globalThis, 'localStorage', storage);
    else delete globalThis.localStorage;
  });
  const board = mountModules(document.querySelector('#board'));
  const loaders = createLoaders(board);
  const response = (id, result) =>
    new Response(
      id === 'status'
        ? renderServiceResult(config, result)
        : renderModuleResult(
            describeModules(config).find((m) => m.id === id),
            result,
            config,
          ),
      { headers: { 'Content-Type': 'text/html' } },
    );
  return { document, config, ...board, loaders, response };
}

test('First HTML contains typed placeholders, static links and empty states before JS requests', async (t) => {
  const { document, modules, loaders } = await setup(t, (raw) => {
    raw.widgets = Object.entries(widgetDefinitions).map(([type, d]) => ({
      id: type,
      title: d.label,
      type,
      source: { kind: 'static', data: d.example },
      fields: d.fields || [],
    }));
  });
  assert.equal(modules.get('feed-hn').content.querySelectorAll('.skeleton-row').length, 5);
  assert.equal(modules.get('feed-blog').content.querySelector('.skeleton'), null);
  assert.ok(!loaders.has('feed-blog'));
  assert.ok(document.querySelector('.chips a'));
  for (const type of Object.keys(widgetDefinitions))
    assert.ok(modules.get(`widget-${type}`).content.querySelector(`.skeleton-${type}`));
  assert.equal(
    modules.get('weather').content.querySelectorAll('.skeleton-weather-hours > .hourly-point')
      .length,
    12,
  );
  assert.ok(modules.get('weather').content.querySelector('.hourly-detail'));
  assert.equal(modules.get('weather').content.querySelectorAll('.state-label').length, 2);
});

test('HTML fragments settle independently and preserve existing DOM on refresh failures', async (t) => {
  const { modules, loaders, response } = await setup(t);
  let resolve;
  t.mock.method(
    globalThis,
    'fetch',
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const load = loaders.get('feed-hn'),
    target = modules.get('feed-hn').content;
  const first = load();
  assert.equal(target.getAttribute('aria-busy'), 'true');
  resolve(
    response('feed-hn', {
      state: 'ready',
      data: [{ title: '真实文章', url: 'https://example.com/post', date: null }],
    }),
  );
  await first;
  const article = target.querySelector('a');
  assert.equal(article.textContent, '真实文章');
  const refresh = load();
  assert.equal(target.querySelector('a'), article);
  assert.equal(target.querySelector('.skeleton'), null);
  resolve(new Response('', { status: 503 }));
  await refresh;
  assert.equal(target.querySelector('a'), article);
  assert.ok(target.querySelector('.module-load-error'));
  assert.equal(target.getAttribute('aria-busy'), 'false');
});

test('Initial failure replaces skeleton with retry; a failed retry can recover', async (t) => {
  const { modules, loaders, response } = await setup(t);
  let fail = true;
  t.mock.method(globalThis, 'fetch', async () =>
    fail ? new Response('', { status: 503 }) : response('feed-hn', { state: 'ready', data: [] }),
  );
  const target = modules.get('feed-hn').content,
    load = loaders.get('feed-hn');
  await load();
  assert.equal(target.querySelector('.skeleton'), null);
  assert.ok(target.querySelector('.retry'));
  fail = false;
  await load();
  assert.ok(target.textContent.includes('暂无文章'));
  assert.equal(target.getAttribute('aria-busy'), 'false');
});

test('Weather ignores superseded responses and preserves city input, expanded picker and update indicator', async (t) => {
  const { modules, loaders, response } = await setup(t);
  const pending = [];
  t.mock.method(globalThis, 'fetch', () => new Promise((resolve) => pending.push(resolve)));
  const module = modules.get('weather'),
    load = loaders.get('weather'),
    picker = module.node.querySelector('.city-picker'),
    input = picker.querySelector('input');
  picker.open = true;
  input.value = '正在输入';
  const payload = (temperature) =>
    response('weather', {
      state: 'ready',
      location: { name: '上海', source: 'manual' },
      data: {
        current: {
          temperature_2m: temperature,
          apparent_temperature: temperature,
          weather_code: 0,
        },
        hours: [],
      },
    });
  const first = load(),
    second = load();
  pending[0](payload(10));
  await first;
  assert.equal(module.content.getAttribute('aria-busy'), 'true');
  pending[1](payload(20));
  await second;
  const temperature = module.content.querySelector('.temperature');
  assert.equal(temperature.textContent, '20°');
  assert.equal(module.node.querySelector('.city-picker'), picker);
  assert.equal(picker.open, true);
  assert.equal(input.value, '正在输入');
  assert.equal(module.node.querySelector('[data-module-title]').textContent, '上海');
  const refresh = load();
  assert.equal(module.node.querySelector('.module-update').hidden, false);
  pending[2](new Response('', { status: 503 }));
  await refresh;
  assert.equal(module.content.querySelector('.temperature'), temperature);
});

test('Status fragment updates service indicators; custom widgets share server HTML rendering', async (t) => {
  const { config, modules, serviceTiles, loaders, response } = await setup(t, (raw) => {
    raw.services[0].url = 'https://example.com';
    raw.widgets = [
      {
        id: 'balance',
        title: '余额',
        type: 'metric',
        unit: '元',
        source: { kind: 'static', data: { value: 42 } },
      },
    ];
  });
  let fail = false;
  t.mock.method(globalThis, 'fetch', async (path) => {
    if (fail) throw new Error('offline');
    return path === '/fragments/status'
      ? response('status', {
          state: 'ready',
          data: [{ id: 'vaultwarden', state: 'online', latency: 42 }],
        })
      : response('widget-balance', { state: 'ready', data: { value: 42 } });
  });
  await Promise.all([loaders.get('status')(), loaders.get('widget-balance')()]);
  assert.ok(serviceTiles.get('vaultwarden').querySelector('.status-dot.online'));
  const value = modules.get('widget-balance').content.querySelector('.widget-value');
  assert.equal(value.textContent, '42元');
  fail = true;
  await loaders.get('widget-balance')();
  assert.equal(modules.get('widget-balance').content.querySelector('.widget-value'), value);
});

test('A revoked fragment is hidden and stops subsequent requests', async (t) => {
  const { modules, loaders } = await setup(t);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return new Response('', { status: 404 });
  });
  const load = loaders.get('feed-hn');
  await load();
  assert.equal(modules.get('feed-hn').node.hidden, true);
  await load();
  assert.equal(calls, 1);
});
