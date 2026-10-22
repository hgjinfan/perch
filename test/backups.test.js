import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConfigStore } from '../src/config/store.js';
import { createBackup, parseBackup, createBackupRepository } from '../src/config/backups.js';
import { createApplication } from '../src/application.js';
const root = fileURLToPath(new URL('../', import.meta.url));
const configPath = join(root, 'config.json');
const raw = JSON.parse(await readFile(configPath, 'utf8'));
async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'homepage-backups-'));
  const store = await createConfigStore({
    statePath: join(directory, 'site.json'),
    configPath,
    ...options,
  });
  const server = await createApplication({
    root,
    store,
    env: { ADMIN_USERNAME: 'test', ADMIN_PASSWORD: 'isolated' },
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = {
    Authorization: 'Basic ' + Buffer.from('test:isolated').toString('base64'),
    Origin: base,
    'Content-Type': 'application/json',
  };
  const request = (path, options = {}) =>
    fetch(base + '/api/admin/' + path, { ...options, headers: { ...headers, ...options.headers } });
  return { directory, store, base, request };
}
test('backup parsing supports normalized roundtrip and legacy layout; rejects unsupported or invalid files', () => {
  const normalized = parseBackup(raw);
  assert.deepEqual(parseBackup(createBackup(normalized)), normalized);
  assert.deepEqual(
    parseBackup({ ...createBackup(normalized), format: 'kyrie-homepage-backup' }),
    normalized,
  );
  assert.ok(normalized.layout.groups.length);
  for (const value of [
    null,
    [],
    { format: 'unknown', version: 1, config: raw },
    { ...createBackup(raw), version: 2 },
    { ...createBackup(raw), config: { ...raw, title: '' } },
  ])
    assert.throws(() => parseBackup(value));
});
test('authenticated export and preview are read-only; restore snapshots previous state and survives restart', async (t) => {
  const { request, store, base, directory } = await fixture(t);
  assert.equal((await fetch(base + '/api/admin/backup')).status, 401);
  assert.equal((await fetch(base + '/api/admin/backups')).status, 401);
  const response = await request('backup');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('content-disposition'), /attachment/);
  const exported = await response.json(),
    original = structuredClone(store.get());
  assert.deepEqual(exported.config, original);
  assert.equal(Object.hasOwn(exported, 'env'), false);
  exported.config.title = '恢复后的主页';
  const preview = await request('backup/preview', {
    method: 'POST',
    body: JSON.stringify(exported),
  });
  assert.equal((await preview.json()).title, '恢复后的主页');
  assert.deepEqual(store.get(), original);
  assert.deepEqual(await store.backups.list(), []);
  const restored = await request('backup/restore', {
    method: 'POST',
    headers: { 'If-Match': preview.headers.get('etag') },
    body: JSON.stringify(exported),
  });
  assert.equal(restored.status, 200);
  assert.equal(store.get().title, '恢复后的主页');
  const history = await (await request('backups')).json();
  assert.equal(history.length, 1);
  const previous = await (await request('backups/' + history[0].id)).json();
  assert.deepEqual(previous.config, original);
  assert.equal((await stat(join(directory, 'backups', history[0].id))).mode & 0o777, 0o600);
  const reloaded = await createConfigStore({ statePath: join(directory, 'site.json'), configPath });
  assert.equal(reloaded.get().title, '恢复后的主页');
  assert.equal((await reloaded.backups.list()).length, 1);
  const back = await request('backup/restore', {
    method: 'POST',
    headers: { 'If-Match': store.version },
    body: JSON.stringify(previous),
  });
  assert.equal(back.status, 200);
  assert.deepEqual(store.get(), original);
});
test('restore rejects bad origin, versions, malformed files and oversized requests without creating snapshots', async (t) => {
  const { request, store } = await fixture(t),
    backup = JSON.stringify(createBackup(raw));
  for (const [options, expected] of [
    [
      { headers: { Origin: 'https://other.invalid', 'If-Match': store.version }, body: backup },
      403,
    ],
    [{ body: backup }, 428],
    [{ headers: { 'If-Match': '"stale"' }, body: backup }, 409],
    [{ headers: { 'If-Match': store.version }, body: '{' }, 400],
    [{ headers: { 'If-Match': store.version }, body: JSON.stringify({ title: 'invalid' }) }, 400],
    [
      { headers: { 'If-Match': store.version }, body: JSON.stringify('x'.repeat(1024 * 1024)) },
      413,
    ],
  ])
    assert.equal(
      (await request('backup/restore', { method: 'POST', ...options })).status,
      expected,
    );
  assert.deepEqual(await store.backups.list(), []);
  assert.equal((await request('backups/not-a-snapshot')).status, 404);
});
test('restore blocks stale previews after another save, and snapshot failure leaves original config untouched', async (t) => {
  const { request, store } = await fixture(t),
    version = store.version;
  await store.save({ ...store.get(), title: '其他页面修改' }, version);
  assert.equal(
    (
      await request('backup/restore', {
        method: 'POST',
        headers: { 'If-Match': version },
        body: JSON.stringify(raw),
      })
    ).status,
    409,
  );
  assert.equal((await store.backups.list()).length, 1);
  const failing = await createConfigStore({
    statePath: '/unused/test.json',
    configPath,
    persist: async () => {
      throw new Error('Must not write');
    },
    backups: {
      write: async () => {
        throw new Error('Snapshot disk full');
      },
    },
  });
  const before = failing.get();
  await assert.rejects(
    failing.save({ ...before, title: 'new' }, failing.version, { recovery: true }),
    /Snapshot disk full/,
  );
  assert.equal(failing.get(), before);
});
test('failed config write retains a readable recovery point; history keeps ten snapshots', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'homepage-retention-'));
  const repository = createBackupRepository(directory);
  const failing = await createConfigStore({
    statePath: join(directory, 'site.json'),
    configPath,
    persist: async () => {
      throw new Error('write failed');
    },
    backups: repository,
  });
  const before = failing.get();
  await assert.rejects(
    failing.save({ ...before, title: 'new' }, failing.version, { recovery: true }),
    /write failed/,
  );
  assert.deepEqual((await repository.read((await repository.list())[0].id)).config, before);
  for (let i = 0; i < 12; i++) await repository.write(before);
  assert.equal((await repository.list()).length, 10);
  await assert.rejects(repository.read('../site.json'), /不存在/);
});

test('ordinary saves automatically retain history, no-op and rejected saves do not add entries', async (t) => {
  const { store, directory } = await fixture(t);
  const before = structuredClone(store.get()),
    version = store.version;
  await store.save(before, version);
  assert.equal(store.revision, 0);
  assert.deepEqual(await store.backups.list(), []);
  await store.save({ ...before, title: 'Updated' }, version);
  const history = await store.backups.list();
  assert.equal(history.length, 1);
  assert.equal(history[0].reason, 'save');
  assert.deepEqual((await store.backups.read(history[0].id)).config, before);
  await assert.rejects(store.save(before, version), { status: 409 });
  await assert.rejects(store.save({ ...before, title: '' }, store.version), { status: 400 });
  assert.equal((await store.backups.list()).length, 1);
  const restarted = await createConfigStore({
    statePath: join(directory, 'site.json'),
    configPath,
  });
  assert.equal((await restarted.backups.list()).length, 1);
});
