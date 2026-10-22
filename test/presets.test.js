import test from 'node:test';
import assert from 'node:assert/strict';
import { sourcePresets, buildPreset } from '../public/admin/preset-definitions.js';
import { validateWidget, loadWidget } from '../src/widgets.js';
import { mapWidget } from '../shared/widget-types.js';
import { validateConfig } from '../src/config/schema.js';
import { createBackup, parseBackup } from '../src/config/backups.js';
import { readFile } from 'node:fs/promises';
const values = {
  base: 'https://service.example.com/prefix/',
  owner: 'owner',
  repo: 'repo',
  slug: 'public',
  monitor: '12',
  server: '2',
  env: 'WIDGET_TEST_TOKEN',
  auth: 'env',
};
const fixtures = {
  github: { stargazers_count: 8, forks_count: 2, open_issues_count: 3 },
  gitea: { stars_count: 8, forks_count: 2, open_issues_count: 3 },
  immich: { photos: 12, videos: 3, usage: 2147483648 },
  kuma: { uptimeList: { '12_24': 0.9998 } },
  nezha: { success: true, data: [{ name: 'VPS', id: 2, ip: 'never-show' }] },
  'nezha-legacy': {
    code: 0,
    result: [{ status: { CPU: 12.5, MemUsed: 1073741824, DiskUsed: 2147483648 } }],
  },
};
test('all presets generate valid editable widgets and map only intended fields', async () => {
  for (const [key, definition] of Object.entries(sourcePresets)) {
    const widget = validateWidget(buildPreset(key, values, `preset-${key}`));
    assert.equal(widget.type, definition.type);
    let request;
    const data = await loadWidget(
      widget,
      async (url, options) => {
        request = { url, options };
        return new Response(JSON.stringify(fixtures[key]));
      },
      { WIDGET_TEST_TOKEN: 'server-only-secret' },
    );
    assert.equal(request.options.method, 'GET');
    assert.equal(request.options.redirect, 'error');
    assert.ok(!JSON.stringify(widget).includes('server-only-secret'));
    assert.ok(!JSON.stringify(data).includes('server-only-secret'));
    assert.ok(!JSON.stringify(data).includes('never-show'));
    if (key === 'immich') assert.equal(data.values[2].value, 2);
    if (key === 'kuma') assert.equal(data.value, 99.98);
    if (key === 'nezha-legacy')
      assert.deepEqual(
        data.values.map((f) => f.value),
        [12.5, 1, 2],
      );
    if (key !== 'github')
      assert.ok(request.url.startsWith('https://service.example.com/prefix/api/'));
    if (key === 'immich') assert.equal(request.options.headers['x-api-key'], 'server-only-secret');
    if (key === 'nezha-legacy')
      assert.equal(request.options.headers.Authorization, 'server-only-secret');
    if (key === 'nezha')
      assert.equal(request.options.headers.Authorization, 'Bearer server-only-secret');
  }
});
test('optional authentication, path encoding and input validation do not silently invent working defaults', () => {
  const publicWidget = buildPreset('github', { ...values, auth: 'none' }, 'public');
  assert.equal(publicWidget.source.headers.Authorization, undefined);
  assert.ok(
    buildPreset('gitea', values, 'gitea').source.headers.Authorization.startsWith('token ${'),
  );
  for (const [key, input] of [
    ['missing', values],
    ['toString', values],
    ['github', { ...values, owner: undefined }],
    ['github', { ...values, repo: null }],
    ['github', { ...values, owner: '' }],
    ['github', { ...values, repo: '../x' }],
    ['github', { ...values, env: 'SECRET_TOKEN' }],
    ['immich', { ...values, base: 'javascript:alert(1)' }],
    ['immich', { ...values, base: 'https://user:password@example.com' }],
    ['immich', { ...values, base: 'https://example.com?x=1' }],
    ['kuma', { ...values, monitor: '1.foo' }],
    ['nezha-legacy', { ...values, server: '-1' }],
  ])
    assert.throws(() => buildPreset(key, input, 'invalid'));
});
test('missing credentials, wrong API generation and malformed data fail instead of showing zero', async () => {
  const widget = validateWidget(buildPreset('immich', values, 'immich'));
  await assert.rejects(
    loadWidget(
      widget,
      async () => {
        throw new Error('should not fetch');
      },
      {},
    ),
    /缺少密钥/,
  );
  assert.throws(() => mapWidget(widget, { error: 'not authorized' }), /有效数字/);
  assert.throws(
    () => mapWidget(validateWidget(buildPreset('nezha', values, 'nezha')), { result: [] }),
    /数组/,
  );
  assert.throws(
    () => mapWidget(validateWidget(buildPreset('kuma', values, 'kuma')), { uptimeList: {} }),
    /有效数字/,
  );
});
test('numeric multipliers remain finite, validate bounds and survive backup roundtrip', async () => {
  const widget = buildPreset('kuma', values, 'uptime');
  for (const scale of [0, -1, Infinity, NaN, '100', 1e13])
    assert.throws(() => validateWidget({ ...widget, scale }));
  assert.throws(
    () => mapWidget({ ...widget, scale: 1e12 }, { uptimeList: { '12_24': 1e308 } }),
    /超出范围/,
  );
  const raw = JSON.parse(await readFile(new URL('../config.json', import.meta.url)));
  const config = validateConfig({
    ...raw,
    widgets: [widget, buildPreset('immich', values, 'immich')],
  });
  assert.deepEqual(parseBackup(createBackup(config)), config);
  assert.equal(config.widgets[0].scale, 100);
  assert.equal(config.widgets[1].fields[2].scale, 1 / 1073741824);
});
