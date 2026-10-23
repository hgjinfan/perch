import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { hydrateInitialContent } from '../public/pwa/initial-content.js';
import { createLoaders } from '../public/home/loaders.js';
import { mountModules } from '../public/home/board.js';
import { updateFreshness } from '../public/home/freshness.js';
import { applyFragment, parseFragment } from '../public/home/fragment-content.js';
import { renderServiceGrid, renderServiceResult } from '../src/render/services.js';

function config() {
  return {
    services: [{ id: 'service', name: 'Service', url: 'https://example.com/', icon: 'server' }],
    layout: { hidden: [] },
  };
}
test('PWA prefetch updates the detached module timestamp, not the visible launcher document', async (t) => {
  const visible = parseHTML(
    '<html><body><time id="service-freshness" hidden datetime="2000-01-01T00:00:00Z"></time></body></html>',
  ).document;
  const parsed = parseHTML(
    `<html><body><main id="board">${renderServiceGrid(config())}</main></body></html>`,
  ).document;
  const previous = { document: globalThis.document, fetch: globalThis.fetch };
  Object.assign(globalThis, {
    document: visible,
    fetch: () => assert.fail('prefetched service must skip the initial duplicate fetch'),
  });
  t.after(() => Object.assign(globalThis, previous));
  const updatedAt = new Date().toISOString();
  const data = renderServiceResult(config(), {
    state: 'ready',
    updatedAt,
    data: [{ id: 'service', state: 'online', latency: 12, status: 200 }],
  });
  await hydrateInitialContent(parsed, {
    fetcher: async () => new Response(data, { headers: { 'Content-Type': 'text/html' } }),
  });
  const time = parsed.querySelector('#service-freshness');
  assert.equal(time.hidden, false);
  assert.equal(time.getAttribute('datetime'), updatedAt);
  assert.match(time.textContent, /更新于 刚刚/);
  assert.equal(visible.querySelector('time').hidden, true);
  assert.equal(visible.querySelector('time').getAttribute('datetime'), '2000-01-01T00:00:00Z');
  await createLoaders(mountModules(parsed.querySelector('#board'))).get('status')();
  assert.equal(time.hidden, false);
});
test('fresh detection results never imply service health, and stale age remains explicit', () => {
  const host = parseHTML(`<html><body>${renderServiceGrid(config())}</body></html>`).document;
  const node = host.querySelector('[data-module="status"]');
  const module = { node, content: node.querySelector('.module-content') };
  const tiles = new Map(
    [...node.querySelectorAll('[data-service]')].map((tile) => [tile.dataset.service, tile]),
  );
  const updatedAt = '2026-10-23T10:00:00Z';
  applyFragment(
    module,
    parseFragment(
      renderServiceResult(config(), {
        state: 'ready',
        updatedAt,
        data: [{ id: 'service', state: 'offline' }],
      }),
      host,
    ),
    tiles,
  );
  const time = node.querySelector('#service-freshness');
  updateFreshness(node, Date.parse(updatedAt) + 120000);
  assert.equal(node.querySelector('[data-service-state-slot]').dataset.state, 'offline');
  assert.equal(time.textContent, '更新于 2 分钟前');
  assert.ok(!time.textContent.includes('状态正常'));
  time.classList.add('stale');
  updateFreshness(node, Date.parse(updatedAt) + 3600000);
  assert.equal(time.textContent, '数据较旧 · 上次成功 1 小时前');
  time.setAttribute('datetime', 'invalid');
  time.textContent = 'Unchanged';
  updateFreshness(node);
  assert.equal(time.textContent, 'Unchanged');
});
