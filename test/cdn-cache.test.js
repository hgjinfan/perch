import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createApplication } from '../src/application.js';
import { validateConfig } from '../src/config/schema.js';
import { createConfigWatcher } from '../public/home/config-updates.js';
import { synchronizePage, pageDocumentUrl } from '../public/home/page-sync.js';
import { DOMParser, parseHTML } from 'linkedom';

test('config namespace isolates cached fragments; dynamic cache headers and weather privacy are explicit', async (t) => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  let config = validateConfig({
    ...JSON.parse(await readFile(root + '/config.json', 'utf8')),
    feeds: [
      {
        id: 'demo',
        name: 'Demo',
        url: 'https://example.com/rss',
        site: 'https://example.com/',
        limit: 5,
      },
    ],
    widgets: [
      {
        id: 'note',
        title: 'Note',
        type: 'text',
        source: { kind: 'static', data: { text: 'one' } },
      },
    ],
    weather: {
      name: 'London',
      latitude: 51.5,
      longitude: -0.1,
      timezone: 'Europe/London',
      mode: 'ip',
    },
  });
  const store = { get: () => config, revision: 0 };
  let calls = 0;
  const server = await createApplication({
    root,
    store,
    env: {},
    fetcher: async (url) => {
      calls++;
      if (url.includes('geocoding-api')) return Response.json({ results: [] });
      if (url.includes('api.open-meteo'))
        return Response.json({
          current: { time: '2026-10-23T10:00', temperature_2m: 15, apparent_temperature: 14 },
          hourly: { time: ['2026-10-23T11:00'], temperature_2m: [16] },
        });
      return new Response(
        '<rss><channel><item><title>Demo story</title><link>https://example.com/story</link></item></channel></rss>',
      );
    },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const page = await fetch(base),
    markup = await page.text();
  assert.equal(page.headers.get('cache-control'), 'no-store');
  const version = markup.match(/data-page-version="([a-f0-9-]+)"/)[1];
  const prefix = '/fragments/' + version.replace('-', '/');
  const fragment = await fetch(base + prefix + '/feed-demo');
  assert.match(fragment.headers.get('cache-control'), /public.*s-maxage=60/);
  assert.ok(!fragment.headers.get('cache-control').includes('immutable'));
  const etag = fragment.headers.get('etag');
  assert.ok(etag);
  assert.equal(
    (await fetch(base + prefix + '/feed-demo', { headers: { 'If-None-Match': etag } })).status,
    304,
  );
  assert.equal(calls, 1);
  const head = await fetch(base + prefix + '/feed-demo', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  for (const conditional of ['*', `W/${etag}`, `"other", W/${etag}`])
    assert.equal(
      (await fetch(base + prefix + '/feed-demo', { headers: { 'If-None-Match': conditional } }))
        .status,
      304,
    );
  const widget = await fetch(base + prefix + '/widget-note');
  assert.match(widget.headers.get('cache-control'), /s-maxage=60/);
  const status = await fetch(base + prefix + '/status');
  assert.match(status.headers.get('cache-control'), /s-maxage=15/);
  const weather = await fetch(base + prefix + '/weather');
  assert.equal(weather.status, 200);
  assert.equal(weather.headers.get('cache-control'), 'no-store');
  const cities = await fetch(base + prefix + '/weather/cities?q=London');
  assert.equal(cities.status, 200);
  assert.equal(cities.headers.get('cache-control'), 'no-store');
  config = validateConfig({ ...config, title: 'New config' });
  store.revision++;
  const old = await fetch(base + prefix + '/feed-demo');
  assert.equal(old.status, 409);
  assert.equal(old.headers.get('cache-control'), 'no-store');
  assert.equal(old.headers.get('x-homepage-reload'), '1');
  const latest = await fetch(base + '/page/latest');
  assert.equal(latest.headers.get('cache-control'), 'no-store');
  const current = (await latest.text()).match(/data-page-version="([a-f0-9-]+)"/)[1];
  assert.notEqual(current, version);
  assert.ok(latest.url.endsWith(pageDocumentUrl(current)));
  assert.equal((await fetch(base + '/page-version')).headers.get('cache-control'), 'no-store');
});

test('a synchronized watcher adopts the new revision and continues watching later saves', async () => {
  const asset = 'a'.repeat(20),
    versions = ['1', '2', '3'].map((char) => asset + '-' + char.repeat(32));
  let clock = 0,
    index = 1;
  const received = [];
  const watcher = createConfigWatcher({
    baseline: versions[0],
    now: () => clock,
    active: () => true,
    interval: 10000,
    fetcher: async (_, options) => {
      received.push(options.headers['If-None-Match']);
      return new Response(null, { status: 204, headers: { ETag: `"${versions[index]}"` } });
    },
    onChange: async () => 'synced',
  });
  await watcher.check();
  clock = 10001;
  index = 2;
  await watcher.check();
  assert.deepEqual(received, [`"${versions[0]}"`, `"${versions[1]}"`]);
});

test('live document synchronization validates revision, preserves theme, and remounts server markup', async (t) => {
  const previous = globalThis.DOMParser;
  globalThis.DOMParser = DOMParser;
  t.after(() => {
    globalThis.DOMParser = previous;
  });
  const { document } = parseHTML(
    '<html data-theme="dark"><head><title>Old</title></head><body><a class="brand">Old</a><time id="date"></time><main id="board"><p>old</p></main></body></html>',
  );
  const version = 'a'.repeat(20) + '-' + '2'.repeat(32);
  let mounts = 0;
  const markup = `<html data-page-version="${version}" data-density="compact"><head><title>New</title></head><body><a class="brand">New</a><time id="date" data-timezone="UTC"></time><main id="board"><section data-fragment="/new-fragment">New content</section></main></body></html>`;
  const options = {
    host: document,
    mount: () => {
      mounts++;
    },
    fetcher: async (path) => {
      assert.equal(path, pageDocumentUrl(version));
      return new Response(markup, { headers: { 'Content-Type': 'text/html' } });
    },
  };
  assert.equal(await synchronizePage(version, options), true);
  assert.equal(document.querySelector('#board').textContent, 'New content');
  assert.equal(document.documentElement.dataset.theme, 'dark');
  assert.equal(mounts, 1);
  const other = 'a'.repeat(20) + '-' + '3'.repeat(32);
  assert.equal(
    await synchronizePage(other, {
      ...options,
      fetcher: async () => new Response(markup, { headers: { 'Content-Type': 'text/html' } }),
    }),
    false,
  );
  assert.equal(mounts, 1);
});

test('deferred synchronization retries, and focused tile input prevents replacement', async (t) => {
  const previous = globalThis.DOMParser;
  globalThis.DOMParser = DOMParser;
  t.after(() => {
    globalThis.DOMParser = previous;
  });
  const { document } = parseHTML(
    '<html><body><main id="board"><input id="city" value="editing"></main></body></html>',
  );
  Object.defineProperty(document, 'activeElement', { value: document.querySelector('input') });
  const version = 'a'.repeat(20) + '-' + '2'.repeat(32);
  const markup = `<html data-page-version="${version}"><body><main id="board">new</main></body></html>`;
  assert.equal(
    await synchronizePage(version, {
      host: document,
      mount: () => assert.fail(),
      fetcher: async () => new Response(markup, { headers: { 'Content-Type': 'text/html' } }),
    }),
    false,
  );
  assert.equal(document.querySelector('input').value, 'editing');
  let clock = 0,
    attempts = 0;
  const watcher = createConfigWatcher({
    baseline: 'a'.repeat(20) + '-' + '1'.repeat(32),
    active: () => true,
    now: () => clock,
    interval: 10000,
    fetcher: async () => new Response(null, { status: 204, headers: { ETag: `"${version}"` } }),
    onChange: async () => {
      attempts++;
      return false;
    },
  });
  await watcher.check();
  clock = 10001;
  await watcher.check();
  assert.equal(attempts, 2);
});

test('the same config URL may change data; stale responses never enter shared cache', async () => {
  const { createPublicRoutes } = await import('../src/routes/public.js');
  const root = fileURLToPath(new URL('../', import.meta.url));
  const config = validateConfig({
    ...JSON.parse(await readFile(root + '/config.json', 'utf8')),
    feeds: [{ id: 'demo', name: 'Demo', url: 'https://example.com/rss', site: '', limit: 5 }],
  });
  let state = 'ready',
    title = 'First';
  const routes = createPublicRoutes({
    store: { get: () => config },
    assets: { version: 'a'.repeat(20) },
    shell: '',
    dashboard: {
      feed: async () => ({
        state,
        data: [{ title, url: 'https://example.com/story', date: null }],
      }),
    },
  });
  async function send(path, headers = {}) {
    const result = {};
    await routes(
      path,
      { method: 'GET', headers, url: path },
      {
        writeHead(code, value) {
          result.status = code;
          result.headers = value;
        },
        end(body) {
          result.body = body;
        },
      },
    );
    return result;
  }
  const token = (await send('/page-version')).headers.ETag.slice(1, -1).replace('-', '/');
  const path = '/fragments/' + token + '/feed-demo';
  const first = await send(path);
  title = 'Second';
  const second = await send(path, { 'if-none-match': first.headers.ETag });
  assert.equal(second.status, 200);
  assert.notEqual(second.headers.ETag, first.headers.ETag);
  assert.ok(second.body.includes('Second'));
  state = 'stale';
  const stale = await send(path);
  assert.equal(stale.headers['Cache-Control'], 'no-store');
  assert.equal(stale.headers.ETag, undefined);
});
