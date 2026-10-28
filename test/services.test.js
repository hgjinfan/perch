import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import { renderHome } from '../src/render/page.js';
import { renderServiceState, renderServiceResult } from '../src/render/services.js';
import { validateConfig } from '../src/config/schema.js';
import { mountModules } from '../public/home/board.js';
import { createLoaders } from '../public/home/loaders.js';

async function fixture(t) {
  const config = validateConfig(
    JSON.parse(await readFile(new URL('../config.json', import.meta.url))),
  );
  config.services[0].url = 'https://example.com';
  const shell = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const { document, window } = parseHTML(renderHome(config, shell));
  const before = { document: globalThis.document, window: globalThis.window };
  globalThis.document = document;
  globalThis.window = window;
  t.after(() => {
    globalThis.document = before.document;
    globalThis.window = before.window;
  });
  const board = mountModules(document.querySelector('#board'));
  return { config, document, ...board, loaders: createLoaders(board) };
}

test('Service entrance includes status without a duplicate content card; each state is explicit', async (t) => {
  const { document, config } = await fixture(t);
  assert.equal(document.querySelector('.content-board [data-module="status"]'), null);
  assert.ok(document.querySelector('.service-region[data-module="status"]'));
  assert.ok(document.querySelector('.service-freshness-slot > time[hidden]'));

  assert.equal(
    document.querySelector('[data-service="vaultwarden"] .service-health').textContent,
    '检测中',
  );
  assert.equal(
    document.querySelector('[data-service="ntfy"] .service-health').textContent,
    '待配置',
  );
  for (const [item, label] of [
    [{ state: 'online', latency: 42, status: 401 }, '42 ms'],
    [{ state: 'degraded', status: 500 }, 'HTTP 500'],
    [{ state: 'offline' }, '无法连接'],
  ]) {
    const { document: state } = parseHTML(renderServiceState(config.services[0], item));
    assert.equal(state.querySelector('.service-health').textContent, label);
    if (item.status === 401)
      assert.ok(state.querySelector('[data-service-status]').title.includes('需要登录'));
  }
});

test('Refreshing service states preserves the links and keeps failure feedback outside the grid', async (t) => {
  const { document, config, serviceTiles, loaders } = await fixture(t);
  let fail = false;
  t.mock.method(globalThis, 'fetch', async () => {
    if (fail) throw new Error('offline');
    return new Response(
      renderServiceResult(config, {
        state: 'ready',
        data: [{ id: 'vaultwarden', state: 'online', latency: 42 }],
      }),
      { headers: { 'Content-Type': 'text/html' } },
    );
  });
  const tile = serviceTiles.get('vaultwarden'),
    load = loaders.get('status');
  await load();
  assert.equal(tile.querySelector('.service-health').textContent, '42 ms');
  const icon = tile.querySelector('[data-lucide]');
  await load();
  assert.equal(document.querySelector('[data-service="vaultwarden"]'), tile);
  assert.equal(tile.querySelector('[data-lucide]'), icon);
  fail = true;
  await load();
  assert.equal(tile.querySelector('.service-health').textContent, '42 ms');
  assert.ok(tile.querySelector('.service-stale'));
  assert.equal(document.querySelector('.service-grid .module-load-error'), null);
  assert.ok(document.querySelector('[data-load-feedback] .module-load-error button'));
});

test('Disabling status updates retains entrances and stops further polling', async (t) => {
  const { document, loaders } = await fixture(t);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return new Response('', { status: 404 });
  });
  await loaders.get('status')();
  await loaders.get('status')();
  assert.equal(calls, 1);
  assert.ok(document.querySelector('[data-service="vaultwarden"]'));
  assert.equal(document.querySelector('.service-region').hidden, false);
  assert.equal(document.querySelector('[data-service-state-slot]'), null);
});
