import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createAssets } from '../src/assets.js';
import { createApplication } from '../src/application.js';
import { validateConfig } from '../src/config/schema.js';
const root = fileURLToPath(new URL('../', import.meta.url));
const directory = await mkdtemp(join(tmpdir(), 'perch-client-build-'));
// Run the real production pipeline: source-mode tests alone cannot verify emitted permissions.
execFileSync(process.execPath, ['scripts/build.mjs'], {
  cwd: root,
  stdio: 'pipe',
  env: { ...process.env, PERCH_BUILD_DIR: directory },
});
const manifest = JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8'));
test('production emits small hashed public assets, isolated admin lazy chunks and no source maps', async (t) => {
  const config = validateConfig(JSON.parse(await readFile(resolve(root, 'config.json'), 'utf8')));
  const server = await createApplication({
    root,
    store: { get: () => config, revision: 0 },
    assetsMode: 'built',
    assetsDirectory: directory,
    env: { ADMIN_PASSWORD: 'test-build' },
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const markup = await (await fetch(base)).text();
  assert.ok(markup.includes(manifest.aliases['/app.js']));
  assert.ok(!markup.includes('/icons.js'));
  assert.ok(markup.includes(`/fragments/${manifest.version}/`));
  const publicFiles = manifest.files.filter(
    (f) => !f.admin && f.url.startsWith('/client/') && f.precache && /\.(js|css)$/.test(f.url),
  );
  let bytes = 0;
  for (const file of publicFiles) bytes += (await readFile(resolve(directory, file.disk))).length;
  assert.ok(bytes < 80000, `public eager budget exceeded: ${bytes}`);
  assert.ok(!manifest.files.some((f) => f.url.endsWith('.map')));
  assert.ok(manifest.files.some((f) => f.admin && /chunks\/backups-/.test(f.url)));
  assert.ok(manifest.files.some((f) => f.admin && /chunks\/diagnostics-/.test(f.url)));
  const large = manifest.files.find((f) => /chunks\/lucide-/.test(f.url));
  assert.ok(large && !large.precache);
  const asset = await fetch(base + manifest.aliases['/app.js']);
  assert.match(asset.headers.get('cache-control'), /immutable/);
  assert.equal(
    (
      await fetch(base + manifest.aliases['/app.js'], {
        headers: { 'If-None-Match': asset.headers.get('etag') },
      })
    ).status,
    304,
  );
  for (const file of manifest.files.filter((f) => f.admin))
    assert.equal((await fetch(base + file.url)).status, 401, file.url);
  const auth = { Authorization: 'Basic ' + Buffer.from('admin:test-build').toString('base64') };
  const admin = await fetch(base + '/admin', { headers: auth });
  assert.equal(admin.status, 200);
  assert.ok((await admin.text()).includes(manifest.aliases['/admin.js']));
  assert.equal(
    (await fetch(base + manifest.aliases['/admin.js'], { headers: auth })).headers.get(
      'cache-control',
    ),
    'no-store',
  );
  assert.equal((await fetch(base + '/shared/widget-types.js')).status, 404);
});
test('production service worker precaches only eager public assets and offline shell', async () => {
  const assets = await createAssets(root, { mode: 'built', directory });
  let content;
  await assets.send(
    '/sw.js',
    { method: 'GET', headers: {} },
    {
      writeHead() {},
      end(v) {
        content = v.toString();
      },
    },
  );
  assert.ok(
    !content.includes('__SHELL_') &&
      !content.includes('__PRECACHE_') &&
      !content.includes('__OFFLINE_'),
  );
  // Distinct literal arrays stay inspectable after minification, without relying on variable names.
  const arrays = [...content.matchAll(/\[(?:"[^"\n]*"(?:,|(?=\])))*\]/g)].map((m) => {
    try {
      return JSON.parse(m[0]);
    } catch {
      return [];
    }
  });
  const shell = arrays.find(
    (items) =>
      items.includes(manifest.aliases['/app.js']) && items.some((s) => s.includes('/lucide-')),
  );
  const precache = arrays.find(
    (items) =>
      items.includes(manifest.aliases['/app.js']) && !items.some((s) => s.includes('/lucide-')),
  );
  assert.ok(shell && precache);
  assert.ok(precache.includes('/offline.html'));
  assert.ok(!shell.some((s) => s.startsWith('/client/admin/')));
});
