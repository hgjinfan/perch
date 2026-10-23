import test from 'node:test';
import { request } from 'node:http';
const auth = 'Basic ' + Buffer.from('admin:setup-test').toString('base64');
const authenticatedFetch = (url, options = {}) =>
  fetch(url, { ...options, headers: { Authorization: auth, ...options.headers } });
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConfigStore } from '../src/config/store.js';
import { createApplication } from '../src/application.js';
async function fixture(t) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const directory = await mkdtemp(join(tmpdir(), 'perch-setup-'));
  const store = await createConfigStore({
    configPath: join(root, 'config.json'),
    statePath: join(directory, 'site.json'),
  });
  const server = await createApplication({ root, store, env: { ADMIN_PASSWORD: 'setup-test' } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  return { store, base: `http://127.0.0.1:${server.address().port}` };
}
test('first setup permits direct local access, denies proxy/rebinding and requires same-origin JSON', async (t) => {
  const { store, base } = await fixture(t);
  assert.equal((await fetch(base + '/api/setup')).status, 401);
  assert.equal((await authenticatedFetch(base + '/setup')).status, 200);
  assert.equal(
    (await authenticatedFetch(base + '/api/setup', { headers: { 'X-Forwarded-For': '8.8.8.8' } }))
      .status,
    403,
  );
  assert.equal(
    await new Promise((resolve, reject) => {
      const req = request(
        base + '/api/setup',
        { headers: { Host: 'public.example', Authorization: auth } },
        (response) => {
          response.resume();
          response.on('end', () => resolve(response.statusCode));
        },
      );
      req.on('error', reject);
      req.end();
    }),
    403,
  );
  assert.equal(
    (
      await authenticatedFetch(base + '/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://other.example' },
        body: '{}',
      })
    ).status,
    403,
  );
  assert.equal(store.initialized, false);
  assert.equal(
    (
      await authenticatedFetch(base + '/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: base },
        body: JSON.stringify({ title: 'Initialized', weather: null }),
      })
    ).status,
    200,
  );
  assert.equal(store.initialized, true);
  assert.equal((await authenticatedFetch(base + '/api/setup')).status, 409);
});
test('ordinary authenticated config saves also close the first-run setup path', async (t) => {
  const { store, base } = await fixture(t);
  await store.save({ ...store.get(), title: 'Saved by administrator' }, store.version);
  assert.equal(store.initialized, true);
  assert.equal((await authenticatedFetch(base + '/api/setup')).status, 409);
});
