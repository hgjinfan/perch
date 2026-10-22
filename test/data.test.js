import test from 'node:test';
import assert from 'node:assert/strict';
import { safeUrl, parseFeed, createCache, checkService } from '../src/data.js';

test('RSS parses entities, excludes unsafe links and tolerates absent dates', () => {
  const entries = parseFeed(
    '<rss><channel><item><title>A &amp; B</title><link>https://example.com/post</link></item><item><title>Bad</title><link>javascript:alert(1)</link></item></channel></rss>',
  );
  assert.deepEqual(entries, [{ title: 'A & B', url: 'https://example.com/post', date: null }]);
});
test('Atom chooses alternate link instead of the API self link', () => {
  const entries = parseFeed(
    '<feed><entry><title>Test</title><link rel="self" href="https://example.com/api"/><link rel="alternate" href="https://example.com/post"/><updated>2026-10-20T10:00:00Z</updated></entry></feed>',
  );
  assert.equal(entries[0].url, 'https://example.com/post');
  assert.equal(entries[0].date, '2026-10-20T10:00:00.000Z');
});
test('Rejects HTML responses, malformed XML and entity declarations', () => {
  for (const value of [
    '<html><body>Forbidden</body></html>',
    '<rss>',
    '<!DOCTYPE rss [<!ENTITY x "bad">]><rss/>',
  ])
    assert.throws(() => parseFeed(value));
  assert.equal(safeUrl('file:///etc/passwd'), null);
  assert.equal(safeUrl('https://user:secret@example.com/'), null);
});
test('Deduplicates parallel loads and preserves successful data after failure', async () => {
  let now = 0,
    calls = 0;
  const cache = createCache(() => now);
  const loader = async () => {
    calls++;
    return ['post'];
  };
  await Promise.all([cache('rss', 100, loader), cache('rss', 100, loader)]);
  assert.equal(calls, 1);
  now = 200;
  const stale = await cache('rss', 100, async () => {
    throw new Error('Network unavailable');
  });
  assert.equal(stale.state, 'stale');
  assert.deepEqual(stale.data, ['post']);
  const repeated = await cache('rss', 100, loader);
  assert.equal(repeated.state, 'stale');
  assert.equal(calls, 1);
  now = 40_000;
  assert.equal((await cache('rss', 100, loader)).state, 'ready');
});
test('Service status distinguishes unconfigured, protected, failed and unreachable', async () => {
  const service = { id: 'a', url: 'https://example.com/' };
  assert.equal((await checkService({ id: 'a', url: '' })).state, 'unconfigured');
  assert.equal(
    (await checkService(service, async () => new Response('', { status: 401 }))).state,
    'online',
  );
  assert.equal(
    (await checkService(service, async () => new Response('', { status: 500 }))).state,
    'degraded',
  );
  assert.equal(
    (
      await checkService(service, async () => {
        throw new Error();
      })
    ).state,
    'offline',
  );
});
