import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createApplication } from '../src/application.js';
import { normalizeBasePath } from '../src/base-path.js';
import { validateConfig } from '../src/config/schema.js';
import { readFile } from 'node:fs/promises';

const root = fileURLToPath(new URL('../', import.meta.url));

test('base path normalization rejects ambiguous mount prefixes', () => {
  assert.equal(normalizeBasePath(''), '');
  assert.equal(normalizeBasePath('/perch/demo'), '/perch/demo');
  for (const value of ['perch', '/perch/', '/perch//demo', '/..', '/perch?x=1', '/a%2Fb'])
    assert.throws(() => normalizeBasePath(value));
});

test('application assets, routes, and PWA metadata honor BASE_PATH', async (t) => {
  const config = validateConfig(
    JSON.parse(await readFile(new URL('../config.json', import.meta.url))),
  );
  config.title = 'Subpath Test';
  const server = await createApplication({
    root,
    store: { get: () => config, revision: 0 },
    env: { BASE_PATH: '/perch/demo', ADMIN_PASSWORD: 'base-path-test' },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  for (const method of ['GET', 'HEAD']) {
    const redirect = await fetch(`${base}/perch/demo?direct=1&city=test`, {
      method,
      redirect: 'manual',
    });
    assert.equal(redirect.status, 308);
    assert.equal(redirect.headers.get('location'), '/perch/demo/?direct=1&city=test');
    assert.equal(redirect.headers.get('cache-control'), 'no-store');
    assert.equal(await redirect.text(), '');
  }
  const canonical = await fetch(`${base}/perch/demo`);
  assert.equal(canonical.url, `${base}/perch/demo/`);
  assert.equal(canonical.status, 200);

  const page = await fetch(`${base}/perch/demo/`);
  const markup = await page.text();
  assert.equal(page.status, 200);
  assert.match(markup, /data-base-path="\/perch\/demo"/);
  assert.match(markup, /<a class="brand" href="\/perch\/demo\/">Subpath Test/);
  assert.match(markup, /href="\/perch\/demo\/assets\/[a-f0-9]{20}\/styles\.css"/);
  assert.match(markup, /data-fragment="\/perch\/demo\/fragments\/[a-f0-9]{20}\//);

  assert.equal((await fetch(`${base}/perch/demo/api/admin/config`)).status, 401);
  const latest = await fetch(`${base}/perch/demo/page/latest`, { redirect: 'manual' });
  assert.equal(latest.status, 302);
  assert.match(latest.headers.get('location'), /^\/perch\/demo\/page\//);

  const manifest = await (await fetch(`${base}/perch/demo/manifest.webmanifest`)).json();
  assert.equal(manifest.id, '/perch/demo/');
  assert.equal(manifest.scope, '/perch/demo/');
  assert.equal(manifest.start_url, '/perch/demo/launch.html');
  const worker = await fetch(`${base}/perch/demo/sw.js`);
  assert.equal(worker.headers.get('service-worker-allowed'), '/perch/demo/');
  assert.match(await worker.text(), /const BASE_PATH = "\/perch\/demo"/);
});
