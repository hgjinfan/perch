import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { inspectConfiguration } from '../src/services/config-health.js';
import { createDiagnosticExport } from '../src/services/diagnostic-export.js';
import { validateConfig } from '../src/config/schema.js';
import { createApplication } from '../src/application.js';
import { renderConfigHealth } from '../public/admin/config-health.js';
import { parseHTML } from 'linkedom';
const root = fileURLToPath(new URL('../', import.meta.url));
const raw = JSON.parse(await readFile(root + '/config.json', 'utf8'));
function fixture() {
  return validateConfig({
    ...raw,
    connections: [
      {
        id: 'private-id',
        name: 'private-name',
        baseUrl: 'https://private.example/proxy',
        headers: { Authorization: 'Bearer ${WIDGET_PRIVATE_TOKEN}' },
      },
    ],
    widgets: [
      {
        id: 'private-widget',
        title: 'private-title',
        type: 'metric',
        source: { kind: 'connection', connectionId: 'private-id', path: '/api/value' },
        mapping: { value: 'value' },
      },
    ],
  });
}

test('config check identifies missing variables, unused connections and invalid static mappings without retaining values', () => {
  const config = fixture();
  config.connections.push({ ...config.connections[0], id: 'unused' });
  config.widgets.push({
    ...config.widgets[0],
    id: 'static',
    source: { kind: 'static', data: { wrong: 1 } },
  });
  const report = inspectConfiguration(config, {});
  assert.ok(
    report.findings.some(
      (f) =>
        f.code === 'missing_credentials' && f.missingVariables.includes('WIDGET_PRIVATE_TOKEN'),
    ),
  );
  assert.ok(report.findings.some((f) => f.code === 'unused_connection'));
  assert.ok(report.findings.some((f) => f.code === 'static_mapping'));
  assert.ok(!JSON.stringify(report).includes('private.example'));
  const healthy = inspectConfiguration(fixture(), { WIDGET_PRIVATE_TOKEN: 'server-secret' });
  assert.equal(healthy.findings.length, 0);
  assert.ok(!JSON.stringify(healthy).includes('server-secret'));
  const literal = fixture();
  literal.connections[0].headers.Authorization = 'Bearer literal-secret';
  literal.widgets[0].source.body = { auth: { password: 'body-secret' } };
  const issues = inspectConfiguration(literal, {});
  assert.equal(
    issues.findings.filter((f) => ['literal_credentials', 'parameter_credentials'].includes(f.code))
      .length,
    2,
  );
  assert.ok(!/literal-secret|body-secret/.test(JSON.stringify(issues)));
});

test('runtime advice distinguishes untested, stale failures and recovered observations', () => {
  const config = fixture();
  const source = {
    id: 'widget:private-widget',
    name: 'private-name',
    kind: 'widget',
    enabled: true,
    configured: true,
    state: 'idle',
  };
  assert.equal(
    inspectConfiguration(config, { WIDGET_PRIVATE_TOKEN: 'x' }, { sources: [source] }).summary
      .unchecked,
    1,
  );
  const stale = inspectConfiguration(
    config,
    { WIDGET_PRIVATE_TOKEN: 'x' },
    {
      sources: [
        { ...source, state: 'stale', error: { code: 'mapping', message: 'secret raw error' } },
      ],
    },
  );
  assert.equal(stale.findings[0].severity, 'warning');
  assert.match(stale.findings[0].advice, /空结果/);
  assert.ok(!JSON.stringify(stale).includes('secret raw error'));
  const ready = inspectConfiguration(
    config,
    { WIDGET_PRIVATE_TOKEN: 'x' },
    { sources: [{ ...source, state: 'ready', error: { code: 'mapping' } }] },
  );
  assert.equal(ready.findings.length, 0);
});

test('diagnostic export uses a strict whitelist even with adversarial source metadata', () => {
  const config = fixture();
  const diagnostics = {
    sources: [
      {
        id: 'private-id',
        name: 'private-name',
        kind: 'widget',
        state: 'error',
        enabled: true,
        configured: true,
        cacheState: 'empty',
        httpStatus: 403,
        headers: { Authorization: 'secret' },
        url: 'https://private.example',
        raw: 'secret-body',
        error: { code: 'authentication', message: 'secret-error' },
        durationMs: 12,
      },
    ],
  };
  const health = inspectConfiguration(config, {}, diagnostics);
  const report = createDiagnosticExport(config, diagnostics, health, {
    active: 1,
    origin: 'private.example',
    token: 'secret-runtime',
  });
  assert.equal(report.sources[0].reference, 'source-1');
  assert.equal(report.sources[0].lastErrorCode, 'authentication');
  assert.equal(report.runtime.active, 1);
  assert.ok(
    !/private-id|private-name|private-title|private-widget|private.example|WIDGET_PRIVATE_TOKEN|secret|Authorization/.test(
      JSON.stringify(report),
    ),
  );
  assert.equal(report.format, 'perch-diagnostics');
  assert.equal(report.schemaVersion, 1);
});

test('health and export routes require admin auth, never fetch upstream and honor BASE_PATH', async (t) => {
  const config = fixture();
  let calls = 0;
  const app = await createApplication({
    root,
    store: { get: () => config, revision: 0 },
    env: { ADMIN_PASSWORD: 'health-test', BASE_PATH: '/perch' },
    fetcher: async () => {
      calls++;
      throw new Error('must not fetch');
    },
  });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => app.close(resolve)));
  const base = `http://127.0.0.1:${app.address().port}/perch`;
  const headers = { Authorization: 'Basic ' + Buffer.from('admin:health-test').toString('base64') };
  for (const path of ['/api/admin/config-check', '/api/admin/diagnostics/export']) {
    assert.equal((await fetch(base + path)).status, 401);
    const response = await fetch(base + path, { headers });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const text = await response.text();
    assert.ok(!text.includes('private.example'));
    if (path.endsWith('/export')) {
      assert.match(response.headers.get('content-disposition'), /attachment/);
      assert.ok(!/private-name|WIDGET_PRIVATE/.test(text));
    }
    assert.equal((await fetch(base + path, { method: 'POST', headers })).status, 405);
  }
  const admin = await fetch(base + '/admin', { headers });
  assert.match(await admin.text(), /href="\/perch\/api\/admin\/diagnostics\/export"/);
  assert.equal(calls, 0);
});

test('health UI shows missing variable names as text and discards stale responses', async (t) => {
  const { document } = parseHTML(
    '<html><body><div id="root"><p id="health-message"></p><div id="health-findings"></div></div></body></html>',
  );
  const previous = { document: globalThis.document, fetch: globalThis.fetch };
  Object.assign(globalThis, { document });
  t.after(() => Object.assign(globalThis, previous));
  const target = document.querySelector('#root');
  globalThis.fetch = async () =>
    Response.json({ ...inspectConfiguration(fixture(), {}), generatedAt: 1 });
  await renderConfigHealth(target);
  assert.match(target.textContent, /WIDGET_PRIVATE_TOKEN/);
  assert.match(target.textContent, /不代表服务在线/);
  const before = target.querySelector('#health-findings').textContent;
  globalThis.fetch = async () =>
    Response.json({
      summary: { errors: 0, warnings: 0, information: 0, unchecked: 0 },
      findings: [],
    });
  await renderConfigHealth(target, () => false);
  assert.equal(target.querySelector('#health-findings').textContent, before);
});
