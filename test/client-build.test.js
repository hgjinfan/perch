import test from 'node:test';
import { createHash } from 'node:crypto';
import { init, parse } from 'es-module-lexer/minimal';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, cp, symlink, rm } from 'node:fs/promises';
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
  config.services[0].icon = 'terminal';
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
  const homeResponse = await fetch(base);
  const markup = await homeResponse.text();
  assert.ok(markup.includes(manifest.aliases['/app.js']));
  assert.ok(!markup.includes('/icons.js'));
  assert.ok(!markup.includes(manifest.aliases['/pwa/theme.js']));
  assert.ok(/<script>/.test(markup));
  const themeInline = markup.match(/<script>([\s\S]*?)<\/script>/)[1];
  const themeHash = createHash('sha256').update(themeInline).digest('base64');
  assert.ok(homeResponse.headers.get('content-security-policy').includes(`'sha256-${themeHash}'`));
  assert.ok(!homeResponse.headers.get('content-security-policy').includes('unsafe-inline'));
  const inlineScripts = [...markup.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(inlineScripts.length, 2);
  assert.ok(inlineScripts[1].index > markup.indexOf('</main>'));
  for (const [, code] of inlineScripts) {
    const hash = createHash('sha256').update(code).digest('base64');
    assert.ok(homeResponse.headers.get('content-security-policy').includes(`'sha256-${hash}'`));
  }

  const launchResponse = await fetch(base + '/launch.html');
  const launch = await launchResponse.text();
  assert.ok(launch.includes(manifest.aliases['/pwa/launch.js']));
  assert.ok(!launch.includes(manifest.aliases['/pwa/theme.js']));
  assert.ok(!launch.includes('data-page-version='));
  const themeSource = await (await fetch(base + manifest.aliases['/pwa/theme.js'])).text();
  assert.ok(
    !/\bimport\s|\bexport\s/.test(themeSource),
    'early theme entry must remain a classic script',
  );
  assert.ok(markup.includes(`/fragments/${manifest.version}/`));
  const publicFiles = manifest.files.filter(
    (f) => !f.admin && f.url.startsWith('/client/') && f.precache && /\.(js|css)$/.test(f.url),
  );
  let bytes = 0;
  for (const file of publicFiles) bytes += (await readFile(resolve(directory, file.disk))).length;
  assert.ok(bytes < 80000, `public eager budget exceeded: ${bytes}`);
  await init();
  for (const file of publicFiles.filter((file) => file.url.endsWith('.js'))) {
    const source = await readFile(resolve(directory, file.disk), 'utf8');
    const [imports] = parse(source);
    assert.equal(
      imports.filter((item) => item.d === -1).length,
      0,
      `public entry must not create a static import waterfall: ${file.url}`,
    );
  }

  assert.ok(!manifest.files.some((f) => f.url.endsWith('.map')));
  assert.ok(manifest.files.some((f) => f.admin && /chunks\/backups-/.test(f.url)));
  assert.ok(manifest.files.some((f) => f.admin && /chunks\/diagnostics-/.test(f.url)));
  assert.ok(!manifest.files.some((f) => /lucide|icons\.js/.test(f.url)));
  assert.ok(markup.includes('data-lucide="terminal"'));
  assert.ok(markup.includes('<svg'));
  assert.ok(!markup.includes('<i data-lucide='));
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
    (items) => items.includes(manifest.aliases['/app.js']) && items.includes('/offline.html'),
  );
  const precache = shell;
  assert.ok(shell);
  assert.ok(!shell.some((s) => /lucide|icons\.js/.test(s)));
  assert.ok(precache.includes('/offline.html'));
  assert.ok(!shell.some((s) => s.startsWith('/client/admin/')));
});

test('production client URLs and PWA scope honor a configured base path', async (t) => {
  const config = validateConfig(JSON.parse(await readFile(resolve(root, 'config.json'), 'utf8')));
  const server = await createApplication({
    root,
    store: { get: () => config, revision: 0 },
    assetsMode: 'built',
    assetsDirectory: directory,
    env: { ADMIN_PASSWORD: 'test-build', BASE_PATH: '/sub/perch' },
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const page = await (await fetch(`${base}/sub/perch/`)).text();
  assert.match(page, /data-base-path="\/sub\/perch"/);
  assert.ok(page.includes(`/sub/perch${manifest.aliases['/app.js']}`));
  assert.ok(page.includes('data-fragment="/sub/perch/fragments/'));
  const manifestResponse = await fetch(`${base}/sub/perch/manifest.webmanifest`);
  const appManifest = await manifestResponse.json();
  assert.equal(appManifest.scope, '/sub/perch/');
  assert.equal(appManifest.start_url, '/sub/perch/launch.html');
  const worker = await fetch(`${base}/sub/perch/sw.js`);
  assert.equal(worker.headers.get('service-worker-allowed'), '/sub/perch/');
  assert.ok((await worker.text()).includes('"/sub/perch"'));
});

test('production bootstrap starts without the public source tree, matching the runtime image', async (t) => {
  const runtime = await mkdtemp(join(tmpdir(), 'perch-runtime-layout-'));
  t.after(() => rm(runtime, { recursive: true, force: true }));
  await cp(resolve(root, 'src'), resolve(runtime, 'src'), { recursive: true });
  await cp(resolve(root, 'shared'), resolve(runtime, 'shared'), { recursive: true });
  await cp(resolve(root, 'package.json'), resolve(runtime, 'package.json'));
  await symlink(resolve(root, 'node_modules'), resolve(runtime, 'node_modules'), 'dir');
  execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import { createAssets } from './src/assets.js';
    const assets = await createAssets(process.cwd(), { mode: 'built', directory: ${JSON.stringify(directory)} });
    if (!assets.homeShell.includes('gridAutoRows')) throw Error('Missing layout bootstrap');
  `,
    ],
    { cwd: runtime, stdio: 'pipe' },
  );
});
