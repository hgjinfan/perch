import test from 'node:test';
import assert from 'node:assert/strict';
import { createConfigWatcher } from '../public/home/config-updates.js';
import { createPageVersion } from '../src/config/page-version.js';
import { createApplication } from '../src/application.js';
import { validateConfig } from '../src/config/schema.js';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const a = 'a'.repeat(20) + '-' + '1'.repeat(32),
  b = 'a'.repeat(20) + '-' + '2'.repeat(32);
const response = (tag, status = 204) =>
  new Response(null, { status, headers: { ETag: `"${tag}"` } });
test('public version is opaque and unchanged for a no-op snapshot, but changes on configuration replacement', () => {
  let config = { title: 'A', secret: 'private' };
  const store = { get: () => config },
    version = createPageVersion(store, 'a'.repeat(20));
  const original = version();
  assert.match(original, /^[a-f0-9]{20}-[a-f0-9]{32}$/);
  assert.equal(version(), original);
  config = { ...config };
  assert.equal(version(), original);
  config = { ...config, title: 'B' };
  assert.notEqual(version(), original);
  assert.ok(!version().includes('private'));
});
test('HEAD endpoint has no config body and matches the server-rendered baseline', async (t) => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  let config = validateConfig(JSON.parse(await readFile(root + '/config.json', 'utf8')));
  const server = await createApplication({
    root,
    store: { get: () => config, revision: 0 },
    env: {},
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const markup = await (await fetch(base)).text();
  const token = markup.match(/data-page-version="([a-f0-9-]+)"/)[1];
  const initial = await fetch(base + '/page-version', { method: 'HEAD' });
  assert.equal(initial.status, 204);
  assert.equal(await initial.text(), '');
  assert.equal(initial.headers.get('etag'), `"${token}"`);
  assert.equal(initial.headers.get('cache-control'), 'no-store');
  assert.equal(
    (
      await fetch(base + '/page-version', {
        method: 'HEAD',
        headers: { 'If-None-Match': `"${token}"` },
      })
    ).status,
    304,
  );
  config = { ...config, title: 'changed' };
  const changed = await fetch(base + '/page-version', {
    method: 'HEAD',
    headers: { 'If-None-Match': `"${token}"` },
  });
  assert.equal(changed.status, 204);
  assert.notEqual(changed.headers.get('etag'), initial.headers.get('etag'));
  const get = await fetch(base + '/page-version');
  assert.equal(await get.text(), '');
});
test('watcher coalesces, throttles and pauses offline; a change produces one prompt without reload', async () => {
  let time = 0,
    visible = true,
    count = 0,
    notified = 0,
    tag = a,
    resolve;
  const watcher = createConfigWatcher({
    baseline: a,
    now: () => time,
    active: () => visible,
    onChange: () => notified++,
    fetcher: async (path, options) => {
      count++;
      assert.equal(path, '/page-version');
      assert.equal(options.method, 'HEAD');
      assert.equal(options.credentials, 'omit');
      assert.equal(options.cache, 'no-store');
      assert.equal(options.headers['If-None-Match'], `"${a}"`);
      await new Promise((r) => (resolve = r));
      return response(tag);
    },
  });
  const one = watcher.check(),
    two = watcher.check();
  await Promise.resolve();
  assert.equal(count, 1);
  resolve();
  await Promise.all([one, two]);
  assert.equal(notified, 0);
  await watcher.check();
  assert.equal(count, 1);
  visible = false;
  time = 30000;
  await watcher.check(true);
  assert.equal(count, 1);
  visible = true;
  tag = b;
  const changed = watcher.check(true);
  await Promise.resolve();
  resolve();
  assert.equal(await changed, true);
  assert.equal(notified, 1);
  time += 60000;
  await watcher.check(true);
  assert.equal(count, 2);
  assert.equal(notified, 1);
});
test('unchanged, malformed and failed checks remain silent and recover on the next check', async () => {
  let time = 0,
    count = 0,
    notified = 0;
  const fetcher = () => {
    count++;
    if (count === 1) throw Error('offline');
    if (count === 2) return Promise.resolve(response('invalid'));
    if (count === 3) return Promise.resolve(response(a, 304));
    return Promise.resolve(response(b));
  };
  const watcher = createConfigWatcher({
    baseline: a,
    fetcher,
    now: () => time,
    active: () => true,
    onChange: () => notified++,
  });
  for (let i = 0; i < 3; i++) {
    await watcher.check();
    time += 30000;
    assert.equal(notified, 0);
  }
  await watcher.check();
  assert.equal(notified, 1);
  assert.equal(count, 4);
});
