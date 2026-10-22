import { fragmentFetch as fetch } from './helpers/fragment-fetch.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import { validateConfig } from '../src/config/schema.js';
import { createApplication } from '../src/application.js';
import { renderHome } from '../src/render/page.js';
import { renderWidget, renderPreview } from '../src/render/widgets.js';
import { describeModules, renderModuleResult, renderCities } from '../src/render/modules.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const raw = async () => JSON.parse(await readFile(new URL('../config.json', import.meta.url)));
test('Server templates escape untrusted text and attributes, including malicious feed titles and city names', async () => {
  const config = validateConfig(await raw());
  config.title = 'Kyrie <script>alert(1)</script> $&';
  config.services[0].name = '<img src=x onerror=alert(1)>';
  config.services[0].url = 'javascript:alert(1)';
  const html = renderHome(
    config,
    await readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
  );
  const doc = parseHTML(html).document;
  assert.equal(doc.querySelector('.brand').textContent, config.title + '/ home');
  assert.equal(doc.querySelector('.brand script'), null);
  assert.equal(doc.querySelector('[data-service] img'), null);
  assert.equal(doc.querySelector('[data-service]').tagName, 'DIV');
  const feed = describeModules(config).find((m) => m.kind === 'feed');
  const fragment = renderModuleResult(
    feed,
    {
      state: 'ready',
      data: [{ title: '<script>bad</script>', url: 'javascript:bad', date: null }],
    },
    config,
  );
  const body = parseHTML(fragment).document;
  assert.equal(body.querySelector('script'), null);
  assert.equal(body.querySelector('[href^="javascript"]'), null);
  assert.ok(body.textContent === null || fragment.includes('&lt;script&gt;'));
  const cities = parseHTML(
    renderCities([
      {
        name: '"><img src=x onerror=bad>',
        latitude: 31,
        longitude: 121,
        timezone: 'Asia/Shanghai',
      },
    ]),
  ).document;
  assert.equal(cities.querySelector('img'), null);
  assert.equal(cities.querySelector('button').dataset.cityName, '"><img src=x onerror=bad>');
});

test('Admin preview and public widget use the same escaped HTML template', async () => {
  const config = validateConfig({
    ...(await raw()),
    widgets: [
      {
        id: 'note',
        title: '笔记',
        type: 'text',
        source: { kind: 'static', data: { text: '<img src=x>' } },
      },
    ],
  });
  const widget = config.widgets[0],
    data = widget.source.data,
    component = renderWidget(widget, data);
  assert.ok(renderPreview(widget, data).includes(component));
  assert.ok(
    renderModuleResult(
      describeModules(config).find((m) => m.id === 'widget-note'),
      { state: 'ready', data },
      config,
    ).includes(component),
  );
  assert.ok(!component.includes('<img'));
});

test('Public HTTP uses HTML, disables legacy JSON, and keeps sensitive configuration off the page', async (t) => {
  const config = validateConfig({
    ...(await raw()),
    widgets: [
      {
        id: 'note',
        title: '笔记',
        type: 'text',
        source: { kind: 'static', data: { text: 'Hello world', secret: 'private-payload' } },
      },
    ],
  });
  config.feeds[0].url = 'https://private-rss.example/?token=hidden-token';
  const server = await createApplication({
    root,
    store: { get: () => config, revision: 0 },
    env: {},
    fetcher: async () =>
      new Response(
        '<rss><channel><item><title>Hello RSS</title><link>https://example.com/post</link></item></channel></rss>',
      ),
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const page = await fetch(base + '/'),
    markup = await page.text();
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  assert.ok(markup.includes('data-module="feed-hn"'));
  assert.ok(markup.includes('skeleton-list'));
  assert.ok(!markup.includes('private-rss'));
  assert.ok(!markup.includes('hidden-token'));
  assert.ok(!markup.includes('private-payload'));
  const response = await fetch(base + '/fragments/widget-note'),
    fragment = await response.text();
  assert.match(response.headers.get('content-type'), /text\/html/);
  assert.ok(fragment.includes('Hello world'));
  assert.ok(!fragment.includes('private-payload'));
  for (const path of [
    '/api/config',
    '/api/feed/hn',
    '/api/widget/note',
    '/api/status',
    '/api/weather',
  ])
    assert.equal((await fetch(base + path)).status, 404, path);
  const head = await fetch(base + '/', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
});

test('A widget hidden during an in-flight request cannot return its rendered data', async (t) => {
  let config = validateConfig({
    ...(await raw()),
    widgets: [
      {
        id: 'slow',
        title: '慢接口',
        type: 'metric',
        source: { kind: 'api', url: 'https://example.com/stats' },
      },
    ],
  });
  let release, started;
  const pending = new Promise((resolve) => {
    started = resolve;
  });
  const server = await createApplication({
    root,
    store: { get: () => config, revision: 0 },
    env: {},
    fetcher: () =>
      new Promise((resolve) => {
        release = resolve;
        started();
      }),
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = fetch(`http://127.0.0.1:${server.address().port}/fragments/widget-slow`);
  await pending;
  config = { ...config, layout: { ...config.layout, hidden: ['widget-slow'] } };
  release(new Response('{"value":123456}'));
  const result = await response;
  assert.equal(result.status, 404);
  assert.ok(!(await result.text()).includes('123456'));
});
