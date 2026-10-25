import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateConfig } from '../src/config/schema.js';
import { validateConnections, resolveWidgetConnection } from '../src/widgets/connections.js';
import { validateWidget } from '../src/widgets/schema.js';
import { validConnectionPath } from '../shared/connection-request.js';
import { loadWidget } from '../src/widgets/source.js';
import { createDashboardService } from '../src/services/dashboard.js';
import { compareConfigs } from '../src/config/diff.js';
import { createBackup, parseBackup } from '../src/config/backups.js';
import { createConfigStore } from '../src/config/store.js';
import { createApplication } from '../src/application.js';
import { parseHTML } from 'linkedom';
import { extractConnectionSource } from '../public/admin/connections.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const connection = {
  id: 'shared',
  name: 'Shared',
  baseUrl: 'https://example.com/proxy',
  headers: { Authorization: 'Bearer ${WIDGET_TEST_TOKEN}' },
};
const widget = (id = 'one') =>
  validateWidget({
    id,
    title: id,
    type: 'metric',
    source: {
      kind: 'connection',
      connectionId: 'shared',
      path: '/api/value',
      query: { label: 'a & b' },
      method: 'GET',
    },
    mapping: { value: 'value' },
  });
async function configuration() {
  return validateConfig({
    ...JSON.parse(await readFile(join(root, 'config.json'))),
    connections: [connection],
    widgets: [widget(), widget('two')],
  });
}

test('shared connections normalize, preserve old config and reject dangling or unsafe requests', async () => {
  const config = await configuration();
  assert.equal(parseBackup(createBackup(config)).connections[0].id, 'shared');
  const old = JSON.parse(await readFile(join(root, 'config.json')));
  assert.deepEqual(validateConfig(old).connections, []);
  assert.throws(() => validateConfig({ ...config, connections: [] }), /共享连接不存在/);
  assert.throws(() => validateConnections([connection, connection]), /共享连接/);
  assert.throws(() =>
    validateConnections([{ ...connection, baseUrl: 'https://user:pass@example.com' }]),
  );
  assert.throws(() =>
    validateConnections([{ ...connection, baseUrl: 'https://example.com?token=x' }]),
  );
  assert.throws(() => validateConnections([{ ...connection, headers: { Cookie: 'x' } }]));
  assert.throws(() =>
    validateConnections([{ ...connection, headers: { Authorization: '${SECRET}' } }]),
  );
  for (const path of [
    '//evil.com/x',
    '/a/../x',
    '/%2e%2e/x',
    '/%252e%252e/x',
    '/a\\x',
    '/x?token=a',
    '/%2f%2fevil.com',
  ])
    assert.equal(validConnectionPath(path), false, path);
  const resolved = resolveWidgetConnection(widget(), config.connections);
  assert.equal(resolved.source.url, 'https://example.com/proxy/api/value?label=a+%26+b');
  assert.throws(() =>
    validateWidget({
      ...widget(),
      source: { ...widget().source, headers: { Authorization: 'override' } },
    }),
  );
  const changes = compareConfigs(config, {
    ...config,
    connections: [
      {
        ...connection,
        baseUrl: 'https://private.invalid',
        headers: { Authorization: 'hidden-secret' },
      },
    ],
  });
  assert.ok(!/private.invalid|hidden-secret|WIDGET_TEST/.test(JSON.stringify(changes)));
});

test('connection settings selectively invalidate referencing caches; labels retain cached data', async () => {
  let config = await configuration(),
    revision = 0;
  config.widgets.push(
    validateWidget({
      id: 'manual',
      title: 'manual',
      type: 'metric',
      source: { kind: 'static', data: { value: 9 } },
    }),
  );
  let calls = 0;
  const fetcher = async (url, options) => {
    calls++;
    assert.equal(options.headers.Authorization, 'Bearer real-test-only');
    return new Response(JSON.stringify({ value: calls }));
  };
  const service = createDashboardService(
    {
      get: () => config,
      get revision() {
        return revision;
      },
    },
    { fetcher, env: { WIDGET_TEST_TOKEN: 'real-test-only' } },
  );
  await service.widget('one');
  await service.widget('two');
  await service.widget('manual');
  assert.equal(calls, 2);
  config = structuredClone(config);
  config.connections[0].name = 'Renamed';
  revision++;
  await service.widget('one');
  await service.widget('two');
  assert.equal(calls, 2);
  config = structuredClone(config);
  config.connections[0].baseUrl += '/v2';
  revision++;
  const before = service.cacheStats().loads;
  await service.widget('one');
  await service.widget('two');
  await service.widget('manual');
  assert.equal(calls, 4);
  assert.equal(service.cacheStats().loads - before, 2);
  config = structuredClone(config);
  config.connections[0].headers['X-Test'] = 'changed';
  revision++;
  await service.widget('one');
  assert.equal(calls, 5);
  assert.equal(service.diagnostics().sources.find((s) => s.id === 'widget:one').configured, true);
});

test('API extraction preserves subpaths, query and POST body without copying credentials into widgets', () => {
  const source = {
    kind: 'api',
    url: 'https://example.com/proxy/api/value?q=x%26y',
    method: 'POST',
    headers: { Authorization: 'secret' },
    body: { id: 1 },
  };
  const extracted = extractConnectionSource(source, connection);
  assert.equal(extracted.path, '/api/value');
  assert.deepEqual(extracted.query, { q: 'x&y' });
  assert.deepEqual(extracted.body, { id: 1 });
  assert.equal(extracted.headers, undefined);
  assert.throws(() =>
    extractConnectionSource({ ...source, url: 'https://other.example/api' }, connection),
  );
  assert.throws(() =>
    extractConnectionSource(
      { ...source, url: 'https://example.com/proxy/api?a=1&a=2' },
      connection,
    ),
  );
});

test('draft connections preview and inspect over real HTTP; saved fragments use the same resolution', async (t) => {
  const seen = [];
  const upstream = createServer((req, res) => {
    seen.push({ url: req.url, auth: req.headers.authorization });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ value: 42, secret: 'never-public' }));
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => upstream.close(resolve)));
  const directory = await mkdtemp(join(tmpdir(), 'perch-connections-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = await createConfigStore({
    configPath: join(root, 'config.json'),
    statePath: join(directory, 'site.json'),
  });
  const app = await createApplication({
    root,
    store,
    env: { ADMIN_PASSWORD: 'test-admin', WIDGET_TEST_TOKEN: 'test-env-only' },
  });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => app.close(resolve)));
  const base = `http://127.0.0.1:${app.address().port}`;
  const headers = {
    Authorization: 'Basic ' + Buffer.from('admin:test-admin').toString('base64'),
    Origin: base,
    'Content-Type': 'application/json',
  };
  const draft = { ...connection, baseUrl: `http://127.0.0.1:${upstream.address().port}/proxy` };
  const payload = { widget: widget(), connections: [draft] };
  for (const endpoint of ['widget-preview', 'widget-inspect']) {
    assert.equal(
      (
        await fetch(base + '/api/admin/' + endpoint, {
          method: 'POST',
          headers: { Origin: base, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      ).status,
      401,
    );
    const response = await fetch(base + '/api/admin/' + endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.ok(!/test-env-only|never-public|WIDGET_TEST/.test(text));
  }
  assert.ok(
    seen.every(
      (s) => s.auth === 'Bearer test-env-only' && s.url === '/proxy/api/value?label=a+%26+b',
    ),
  );
  const invalid = await fetch(base + '/api/admin/widget-preview', {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...payload, connections: [] }),
  });
  assert.equal(invalid.status, 400);
  await assert.rejects(() => loadWidget(widget(), fetch, {}, [draft]), /缺少密钥/);
  const config = { ...store.get(), connections: [draft], widgets: [widget()] };
  const saved = await fetch(base + '/api/admin/config', {
    method: 'PUT',
    headers: { ...headers, 'If-Match': store.version },
    body: JSON.stringify(config),
  });
  assert.equal(saved.status, 200);
  const { document } = parseHTML(await (await fetch(base)).text());
  const fragmentPath = document.querySelector('[data-module="widget-one"]').dataset.fragment;
  const fragment = await fetch(base + fragmentPath);
  assert.equal(fragment.status, 200);
  const html = await fragment.text();
  assert.match(html, /42/);
  assert.ok(!/test-env-only|WIDGET_TEST|127.0.0.1|never-public/.test(html));
});

test('connection editor refresh keeps callbacks, invalidates previews and blocks referenced deletion', async (t) => {
  const { mountConnections, refreshConnections } = await import('../public/admin/connections.js');
  const { document, window } = parseHTML(
    '<html><body><form><div id="connections-editor"></div><div id="widgets-editor"><details class="widget-editor"><div></div></details></div></form></body></html>',
  );
  const previous = { document: globalThis.document, Event: globalThis.Event };
  Object.assign(globalThis, { document, Event: window.Event });
  t.after(() => Object.assign(globalThis, previous));
  window.HTMLElement.prototype.setCustomValidity = function (message) {
    this.customError = message;
  };
  Object.defineProperty(window.HTMLElement.prototype, 'validity', {
    get() {
      return { valid: !this.customError };
    },
  });
  const config = { connections: [structuredClone(connection)], widgets: [widget()] };
  let redraws = 0,
    invalidations = 0;
  document
    .querySelector('#widgets-editor .widget-editor > div')
    .addEventListener('input', () => invalidations++);
  const target = document.querySelector('#connections-editor');
  mountConnections(target, config, () => redraws++);
  refreshConnections(target);
  const baseInput = [...target.querySelectorAll('input')][1];
  baseInput.value = 'https://example.com/new-prefix';
  baseInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(invalidations, 1);
  assert.equal(config.connections[0].baseUrl, baseInput.value);
  baseInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(redraws, 1);
  target.querySelector('button').onclick();
  assert.equal(config.connections.length, 1);
  assert.match(target.textContent, /无法删除/);
  const headers = target.querySelector('textarea');
  headers.value = '{';
  headers.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.ok(headers.customError);
  refreshConnections(target);
  assert.equal(target.querySelector('textarea').value, '{');
});

test('preset-created connections are atomic at widget limit and support fixed-origin APIs', async (t) => {
  const { mountPresetPicker } = await import('../public/admin/preset-picker.js');
  const { document, window } = parseHTML(
    '<html><body><div id="preset-picker"></div><div id="connections-editor"></div></body></html>',
  );
  const previous = { document: globalThis.document, Event: globalThis.Event };
  Object.assign(globalThis, { document, Event: window.Event });
  t.after(() => Object.assign(globalThis, previous));
  window.HTMLElement.prototype.setCustomValidity = function () {};
  Object.defineProperty(window.HTMLSelectElement.prototype, 'value', {
    configurable: true,
    get() {
      return this.querySelector('option[selected]')?.value || '';
    },
    set(value) {
      for (const o of this.querySelectorAll('option'))
        o.toggleAttribute('selected', o.value === value);
    },
  });
  const config = { connections: [], widgets: Array.from({ length: 20 }, () => widget()) };
  let added;
  const target = document.querySelector('#preset-picker');
  mountPresetPicker(
    target,
    (w) => {
      added = w;
    },
    config,
  );
  const select = target.querySelector('select');
  select.value = 'github';
  select.onchange();
  const connectionSelect = target.querySelectorAll('select')[1];
  connectionSelect.value = '@new';
  connectionSelect.dispatchEvent(new window.Event('change'));
  for (const label of target.querySelectorAll('label')) {
    const text = label.querySelector('span')?.textContent;
    if (text === '仓库所有者') {
      const input = label.querySelector('input');
      input.value = 'octocat';
      input.dispatchEvent(new window.Event('input'));
    }
    if (text === '仓库名') {
      const input = label.querySelector('input');
      input.value = 'Hello-World';
      input.dispatchEvent(new window.Event('input'));
    }
  }
  const add = target.querySelector('button');
  add.onclick();
  assert.equal(config.connections.length, 0);
  assert.equal(added, undefined);
  config.widgets = [];
  add.onclick();
  assert.equal(config.connections.length, 1);
  assert.equal(config.connections[0].baseUrl, 'https://api.github.com');
  assert.equal(added.source.kind, 'connection');
  assert.match(added.source.path, /\/repos\/octocat\/Hello-World/);
  config.connections.push({ ...connection, id: 'late', name: 'Added later' });
  connectionSelect.onfocus();
  assert.match(connectionSelect.textContent, /Added later/);
});
