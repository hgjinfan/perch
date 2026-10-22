import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as forward } from 'node:http';
import { gzipSync } from 'node:zlib';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConfigStore } from '../src/config/store.js';
import { createApplication } from '../src/application.js';
import { createBackup } from '../src/config/backups.js';
import { readConfigVersion } from '../public/core/api.js';
const root = fileURLToPath(new URL('../', import.meta.url));
test('application config version survives weakened or replaced representation ETags', () => {
  const digest = 'a'.repeat(64),
    version = `"${digest}"`;
  assert.equal(
    readConfigVersion(
      new Response(null, {
        headers: { 'X-Config-Version': digest, ETag: 'W/"proxy-content-hash"' },
      }),
    ),
    version,
  );
  assert.equal(
    readConfigVersion(new Response(null, { headers: { ETag: 'W/' + version } })),
    version,
  );
  assert.equal(readConfigVersion(new Response(null, { headers: { ETag: version } })), version);
  assert.throws(
    () => readConfigVersion(new Response(null, { headers: { ETag: 'W/"invalid"' } })),
    /无法读取配置版本/,
  );
});
test('fixed city to visitor IP saves through gzip proxy, while stale tabs remain protected', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'perch-proxy-save-'));
  const store = await createConfigStore({
    statePath: join(directory, 'site.json'),
    configPath: join(root, 'config.json'),
  });
  const server = await createApplication({ root, store, env: { ADMIN_PASSWORD: 'isolated-test' } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const proxy = createServer((request, response) => {
    const upstream = forward(
      {
        hostname: '127.0.0.1',
        port: server.address().port,
        path: request.url,
        method: request.method,
        headers: request.headers,
      },
      (source) => {
        const chunks = [];
        source.on('data', (c) => chunks.push(c));
        source.on('end', () => {
          const headers = { ...source.headers };
          let body = Buffer.concat(chunks);
          if (headers.etag && headers['content-type']?.includes('application/json')) {
            headers.etag = 'W/' + headers.etag;
            body = gzipSync(body);
            headers['content-encoding'] = 'gzip';
            headers['content-length'] = body.length;
            delete headers['transfer-encoding'];
          }
          response.writeHead(source.statusCode, headers);
          response.end(body);
        });
      },
    );
    upstream.on('error', () => {
      response.writeHead(502);
      response.end();
    });
    request.pipe(upstream);
  });
  await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
  t.after(async () => {
    await new Promise((r) => proxy.close(r));
    await new Promise((r) => server.close(r));
  });
  const base = `http://127.0.0.1:${proxy.address().port}`,
    headers = { Authorization: 'Basic ' + Buffer.from('admin:isolated-test').toString('base64') };
  const request = (path, options = {}) =>
    fetch(base + '/api/admin/' + path, {
      ...options,
      headers: { ...headers, Origin: base, 'Content-Type': 'application/json', ...options.headers },
    });
  const initial = await request('config'),
    original = await initial.json();
  assert.equal(original.weather.mode, 'fixed');
  assert.match(initial.headers.get('etag'), /^W\//);
  const stale = readConfigVersion(initial),
    next = { ...original, weather: { ...original.weather, mode: 'ip' } };
  const saved = await request('config', {
    method: 'PUT',
    headers: { 'If-Match': stale },
    body: JSON.stringify(next),
  });
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).weather.mode, 'ip');
  assert.equal(store.get().weather.mode, 'ip');
  assert.notEqual(readConfigVersion(saved), stale);
  const conflict = await request('config', {
    method: 'PUT',
    headers: { 'If-Match': 'W/' + stale },
    body: JSON.stringify(original),
  });
  assert.equal(conflict.status, 409);
  assert.equal(store.get().weather.mode, 'ip');
  const legacy = await request('config', {
    method: 'PUT',
    headers: { 'If-Match': saved.headers.get('etag') },
    body: JSON.stringify(next),
  });
  assert.equal(legacy.status, 200);
  const preview = await request('backup/preview', {
    method: 'POST',
    body: JSON.stringify(createBackup(original)),
  });
  assert.equal(preview.status, 200);
  assert.ok(preview.headers.get('x-config-version'));
  const restored = await request('backup/restore', {
    method: 'POST',
    headers: { 'If-Match': readConfigVersion(preview) },
    body: JSON.stringify(createBackup(original)),
  });
  assert.equal(restored.status, 200);
  assert.equal(store.get().weather.mode, 'fixed');
  assert.ok(restored.headers.get('x-config-version'));
  const missing = await request('config', { method: 'PUT', body: JSON.stringify(original) });
  assert.equal(missing.status, 428);
});
