import { fragmentFetch as fetch } from './helpers/fragment-fetch.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { authorize, validateConfig } from '../src/admin.js';

test('Admin credentials are required and compared exactly', () => {
  assert.equal(authorize(undefined, 'admin', 'secret'), false);
  assert.equal(
    authorize('Basic ' + Buffer.from('admin:wrong').toString('base64'), 'admin', 'secret'),
    false,
  );
  assert.equal(
    authorize('Basic ' + Buffer.from('admin:secret').toString('base64'), 'admin', 'secret'),
    true,
  );
  assert.equal(authorize('Basic ', 'admin', ''), false);
});
test('Config rejects unsafe links and duplicate identifiers', async () => {
  const base = JSON.parse(await readFile(new URL('../config.json', import.meta.url)));
  const valid = validateConfig(base);
  assert.equal(valid.layout.density, 'comfortable');
  base.services[0].url = 'javascript:alert(1)';
  assert.throws(() => validateConfig(base));
  base.services[0].url = '';
  base.services[1].id = base.services[0].id;
  assert.throws(() => validateConfig(base));
});
test('HTTP authorization, CSRF protection, persisted config, and fail-closed admin', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'kyrie-admin-test-'));
  const password = randomBytes(24).toString('hex');
  let child;
  t.after(async () => {
    if (child && child.exitCode === null) {
      child.kill();
      await new Promise((resolve) => child.once('exit', resolve));
    }
    await rm(dir, { recursive: true, force: true });
  });
  async function start(secret) {
    child = spawn(process.execPath, ['src/server.js'], {
      cwd: new URL('../', import.meta.url),
      env: {
        ...process.env,
        PORT: '0',
        PERCH_ASSETS: 'source',
        ADMIN_PASSWORD: secret,
        ADMIN_USERNAME: 'admin',
        STATE_PATH: join(dir, 'site.json'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return new Promise((resolve, reject) => {
      let logs = '';
      const timer = setTimeout(() => reject(new Error('Startup timeout')), 5000);
      child.on('exit', (code) => {
        clearTimeout(timer);
        if (code) reject(new Error('Server failed'));
      });
      child.stdout.on('data', (data) => {
        logs += data;
        const match = logs.match(/http:\/\/127\.0\.0\.1:(\d+)/);
        if (match) {
          clearTimeout(timer);
          resolve(match[0]);
        }
      });
    });
  }
  let base = await start(password);
  const auth = { Authorization: 'Basic ' + Buffer.from('admin:' + password).toString('base64') };
  assert.equal((await fetch(base + '/admin')).status, 401);
  assert.equal((await fetch(base + '/api/admin/config')).status, 401);
  assert.equal((await fetch(base + '/api/admin/config', { method: 'PUT' })).status, 401);
  assert.equal((await fetch(base + '/admin', { headers: auth })).status, 200);
  const html = await (await fetch(base + '/')).text();
  assert.ok(!html.includes('id="settings"'));
  assert.ok(!html.includes('<dialog'));
  const initialConfig = await fetch(base + '/api/admin/config', { headers: auth });
  const configVersion = initialConfig.headers.get('etag');
  const config = await initialConfig.json();
  const widget = {
    id: 'balance',
    title: '余额',
    type: 'metric',
    source: { kind: 'static', data: { value: 42, secret: 'never-public' } },
    mapping: { value: 'value' },
  };
  const previewOptions = {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify(widget),
  };
  assert.equal(
    (await fetch(base + '/api/admin/widget-preview', { method: 'POST', body: '{}' })).status,
    401,
  );
  assert.equal(
    (
      await fetch(base + '/api/admin/widget-preview', {
        ...previewOptions,
        headers: { ...previewOptions.headers, Origin: 'https://evil.example' },
      })
    ).status,
    403,
  );
  const preview = await fetch(base + '/api/admin/widget-preview', previewOptions);
  assert.equal(preview.status, 200);
  assert.match(preview.headers.get('content-type'), /text\/html/);
  assert.ok((await preview.text()).includes('42'));
  config.widgets = [widget];
  config.titles = { status: '服务器状态' };
  config.title = 'Saved title';
  config.layout.hidden = ['feed-blog'];
  const headers = {
    ...auth,
    'Content-Type': 'application/json',
    Origin: 'https://evil.example',
    'If-Match': configVersion,
  };
  assert.equal(
    (
      await fetch(base + '/api/admin/config', {
        method: 'PUT',
        headers,
        body: JSON.stringify(config),
      })
    ).status,
    403,
  );
  headers.Origin = base;
  assert.equal(
    (
      await fetch(base + '/api/admin/config', {
        method: 'PUT',
        headers,
        body: JSON.stringify(config),
      })
    ).status,
    200,
  );
  assert.equal(JSON.parse(await readFile(join(dir, 'site.json'), 'utf8')).title, 'Saved title');
  const pub = await (await fetch(base + '/')).text();
  assert.ok(!pub.includes('data-module="feed-blog"'));
  assert.ok(!pub.includes(password));
  assert.ok(!pub.includes('never-public'));
  const fragment = await (await fetch(base + '/fragments/widget-balance')).text();
  assert.ok(fragment.includes('42'));
  assert.ok(!fragment.includes('never-public'));
  assert.equal((await fetch(base + '/api/config')).status, 404);
  headers['If-Match'] = (await fetch(base + '/api/admin/config', { headers: auth })).headers.get(
    'etag',
  );
  config.layout.hidden.push('widget-balance');
  assert.equal(
    (
      await fetch(base + '/api/admin/config', {
        method: 'PUT',
        headers,
        body: JSON.stringify(config),
      })
    ).status,
    200,
  );
  assert.equal((await fetch(base + '/fragments/widget-balance')).status, 404);
  child.kill();
  await new Promise((resolve) => child.once('exit', resolve));
  child = null;
  base = await start('');
  assert.equal((await fetch(base + '/admin')).status, 503);
  assert.ok((await (await fetch(base + '/')).text()).includes('Saved title'));
});
