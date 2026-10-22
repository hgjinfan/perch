import { fragmentFetch as fetch } from './helpers/fragment-fetch.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import { validateConfig } from '../src/config/schema.js';
import { renderHome } from '../src/render/page.js';
import { createApplication } from '../src/application.js';
import { mountModules } from '../public/home/board.js';
import { createLoaders } from '../public/home/loaders.js';

async function fixture() {
  const config = JSON.parse(await readFile(new URL('../config.json', import.meta.url)));
  config.widgets = [
    {
      id: 'visible',
      title: '公开余额',
      type: 'metric',
      source: {
        kind: 'api',
        url: 'https://private-upstream.example/balance',
        headers: { Authorization: 'Bearer private-token' },
      },
      mapping: { value: 'secretField' },
    },
    {
      id: 'hidden',
      title: '隐藏磁块标题',
      type: 'text',
      source: { kind: 'static', data: { text: 'private-body' } },
    },
  ];
  config.services[0].healthUrl = 'http://private-health.example';
  config.feeds[0].url = 'https://private-feed.example/rss?token=secret';
  config.feeds[0].name = '隐藏订阅标题';
  config.bookmarks = [{ name: '隐藏书签名称', url: 'http://private-bookmark.example' }];
  config.projects = [{ name: '隐藏项目名称', url: 'http://private-project.example' }];
  config.layout = {
    density: 'compact',
    hidden: ['feed-hn', 'widget-hidden', 'weather', 'status', 'bookmarks', 'projects'],
  };
  config.titles = { status: '私有状态标题', weather: '私有天气标题' };
  return validateConfig(config);
}

test('Server HTML contains only visible presentation and no configuration payload', async () => {
  const config = await fixture(),
    shell = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const markup = renderHome(config, shell);
  for (const value of [
    'private-upstream',
    'private-token',
    'secretField',
    'private-health',
    'private-feed',
    'private-body',
    'private-bookmark',
    'private-project',
    '隐藏磁块标题',
    '隐藏订阅标题',
    '隐藏书签名称',
    '私有状态标题',
  ])
    assert.ok(!markup.includes(value), value);
  assert.ok(markup.includes('公开余额'));
  assert.ok(markup.includes('data-density="compact"'));
  assert.ok(!markup.includes('/api/config'));
  assert.ok(!markup.includes('latitude'));
  config.layout.hidden = [];
  const visible = renderHome(config, shell);
  assert.ok(!visible.includes(String(config.weather.latitude)));
  config.bookmarks = [{ name: 'bad', url: 'https://user:secret@example.com' }];
  assert.ok(!renderHome(config, shell).includes('user:secret'));
});

test('Hidden module endpoints reject guessed IDs and never invoke their upstream', async (t) => {
  const config = await fixture();
  let calls = 0;
  const server = await createApplication({
    root: fileURLToPath(new URL('../', import.meta.url)),
    store: { get: () => config, revision: 0 },
    env: {},
    fetcher: async () => {
      calls++;
      throw new Error('Unexpected upstream access');
    },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const path of [
    '/fragments/feed-hn',
    '/fragments/widget-hidden',
    '/fragments/status',
    '/fragments/weather',
    '/fragments/weather?city=Shanghai&lat=31&lon=121',
    '/fragments/weather/cities?q=Shanghai',
  ]) {
    for (const method of ['GET', 'HEAD'])
      assert.equal((await fetch(base + path, { method })).status, 404, path);
  }
  assert.equal(calls, 0);
  assert.equal((await fetch(base + '/api/admin/config')).status, 503);
});

test('Frontend omits private modules and their controls, loaders make no hidden requests', async (t) => {
  const { document, window } = parseHTML(
    '<html><body><a class="brand">kyrie</a><main id="board"></main></body></html>',
  );
  const previous = { document: globalThis.document, window: globalThis.window };
  globalThis.document = document;
  globalThis.window = window;
  t.after(() => {
    globalThis.document = previous.document;
    globalThis.window = previous.window;
  });
  const config = await fixture(),
    shell = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  document.body.innerHTML = parseHTML(renderHome(config, shell)).document.body.innerHTML;
  const board = mountModules(document.querySelector('#board'));
  for (const id of ['feed-hn', 'widget-hidden', 'weather', 'status', 'bookmarks', 'projects'])
    assert.equal(board.modules.has(id), false, id);
  assert.equal(document.querySelector('.city-picker'), null);
  assert.equal(document.querySelector('[data-service] .status-dot'), null);
  const loaders = createLoaders(board);
  assert.ok(!loaders.has('weather'));
  assert.ok(!loaders.has('status'));
});
