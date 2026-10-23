import test from 'node:test';
import assert from 'node:assert/strict';
import { compareConfigs } from '../src/config/diff.js';
import { inspectWidget } from '../src/widgets/source.js';
import { readRemote } from '../src/data.js';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBackupRepository, BACKUP_LIMIT } from '../src/config/backups.js';

test('config comparison exposes changes without credentials or raw source values', () => {
  const before = {
    title: 'Before',
    widgets: [
      {
        id: 'one',
        title: 'One',
        source: { url: 'secret-old', headers: { Authorization: 'secret-token' } },
      },
    ],
  };
  const after = {
    title: 'After',
    widgets: [
      { id: 'one', title: 'Two', source: { url: 'secret-new', data: { key: 'secret-data' } } },
      { id: 'two', source: { data: 'secret-added' } },
    ],
  };
  const result = compareConfigs(before, after);
  assert.ok(result.changes.some((change) => change.path === 'title' && change.after === 'After'));
  assert.ok(result.changes.some((change) => change.path === 'widgets[one].source'));
  assert.ok(result.changes.some((change) => change.action === 'added'));
  assert.ok(!JSON.stringify(result).includes('secret-'));
  assert.deepEqual(compareConfigs(before, before).changes, []);
  const huge = compareConfigs(
    {},
    Object.fromEntries(Array.from({ length: 200 }, (_, i) => ['key' + i, i])),
  );
  assert.equal(huge.changes.length, 100);
  assert.equal(huge.truncated, true);
});

test('field inspector returns bounded valid paths and types, never sample values or sensitive fields', async () => {
  const info = await inspectWidget({
    source: {
      kind: 'static',
      data: {
        data: { items: [{ name: 'private-name', count: 2 }], token: 'hidden-value' },
        password: 'secret',
        'bad.key': 'hidden',
      },
    },
  });
  assert.ok(
    info.fields.some((field) => field.path === 'data.items.0.count' && field.type === 'number'),
  );
  assert.ok(!/private-name|hidden-value|secret|password|token|bad.key/.test(JSON.stringify(info)));
  const many = await inspectWidget({
    source: {
      kind: 'static',
      data: Object.fromEntries(Array.from({ length: 200 }, (_, i) => ['k' + i, i])),
    },
  });
  assert.equal(many.fields.length, 100);
  assert.equal(many.truncated, true);
});

test('empty remote response has an explicit format failure', async () => {
  await assert.rejects(
    readRemote('https://example.com/', async () => new Response(null, { status: 204 })),
    /Invalid feed/,
  );
});

test('oversized history files are skipped by listing and refused on read', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'perch-large-history-'));
  const id = '1700000000000-00000000-0000-0000-0000-000000000000.json';
  await writeFile(join(directory, id), ' '.repeat(BACKUP_LIMIT + 1));
  const repository = createBackupRepository(directory);
  assert.deepEqual(await repository.list(), []);
  await assert.rejects(repository.read(id), { status: 413 });
});

test('admin tool endpoints authenticate, enforce same origin, and never return upstream values', async (t) => {
  const { createApplication } = await import('../src/application.js');
  const { createConfigStore } = await import('../src/config/store.js');
  const { fileURLToPath } = await import('node:url');
  const root = fileURLToPath(new URL('../', import.meta.url));
  const directory = await mkdtemp(join(tmpdir(), 'perch-admin-tools-'));
  const store = await createConfigStore({
    configPath: join(root, 'config.json'),
    statePath: join(directory, 'site.json'),
  });
  let calls = 0;
  const server = await createApplication({
    root,
    store,
    env: { ADMIN_PASSWORD: 'isolated-tools' },
    fetcher: async () => {
      calls++;
      return Response.json({
        data: { value: 42, password: 'private-password', name: 'private-name' },
      });
    },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = {
    Authorization: 'Basic ' + Buffer.from('admin:isolated-tools').toString('base64'),
    Origin: base,
    'Content-Type': 'application/json',
  };
  assert.equal((await fetch(base + '/api/admin/runtime')).status, 401);
  const runtime = await fetch(base + '/api/admin/runtime', { headers });
  assert.equal(runtime.headers.get('cache-control'), 'no-store');
  assert.equal((await runtime.json()).budget.active, 0);
  assert.equal(calls, 0);
  const widget = {
    id: 'test',
    title: 'Test',
    type: 'metric',
    source: { kind: 'api', url: 'https://private.example/', headers: {} },
    mapping: { value: 'data.value' },
  };
  const inspect = (options) =>
    fetch(base + '/api/admin/widget-inspect', {
      method: 'POST',
      headers,
      body: JSON.stringify(widget),
      ...options,
    });
  assert.equal(
    (await inspect({ headers: { ...headers, Origin: 'https://other.example' } })).status,
    403,
  );
  const result = await inspect();
  assert.equal(result.status, 200);
  const info = await result.json();
  assert.ok(info.fields.some((field) => field.path === 'data.value'));
  assert.ok(!/private-password|private-name/.test(JSON.stringify(info)));
  const preview = await fetch(base + '/api/admin/backup/preview', {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...store.get(), title: 'New title' }),
  });
  assert.equal(preview.status, 200);
  assert.ok((await preview.json()).changes.some((change) => change.path === 'title'));
  assert.equal((await store.backups.list()).length, 0);
});
