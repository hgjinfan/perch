import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import { startPresetServices } from './helpers/preset-services.js';
import { catalogPresets, buildPreset } from '../public/admin/preset-definitions.js';
import { createApplication } from '../src/application.js';
import { createConfigStore } from '../src/config/store.js';
async function fixture(t) {
  const upstream = await startPresetServices();
  t.after(() => upstream.close());
  const root = fileURLToPath(new URL('../', import.meta.url));
  const directory = await mkdtemp(join(tmpdir(), 'perch-preset-http-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = await createConfigStore({
    configPath: join(root, 'config.json'),
    statePath: join(directory, 'site.json'),
  });
  // Use native fetch and real loopback HTTP sockets throughout the application.
  const server = await createApplication({
    root,
    store,
    env: { ...upstream.env, ADMIN_PASSWORD: 'preset-test-admin' },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = {
    Authorization: 'Basic ' + Buffer.from('admin:preset-test-admin').toString('base64'),
    Origin: base,
    'Content-Type': 'application/json',
  };
  const widgets = Object.entries(upstream.services).map(([key, service]) =>
    buildPreset(key, { ...service.values, env: catalogPresets[key].env, auth: 'env' }, key),
  );
  const request = (path, options = {}) =>
    fetch(base + path, { ...options, headers: { ...headers, ...options.headers } });
  const preview = (widget) =>
    request('/api/admin/widget-preview', { method: 'POST', body: JSON.stringify(widget) });
  return { ...upstream, store, base, widgets, request, preview };
}
function assertContent(key, html) {
  const { document } = parseHTML(html);
  if (key === 'home-assistant-sensor')
    assert.equal(document.querySelector('.widget-value').textContent, '23.5°C');
  if (key === 'proxmox-node')
    assert.deepEqual(
      [...document.querySelectorAll('.widget-number')].map((node) => node.textContent),
      ['12.5%', '2GiB', '3GiB'],
    );
  if (key === 'prometheus')
    assert.equal(document.querySelector('.widget-value').textContent, '7个');
  if (key === 'jellyfin-version')
    assert.equal(document.querySelector('.widget-text').textContent, '10.11.0');
  assert.ok(!/test-secret|never-public|WIDGET_|Authorization/.test(html));
}
test('four preset services work over HTTP through preview, config save, public fragments and cache hits', async (t) => {
  const lab = await fixture(t);
  assert.equal((await fetch(lab.base + '/api/admin/config')).status, 401);
  for (const widget of lab.widgets) {
    const response = await lab.preview(widget);
    assert.equal(response.status, 200, widget.id);
    assertContent(widget.id, await response.text());
    assert.equal(lab.services[widget.id].requests.length, 1);
  }
  const config = await lab.request('/api/admin/config');
  const value = await config.json();
  value.widgets = lab.widgets;
  const save = await lab.request('/api/admin/config', {
    method: 'PUT',
    headers: { 'If-Match': config.headers.get('etag') },
    body: JSON.stringify(value),
  });
  assert.equal(save.status, 200);
  assert.ok(!JSON.stringify(await save.json()).includes('test-secret'));
  const home = await (await fetch(lab.base + '/')).text();
  const { document } = parseHTML(home);
  for (const widget of lab.widgets) {
    const path = document.querySelector(`[data-module="widget-${widget.id}"]`).dataset.fragment;
    const response = await fetch(lab.base + path);
    assert.equal(response.status, 200);
    assertContent(widget.id, await response.text());
    const count = lab.services[widget.id].requests.length;
    const repeat = await fetch(lab.base + path);
    assert.equal(repeat.status, 200);
    assert.equal(
      lab.services[widget.id].requests.length,
      count,
      'cache hit must not refetch upstream',
    );
  }
  assert.equal(lab.services.prometheus.requests[0].query, 'sum(up)');
  assert.equal(
    lab.services['proxmox-node'].requests[0].authorization,
    'PVEAPIToken=monitor@pve!perch=pve-test-secret',
  );
  assert.equal(lab.services['jellyfin-version'].requests[0].authorization, undefined);
});
test('preset HTTP errors fail clearly: wrong token, unavailable entity, empty vector and malformed JSON', async (t) => {
  const lab = await fixture(t);
  const ha = lab.widgets.find((widget) => widget.id === 'home-assistant-sensor');
  const missing = structuredClone(ha);
  missing.source.headers.Authorization = 'Bearer ${WIDGET_MISSING_TOKEN}';
  const missingResponse = await lab.preview(missing);
  assert.equal(missingResponse.status, 422);
  assert.match((await missingResponse.json()).error, /缺少密钥/);
  assert.equal(lab.services[ha.id].requests.length, 0);
  const wrong = structuredClone(ha);
  wrong.source.headers.Authorization = 'Bearer wrong';
  let response = await lab.preview(wrong);
  assert.equal(response.status, 422);
  assert.match((await response.json()).error, /401/);
  lab.services[ha.id].mode = 'bad-shape';
  response = await lab.preview(ha);
  assert.equal(response.status, 422);
  assert.match((await response.json()).error, /有效数字/);
  const prom = lab.widgets.find((widget) => widget.id === 'prometheus');
  lab.services.prometheus.mode = 'bad-shape';
  response = await lab.preview(prom);
  assert.equal(response.status, 422);
  assert.match((await response.json()).error, /有效数字/);
  const jelly = lab.widgets.find((widget) => widget.id === 'jellyfin-version');
  lab.services[jelly.id].mode = 'bad-json';
  response = await lab.preview(jelly);
  assert.equal(response.status, 422);
  assert.match((await response.json()).error, /有效 JSON/);
  const pve = lab.widgets.find((widget) => widget.id === 'proxmox-node');
  lab.services[pve.id].mode = 'redirect';
  response = await lab.preview(pve);
  assert.equal(response.status, 422);
  assert.ok(!lab.services[pve.id].requests.some((request) => request.path === '/unexpected'));
});

test('failed preset data renders a non-cacheable public error rather than a misleading zero', async (t) => {
  const lab = await fixture(t);
  const response = await lab.request('/api/admin/config');
  const config = await response.json();
  config.widgets = lab.widgets.filter((widget) =>
    ['home-assistant-sensor', 'prometheus'].includes(widget.id),
  );
  lab.services['home-assistant-sensor'].mode = 'unavailable';
  lab.services.prometheus.mode = 'bad-shape';
  const saved = await lab.request('/api/admin/config', {
    method: 'PUT',
    headers: { 'If-Match': response.headers.get('etag') },
    body: JSON.stringify(config),
  });
  assert.equal(saved.status, 200);
  const { document } = parseHTML(await (await fetch(lab.base + '/')).text());
  for (const widget of config.widgets) {
    const path = document.querySelector(`[data-module="widget-${widget.id}"]`).dataset.fragment;
    const result = await fetch(lab.base + path);
    assert.equal(result.status, 503);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    const html = await result.text();
    assert.ok(!/test-secret|never-public|widget-value/.test(html));
    const count = lab.services[widget.id].requests.length;
    assert.equal((await fetch(lab.base + path)).status, 503);
    assert.equal(
      lab.services[widget.id].requests.length,
      count,
      'failed result backoff must avoid repeatedly hitting upstream',
    );
  }
});
