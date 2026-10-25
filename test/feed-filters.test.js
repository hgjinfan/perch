import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseFeed } from '../src/data.js';
import { normalizeFeedFilters, parseFeedKeywords } from '../shared/feed-filters.js';
import { validateConfig } from '../src/config/schema.js';
import { parseBackup, createBackup } from '../src/config/backups.js';
import { createDashboardService } from '../src/services/dashboard.js';
import { describeModules, renderModuleResult } from '../src/render/modules.js';
const xml =
  '<rss><channel>' +
  [
    ['广告推荐', 'https://example.com/ad', '2026-10-25T10:00:00Z'],
    ['Vue 入门', 'https://example.com/vue', '2026-10-20T10:00:00Z'],
    ['Node 实战', 'https://example.com/node#one', '2026-10-21T10:00:00Z'],
    ['NODE 实战更新', 'https://example.com/node#two', '2026-10-24T10:00:00Z'],
    ['Node 广告', 'https://example.com/sponsor', '2026-10-25T10:00:00Z'],
    ['Ｖｕｅ Node 深入', 'https://example.com/both', ''],
    ['Node 参数 A', 'https://example.com/article?id=1', ''],
    ['Node 参数 B', 'https://example.com/article?id=2', ''],
  ]
    .map(
      ([title, url, date]) =>
        `<item><title>${title}</title><link>${url}</link>${date ? `<pubDate>${date}</pubDate>` : ''}</item>`,
    )
    .join('') +
  '</channel></rss>';
const raw = JSON.parse(await readFile(fileURLToPath(new URL('../config.json', import.meta.url))));
const feed = { id: 'filter', name: 'RSS', url: 'https://example.com/feed', site: '', limit: 2 };

test('title filters run before limit with case folding, any/all matching and exclusion precedence', () => {
  assert.deepEqual(
    parseFeed(xml, 2).map((e) => e.title),
    ['广告推荐', 'Vue 入门'],
  );
  assert.deepEqual(
    parseFeed(xml, 2, { include: ['Node'], exclude: ['广告'] }).map((e) => e.title),
    ['Node 实战', 'NODE 实战更新'],
  );
  assert.deepEqual(
    parseFeed(xml, 20, { include: ['vue', 'node'], match: 'all' }).map((e) => e.title),
    ['Ｖｕｅ Node 深入'],
  );
  assert.equal(parseFeed(xml, 20, { include: ['node'], exclude: ['NODE'] }).length, 0);
  assert.equal(parseFeed(xml, 20, { include: ['.*'] }).length, 0, 'patterns are literal text');
});

test('sort and deduplication retain newest duplicate, place absent dates last and preserve distinct queries', () => {
  const entries = parseFeed(xml, 20, {
    include: ['node'],
    exclude: ['广告'],
    sort: 'newest',
    deduplicate: true,
  });
  assert.deepEqual(
    entries.map((e) => e.title),
    ['NODE 实战更新', 'Ｖｕｅ Node 深入', 'Node 参数 A', 'Node 参数 B'],
  );
  assert.equal(parseFeed(xml, 20, { include: ['node'], deduplicate: false }).length, 6);
  assert.equal(parseFeed(xml, 20, { include: ['node'], deduplicate: true })[0].title, 'Node 实战');
  const atom =
    '<feed><entry><title>Rust 新闻</title><link href="https://example.com/a"/></entry><entry><title>Node 新闻</title><link href="https://example.com/b"/></entry></feed>';
  assert.equal(parseFeed(atom, 1, { include: ['node'] })[0].title, 'Node 新闻');
});

test('filter validation rejects malformed settings and normalization survives saves/backups', () => {
  assert.deepEqual(parseFeedKeywords(' Node,Vue，数据库\n性能 '), [
    'Node',
    'Vue',
    '数据库',
    '性能',
  ]);
  assert.deepEqual(normalizeFeedFilters({ include: ['Node', 'node', 'Ｎｏｄｅ'] }).include, [
    'Node',
  ]);
  for (const options of [
    null,
    [],
    { include: 'node' },
    { include: [''] },
    { include: ['a'.repeat(81)] },
    { include: ['ﬄ'.repeat(80)] },
    { exclude: Array(21).fill('x') },
    { sort: 'oldest' },
    { match: 'regex' },
    { deduplicate: 'true' },
  ])
    assert.throws(() => normalizeFeedFilters(options));
  const config = validateConfig({
    ...raw,
    feeds: [
      {
        ...feed,
        filters: { include: ['Node'], exclude: ['广告'], sort: 'newest', deduplicate: true },
      },
    ],
  });
  assert.deepEqual(parseBackup(createBackup(config)).feeds[0].filters, config.feeds[0].filters);
  assert.deepEqual(
    validateConfig({ ...raw, feeds: [feed] }).feeds[0].filters,
    normalizeFeedFilters(),
  );
});

test('filter changes invalidate only corresponding feed; names/layout retain cache; empty matches stay ready', async () => {
  let config = validateConfig({ ...raw, feeds: [feed, { ...feed, id: 'other' }] }),
    revision = 0,
    calls = 0;
  const service = createDashboardService(
    {
      get: () => config,
      get revision() {
        return revision;
      },
    },
    {
      fetcher: async () => {
        calls++;
        return new Response(xml);
      },
      env: {},
    },
  );
  await service.feed('filter');
  await service.feed('other');
  assert.equal(calls, 2);
  config = structuredClone(config);
  config.feeds[0].name = 'Renamed';
  revision++;
  await service.feed('filter');
  assert.equal(calls, 2);
  config = structuredClone(config);
  config.feeds[0].filters.include = ['does not exist'];
  revision++;
  const result = await service.feed('filter');
  await service.feed('other');
  assert.equal(calls, 3);
  assert.equal(result.state, 'ready');
  assert.deepEqual(result.data, []);
  const module = describeModules(config).find((m) => m.id === 'feed-filter');
  const html = renderModuleResult(module, result, config);
  assert.match(html, /暂无符合条件/);
  assert.ok(!html.includes('does not exist'));
});
