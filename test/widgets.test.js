import test from 'node:test';
import assert from 'node:assert/strict';
import { validateWidget, getPath, mapWidget, loadWidget } from '../src/widgets.js';
import { validateConfig } from '../src/admin.js';
import { readFile } from 'node:fs/promises';

const widget = (changes) =>
  validateWidget({
    id: 'test',
    title: '测试指标',
    type: 'metric',
    source: { kind: 'static', data: { value: 0 } },
    ...changes,
  });
test('All six templates normalize only selected fields', () => {
  assert.deepEqual(mapWidget(widget(), { value: 0, secret: 'do not publish' }), { value: 0 });
  const metrics = widget({
    type: 'metrics',
    fields: [{ label: 'CPU', path: 'data.cpu', unit: '%' }],
  });
  assert.deepEqual(mapWidget(metrics, { data: { cpu: 12 }, token: 'private' }), {
    values: [{ label: 'CPU', value: 12, unit: '%' }],
  });
  const text = widget({ type: 'text' });
  assert.deepEqual(mapWidget(text, { text: '<script>alert(1)</script>' }), {
    text: '<script>alert(1)</script>',
  });
  for (const type of ['list', 'links']) {
    const list = widget({
      type,
      mapping: { items: 'data.items', label: 'name', url: 'link', detail: 'note' },
      limit: 1,
    });
    assert.deepEqual(
      mapWidget(list, {
        data: {
          items: [
            { name: 'Item', link: 'javascript:alert(1)', note: 'hello', secret: 'private' },
            { name: 'Other' },
          ],
        },
      }),
      { items: [{ label: 'Item', url: '', detail: 'hello' }] },
    );
  }
  assert.deepEqual(
    mapWidget(widget({ type: 'progress', threshold: 80 }), { value: 110, max: 100 }),
    { value: 110, max: 100, percent: 100, warning: true },
  );
});
test('Paths support nested arrays but never execute code or access prototypes', () => {
  assert.equal(getPath({ data: [{ value: 5 }] }, 'data.0.value'), 5);
  assert.equal(getPath({}, 'constructor.name'), undefined);
  assert.equal(getPath(Object.create({ value: 2 }), 'value'), undefined);
  assert.equal(getPath({ value: 1 }, 'value()'), undefined);
  assert.throws(() => widget({ mapping: { value: '__proto__.x' } }));
});
test('Bad mappings fail explicitly rather than showing misleading zero', () => {
  for (const value of [undefined, null, '', true, {}, 'oops'])
    assert.throws(() => mapWidget(widget(), { value }));
  assert.throws(() => mapWidget(widget({ type: 'progress' }), { value: 1, max: 0 }));
  assert.throws(() => mapWidget(widget({ type: 'list' }), { items: {} }));
});
test('API credentials stay server-side, redirects fail closed, only mapped values returned', async () => {
  const api = widget({
    source: {
      kind: 'api',
      url: 'https://example.com/api',
      method: 'POST',
      headers: { Authorization: 'Bearer ${WIDGET_TOKEN}' },
      body: { query: 'balance' },
    },
    mapping: { value: 'account.balance' },
  });
  let called = false;
  const data = await loadWidget(
    api,
    async (url, options) => {
      called = true;
      assert.equal(options.headers.Authorization, 'Bearer test-secret');
      assert.equal(options.redirect, 'error');
      assert.equal(options.method, 'POST');
      assert.deepEqual(JSON.parse(options.body), { query: 'balance' });
      return new Response(JSON.stringify({ account: { balance: 42, password: 'private' } }));
    },
    { WIDGET_TOKEN: 'test-secret' },
  );
  assert.equal(called, true);
  assert.deepEqual(data, { value: 42 });
  await assert.rejects(
    loadWidget(
      api,
      () => {
        throw new Error('must not fetch');
      },
      {},
    ),
    /缺少密钥/,
  );
  assert.throws(() =>
    widget({ source: { ...api.source, headers: { Authorization: '${ADMIN_PASSWORD}' } } }),
  );
});
test('API malformed, oversized and failing responses are rejected', async () => {
  const api = widget({ source: { kind: 'api', url: 'https://example.com' } });
  await assert.rejects(
    loadWidget(api, async () => new Response('html')),
    /JSON/,
  );
  await assert.rejects(
    loadWidget(api, async () => new Response('denied', { status: 403 })),
    /403/,
  );
  await assert.rejects(
    loadWidget(api, async () => new Response('x'.repeat(1024 * 1024 + 1))),
    /MiB/,
  );
});
test('Old configs migrate; widget titles, visibility and source survive saves', async () => {
  const base = JSON.parse(await readFile(new URL('../config.json', import.meta.url)));
  assert.deepEqual(validateConfig(base).widgets, []);
  base.widgets = [widget()];
  base.titles = { status: '我的服务' };
  base.layout = { density: 'compact', hidden: ['widget-test'] };
  const next = validateConfig(base);
  assert.equal(next.titles.status, '我的服务');
  assert.equal(next.widgets[0].source.data.value, 0);
  assert.deepEqual(next.layout.hidden, ['widget-test']);
  base.widgets.push(widget());
  assert.throws(() => validateConfig(base), /重复/);
});
