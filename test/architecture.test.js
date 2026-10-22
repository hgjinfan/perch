import { fragmentFetch as fetch } from './helpers/fragment-fetch.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConfigStore } from '../src/config/store.js';
import { createApplication } from '../src/application.js';
import { createAdminGuard } from '../src/security.js';
import { widgetDefinitions } from '../shared/widget-types.js';
import { widgetRenderers } from '../src/render/widgets.js';
import { validateWidget, mapWidget } from '../src/widgets.js';
import { createScheduler } from '../public/core/scheduler.js';

test('Every registered widget has a renderer and a valid mapped example', () => {
  assert.deepEqual(Object.keys(widgetDefinitions).sort(), Object.keys(widgetRenderers).sort());
  for (const [type, definition] of Object.entries(widgetDefinitions)) {
    const widget = validateWidget({
      id: type,
      title: definition.label,
      type,
      source: { kind: 'static', data: definition.example },
      mapping: definition.mapping,
      fields: definition.fields || [],
    });
    assert.ok(mapWidget(widget, definition.example));
  }
});

test('Scheduler deduplicates overlapping refreshes and respects per-module intervals', async () => {
  let now = 0,
    calls = 0,
    release;
  const scheduler = createScheduler({ now: () => now });
  scheduler.register(
    'a',
    async () => {
      calls++;
      await new Promise((resolve) => {
        release = resolve;
      });
    },
    100,
  );
  const first = scheduler.refresh();
  await Promise.resolve();
  const overlap = scheduler.refresh(true);
  assert.equal(calls, 1);
  release();
  await Promise.all([first, overlap]);
  now = 50;
  await scheduler.refresh();
  assert.equal(calls, 1);
  now = 100;
  const next = scheduler.refresh();
  await Promise.resolve();
  assert.equal(calls, 2);
  release();
  await next;
});

test('Failed persistence does not replace live config and save lock is released', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'kyrie-store-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let fail = true,
    release;
  const store = await createConfigStore({
    statePath: join(dir, 'state.json'),
    configPath: fileURLToPath(new URL('../config.json', import.meta.url)),
    persist: async () => {
      if (fail) throw new Error('disk full');
      await new Promise((resolve) => {
        release = resolve;
      });
    },
  });
  const old = store.get(),
    next = { ...old, title: 'Changed' };
  await assert.rejects(store.save(next, store.version), /disk full/);
  assert.equal(store.get(), old);
  assert.equal(store.revision, 0);
  fail = false;
  const saving = store.save(next, store.version);
  await assert.rejects(store.save(next, store.version), (error) => error.status === 409);
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  release();
  await saving;
  assert.equal(store.get().title, 'Changed');
  assert.equal(store.revision, 1);
});

test('Admin lockout expires without mutating global process state', () => {
  let now = 0;
  const guard = createAdminGuard({ username: 'admin', password: 'secret', now: () => now });
  const request = {
    headers: { authorization: 'Basic ' + Buffer.from('admin:wrong').toString('base64') },
    socket: { remoteAddress: 'local' },
  };
  const response = { setHeader() {} };
  for (let i = 0; i < 10; i++)
    assert.throws(
      () => guard(request, response),
      (error) => error.status === 401,
    );
  request.headers.authorization = 'Basic ' + Buffer.from('admin:secret').toString('base64');
  assert.throws(
    () => guard(request, response),
    (error) => error.status === 429,
  );
  now = 600001;
  assert.doesNotThrow(() => guard(request, response));
});

test('Application serves modules safely and loads data with an injected upstream', async (t) => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const { validateConfig } = await import('../src/config/schema.js');
  const raw = JSON.parse(await readFile(join(root, 'config.json')));
  raw.feeds[0].url = 'https://example.com/rss';
  const config = validateConfig(raw);
  const store = { get: () => config, revision: 0 };
  const fetcher = async (url) =>
    String(url).includes('open-meteo')
      ? new Response(
          JSON.stringify({
            current: { time: '2026-10-21T10:00', temperature_2m: 14, apparent_temperature: 14 },
            hourly: { time: ['2026-10-21T11:00'], temperature_2m: [15] },
          }),
        )
      : new Response(
          '<rss><channel><item><title>Injected article</title><link>https://example.com/post</link></item></channel></rss>',
        );
  const server = await createApplication({
    root,
    store,
    env: { ADMIN_PASSWORD: 'secret' },
    fetcher,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.ok((await (await fetch(base + '/fragments/feed-hn')).text()).includes('Injected article'));
  assert.ok((await (await fetch(base + '/fragments/weather')).text()).includes('14°'));
  assert.equal((await fetch(base + '/fragments/status')).status, 200);
  for (const path of ['/core/dom.js', '/home/board.js'])
    assert.equal((await fetch(base + path)).status, 200);
  for (const path of [
    '/admin/fields.js',
    '/widget-editor.js',
    '/admin.html',
    '/shared/widget-types.js',
  ])
    assert.equal((await fetch(base + path)).status, 401);
  for (const path of ['/src/server.js', '/config.json', '/.env', '/api/feed/missing'])
    assert.equal((await fetch(base + path)).status, 404);
  const head = await fetch(base + '/app.js', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal((await fetch(base + '/api/config', { method: 'POST' })).status, 405);
});
