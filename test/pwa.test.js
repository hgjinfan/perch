import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { createAssets } from '../src/assets.js';
import { buildServiceWorker } from '../src/pwa.js';
import { isShellRequest } from '../public/pwa/policy.js';

const root = fileURLToPath(new URL('../', import.meta.url));
async function worker() {
  const assets = await createAssets(root);
  let body;
  await assets.send(
    '/sw.js',
    { method: 'GET' },
    {
      writeHead() {},
      end(value) {
        body = value.toString();
      },
    },
  );
  return body;
}

test('Manifest has standalone mode and correctly sized raster icons', async () => {
  const manifest = JSON.parse(
    await readFile(new URL('../public/manifest.webmanifest', import.meta.url)),
  );
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/launch.html');
  assert.equal(manifest.id, '/');
  for (const icon of manifest.icons) {
    const bytes = await readFile(`${root}/public${icon.src}`);
    assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
    assert.equal(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`, icon.sizes);
  }
  assert.ok(manifest.icons.some((icon) => icon.purpose === 'maskable'));
});

test('Worker shell includes module graph but excludes APIs and every admin entry', async () => {
  const source = await worker();
  assert.ok(!source.includes('__SHELL_'));
  const shell = JSON.parse(source.match(/const SHELL = (\[[\s\S]*?\]);/)[1]);
  for (const path of [
    '/offline.html',
    '/launch.html',
    '/pwa/launch.js',
    '/pwa/theme.js',
    '/pwa/startup.js',
    '/app.js',
    '/core/api.js',
    '/home/board.js',
    '/pwa/client.js',
  ])
    assert.ok(shell.some((url) => url.endsWith(path)));
  for (const path of [
    '/icons.js',
    '/admin',
    '/admin/',
    '/admin.html',
    '/admin.js',
    '/admin/fields.js',
    '/widget-editor.js',
    '/api/config',
    '/api/status',
    '/sw.js',
    '/',
    '/index.html',
  ])
    assert.ok(!shell.some((url) => url.endsWith(path)));
  const origin = 'https://home.example';
  assert.equal(
    isShellRequest(
      new Request(origin + shell.find((url) => url.endsWith('/app.js'))),
      origin,
      shell,
    ),
    true,
  );
  for (const path of ['/api/admin/config', '/api/config', '/admin', '/?token=secret'])
    assert.equal(isShellRequest(new Request(origin + path), origin, shell), false);
  assert.equal(
    isShellRequest(
      new Request(origin + '/', { headers: { Authorization: 'Basic secret' } }),
      origin,
      shell,
    ),
    false,
  );
  assert.equal(isShellRequest(new Request(origin + '/', { method: 'POST' }), origin, shell), false);
  assert.equal(isShellRequest(new Request('https://other.example/'), origin, shell), false);
});

test('Service worker deduplicates resolved asset aliases in shell and precache lists', async () => {
  const files = new Map([
    [
      '/sw.js',
      {
        body: Buffer.from(
          "const VERSION = '__SHELL_VERSION__'; const SHELL = ['__SHELL_FILES__']; const PRECACHE = ['__PRECACHE_FILES__']; const OFFLINE = '__OFFLINE_URL__'; const LAUNCH = '__LAUNCH_URL__'; const BASE_PATH = __BASE_PATH__;",
        ),
      },
    ],
    ['/client/public/setup.css', { admin: false }],
    ['/setup.css', { admin: false, precache: true }],
    ['/client/public/setup.js', { admin: false }],
    ['/setup.js', { admin: false, precache: true }],
    ['/client/public/app.js', { admin: false }],
    ['/admin.js', { admin: true }],
  ]);
  const aliases = new Map([
    ['/client/public/setup.css', '/client/public/setup-hash.css'],
    ['/setup.css', '/client/public/setup-hash.css'],
    ['/client/public/setup.js', '/client/public/setup-hash.js'],
    ['/setup.js', '/client/public/setup-hash.js'],
  ]);
  const source = await buildServiceWorker(files, {
    version: 'a'.repeat(20),
    urlFor: (path) => aliases.get(path) || path,
  });
  const shell = JSON.parse(source.match(/const SHELL = (\[[^;]*\]);/)[1]);
  const precache = JSON.parse(source.match(/const PRECACHE = (\[[^;]*\]);/)[1]);
  assert.equal(shell.length, new Set(shell).size);
  assert.equal(precache.length, new Set(precache).size);
  assert.ok(precache.includes('/client/public/setup-hash.css'));
  assert.ok(precache.includes('/client/public/setup-hash.js'));
  assert.ok(!shell.some((path) => path.startsWith('/admin')));
});

test('Installed launch shell opens immediately offline without API interception; updates remain explicit', async () => {
  const source = await worker();
  const events = {},
    stored = new Map();
  let offline = false,
    skipped = false,
    claimed = false,
    networkCalls = 0;
  const cache = {
    async addAll(paths) {
      for (const path of paths)
        stored.set('https://home.example' + path, new Response('cached:' + path));
    },
    async match(request) {
      return stored
        .get(typeof request === 'string' ? 'https://home.example' + request : request.url)
        ?.clone();
    },
  };
  const context = {
    isShellRequest,
    URL,
    Response,
    self: {
      location: { origin: 'https://home.example' },
      addEventListener: (name, callback) => {
        events[name] = callback;
      },
      clients: {
        claim: async () => {
          claimed = true;
        },
      },
      skipWaiting: () => {
        skipped = true;
      },
    },
    caches: {
      open: async () => cache,
      keys: async () => ['unrelated-cache'],
      delete: async (name) => {
        assert.ok(name.startsWith('perch-shell-') || name.startsWith('kyrie-shell-'));
      },
    },
    fetch: async () => {
      networkCalls++;
      if (offline) throw new Error('offline');
      return new Response('network');
    },
  };
  runInNewContext(source.replace(/^import .*?;\s*/s, ''), context);
  let work;
  events.install({
    waitUntil(promise) {
      work = promise;
    },
  });
  await work;
  assert.equal(skipped, false);
  events.activate({
    waitUntil(promise) {
      work = promise;
    },
  });
  await work;
  assert.equal(claimed, true);
  offline = true;
  events.fetch({
    request: { method: 'GET', mode: 'navigate', url: 'https://home.example/' },
    respondWith(promise) {
      work = promise;
    },
  });
  assert.ok((await (await work).text()).endsWith('/launch.html'));
  assert.equal(networkCalls, 0, 'cached startup must not wait on a navigation network request');
  events.fetch({
    request: {
      method: 'GET',
      mode: 'navigate',
      url: 'https://home.example/page/' + 'a'.repeat(20) + '/' + 'b'.repeat(32),
    },
    respondWith(promise) {
      work = promise;
    },
  });
  assert.ok((await (await work).text()).endsWith('/launch.html'));

  events.fetch({
    request: new Request('https://home.example/api/admin/config'),
    respondWith() {
      assert.fail('Admin must never be intercepted');
    },
  });
  events.fetch({
    request: {
      method: 'GET',
      mode: 'navigate',
      url: 'https://home.example/?direct=1',
      headers: new Headers(),
    },
    respondWith() {
      assert.fail('Explicit direct navigation must bypass the launch shell');
    },
  });
  events.message({ data: { type: 'ACTIVATE_UPDATE' } });
  assert.equal(skipped, true);
});
