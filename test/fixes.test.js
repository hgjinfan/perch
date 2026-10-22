import { fragmentFetch as fetch } from './helpers/fragment-fetch.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parse, init } from 'es-module-lexer/minimal';
import { createAssets } from '../src/assets.js';
import { createApplication } from '../src/application.js';
import { validateConfig } from '../src/config/schema.js';
import { createAdminGuard } from '../src/security.js';
import { createConfigStore } from '../src/config/store.js';
import { randomUUID } from 'node:crypto';
import { parseHTML } from 'linkedom';
import { mountWidgetPreview } from '../public/admin/widget-preview.js';
import { createWeatherService } from '../src/services/weather.js';
import { createRequestLimiter, createUpstreamBudget } from '../src/request-budget.js';

test('R7: immutable assets have validators and return bodyless 304; private assets remain no-store', async () => {
  const assets = await createAssets(root);
  const first = await asset(assets, assets.urlFor('/styles.css'));
  assert.ok(first.headers.ETag);
  assert.ok(first.headers['Cache-Control'].includes('immutable'));
  let status, body;
  await assets.send(
    assets.urlFor('/styles.css'),
    { method: 'GET', headers: { 'if-none-match': first.headers.ETag } },
    {
      writeHead(code) {
        status = code;
      },
      end(value) {
        body = value;
      },
    },
  );
  assert.equal(status, 304);
  assert.equal(body, undefined);
  const privateAsset = await asset(assets, assets.urlFor('/admin.js'));
  assert.equal(privateAsset.headers['Cache-Control'], 'no-store');
  assert.equal(privateAsset.headers.ETag, undefined);
});

test('R8: limiter returns retry timing and independently tracks clients', () => {
  let now = 0;
  const check = createRequestLimiter({ limit: 2, now: () => now });
  check('a');
  check('a');
  assert.throws(
    () => check('a'),
    (error) => error.status === 429 && error.retryAfter === 60,
  );
  assert.doesNotThrow(() => check('b'));
  now = 60001;
  assert.doesNotThrow(() => check('a'));
});

test('R8: upstream work is bounded, queued work drains, and excess work is rejected', async () => {
  const budget = createUpstreamBudget({ concurrency: 2, maxQueue: 1 });
  let active = 0,
    peak = 0;
  const releases = [];
  const task = () => {
    active++;
    peak = Math.max(peak, active);
    return new Promise((resolve) =>
      releases.push(() => {
        active--;
        resolve('ok');
      }),
    );
  };
  const a = budget.run('provider', task),
    b = budget.run('provider', task),
    c = budget.run('provider', task);
  await assert.rejects(budget.run('provider', task), (error) => error.status === 503);
  assert.equal(releases.length, 2);
  releases[0]();
  await a;
  assert.equal(releases.length, 3);
  releases[1]();
  releases[2]();
  await Promise.all([b, c]);
  assert.equal(peak, 2);
});

test('R8: provider rate failures trigger only that provider cooldown', async () => {
  let now = 0,
    calls = 0;
  const budget = createUpstreamBudget({ now: () => now });
  await assert.rejects(
    budget.run('limited', async () => {
      calls++;
      throw new Error('HTTP 429');
    }),
  );
  await assert.rejects(
    budget.run('limited', async () => {
      calls++;
    }),
  );
  assert.equal(calls, 1);
  assert.equal(await budget.run('healthy', async () => 'ok'), 'ok');
  now = 31000;
  assert.equal(await budget.run('limited', async () => 'recovered'), 'recovered');
});

test('R8: weather search enforces per-visitor limits through a trusted proxy', async (t) => {
  const value = await config();
  const server = await createApplication({
    root,
    store: { get: () => value, revision: 0 },
    env: { TRUST_PROXY_HOPS: '1', CITY_SEARCH_RATE_LIMIT: '2' },
    fetcher: async () => new Response('{"results":[]}'),
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/fragments/weather/cities?q=Paris`,
    headers = { 'X-Forwarded-For': '8.8.8.8' };
  assert.equal((await fetch(url, { headers })).status, 200);
  assert.equal((await fetch(url, { headers })).status, 200);
  const limited = await fetch(url, { headers });
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
  assert.equal((await fetch(url, { headers: { 'X-Forwarded-For': '1.1.1.1' } })).status, 200);
});

test('R5: malformed current weather fails closed and retains last good forecast on refresh', async () => {
  let now = 0,
    valid = true;
  const service = createWeatherService({
    now: () => now,
    fetcher: async () =>
      new Response(
        JSON.stringify({
          current: {
            time: '2026-10-22T10:00',
            ...(valid ? { temperature_2m: 20, apparent_temperature: 19 } : {}),
          },
          hourly: { time: ['2026-10-22T11:00'], temperature_2m: [21] },
        }),
      ),
  });
  const city = {
      mode: 'fixed',
      name: 'Test',
      latitude: 1,
      longitude: 1,
      timezone: 'Asia/Shanghai',
    },
    request = { url: '/fragments/weather', headers: {}, socket: { remoteAddress: '127.0.0.1' } };
  const first = await service.get(city, request);
  assert.equal(first.state, 'ready');
  assert.equal(first.data.current.temperature_2m, 20);
  now = 900001;
  valid = false;
  const stale = await service.get(city, request);
  assert.equal(stale.state, 'stale');
  assert.equal(stale.data.current.temperature_2m, 20);
  const fresh = createWeatherService({
    fetcher: async () =>
      new Response(
        '{"current":{"time":"2026-10-22T10:00"},"hourly":{"time":[],"temperature_2m":[]}}',
      ),
  });
  assert.equal((await fresh.get(city, request)).state, 'error');
});

test('R3: stale config snapshots cannot overwrite a later save; missing version is rejected', async () => {
  const store = await createConfigStore({
    statePath: '/private/tmp/' + randomUUID() + '.json',
    configPath: root + 'config.json',
    persist: async () => {},
  });
  const initial = store.version,
    a = structuredClone(store.get()),
    b = structuredClone(store.get());
  b.title = 'B saved';
  await store.save(b, initial);
  a.title = 'A stale';
  await assert.rejects(store.save(a, initial), (error) => error.status === 409);
  assert.equal(store.get().title, 'B saved');
  await assert.rejects(store.save(a), (error) => error.status === 428);
  await store.save(a, store.version);
  assert.equal(store.get().title, 'A stale');
});

test('R4: editing during preview invalidates the pending snapshot and discards stale success', async (t) => {
  const { document, window } = parseHTML('<html><body><div id="controls"></div></body></html>');
  const previous = { document: globalThis.document, window: globalThis.window };
  globalThis.document = document;
  globalThis.window = window;
  t.after(() => Object.assign(globalThis, previous));
  const controls = document.querySelector('#controls'),
    widget = { title: 'Old', type: 'metric', source: { kind: 'static', data: { value: 42 } } };
  let release;
  t.mock.method(
    globalThis,
    'fetch',
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  mountWidgetPreview(controls, widget, () => {});
  const preview = controls.querySelector('button'),
    pending = preview.onclick();
  widget.title = 'New';
  controls.dispatchEvent(new window.Event('input', { bubbles: true }));
  release(new Response('<h3>Old</h3>', { headers: { 'Content-Type': 'text/html' } }));
  await pending;
  assert.equal(controls.querySelector('.widget-preview').hidden, true);
  assert.ok(controls.querySelector('[role="status"]').textContent.includes('重新测试'));
  assert.equal(preview.disabled, false);
});

test('R2: trusted-proxy clients have separate login buckets; untrusted forwarding cannot bypass a bucket', () => {
  const guard = createAdminGuard({ password: 'test-secret', trustProxyHops: 1 });
  const response = { setHeader() {} };
  const request = (ip, password) => ({
    socket: { remoteAddress: '127.0.0.1' },
    headers: {
      'x-forwarded-for': ip,
      authorization: 'Basic ' + Buffer.from('admin:' + password).toString('base64'),
    },
  });
  for (let i = 0; i < 10; i++)
    assert.throws(
      () => guard(request('8.8.8.8', 'wrong'), response),
      (error) => error.status === 401,
    );
  assert.doesNotThrow(() => guard(request('1.1.1.1', 'test-secret'), response));
  assert.throws(
    () => guard(request('8.8.8.8', 'test-secret'), response),
    (error) => error.status === 429,
  );
  const direct = createAdminGuard({ password: 'test-secret' });
  for (let i = 0; i < 10; i++) assert.throws(() => direct(request('8.8.8.8', 'wrong'), response));
  assert.throws(
    () => direct(request('1.1.1.1', 'test-secret'), response),
    (error) => error.status === 429,
  );
});

const root = fileURLToPath(new URL('../', import.meta.url));
const config = async () => validateConfig(JSON.parse(await readFile(root + 'config.json', 'utf8')));
async function asset(assets, path) {
  let body, status, headers;
  await assets.send(
    path,
    { method: 'GET' },
    {
      writeHead(code, value) {
        status = code;
        headers = value;
      },
      end(value) {
        body = value.toString();
      },
    },
  );
  return { body, status, headers };
}

test('R1: every reachable module import stays in the same immutable asset namespace', async () => {
  const assets = await createAssets(root),
    pending = ['/app.js', '/admin.js'],
    seen = new Set();
  await init();
  while (pending.length) {
    const path = pending.pop();
    if (seen.has(path)) continue;
    seen.add(path);
    const { body } = await asset(assets, assets.urlFor(path));
    for (const item of parse(body)[0]) {
      if (!item.n) continue;
      assert.ok(item.n.startsWith(`/assets/${assets.version}/`), `${path} -> ${item.n}`);
      pending.push(item.n.slice(`/assets/${assets.version}`.length));
    }
  }
  assert.ok(seen.has('/shared/url.js'));
  assert.ok(seen.has('/shared/widget-types.js'));
  await assert.rejects(asset(assets, '/assets/00000000000000000000/app.js'));
  assert.ok(assets.homeShell.includes(assets.urlFor('/app.js')));
});

test('R1: new navigation is stamped with a matching fragment version; old versions are rejected', async (t) => {
  const value = await config(),
    store = { get: () => value, revision: 0 };
  const server = await createApplication({ root, store, env: {} });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const markup = await (await fetch(base + '/')).text(),
    version = markup.match(/data-asset-version="([a-f0-9]{20})"/)[1];
  assert.ok(markup.includes(`/assets/${version}/app.js`));
  assert.ok(markup.includes(`/fragments/${version}/status`));
  const legacy = await globalThis.fetch(base + '/fragments/status');
  assert.equal(legacy.status, 409);
  assert.equal(legacy.headers.get('x-homepage-reload'), '1');
  const old = await fetch(base + '/fragments/00000000000000000000/status');
  assert.equal(old.status, 409);
  assert.equal(old.headers.get('x-homepage-reload'), '1');
});
