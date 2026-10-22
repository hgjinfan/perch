import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createDiagnostics, classifyFailure } from '../src/diagnostics.js';
import { createCache } from '../src/data.js';
import { createDashboardService } from '../src/services/dashboard.js';
import { createApplication } from '../src/application.js';
import { validateConfig } from '../src/config/schema.js';
const root = fileURLToPath(new URL('../', import.meta.url));
const raw = JSON.parse(await readFile(root + '/config.json', 'utf8'));
const widget = {
  id: 'api',
  title: 'API',
  type: 'metric',
  source: {
    kind: 'api',
    url: 'https://private.example/value?token=private-query',
    headers: { Authorization: 'Bearer ${WIDGET_TEST_TOKEN}' },
  },
  mapping: { value: 'value' },
  refresh: 30,
};
const rss =
  '<rss><channel><item><title>Hello</title><link>https://example.com/article</link></item></channel></rss>';
function fixture() {
  let config = validateConfig({
    ...raw,
    services: [{ id: 'svc', name: 'Service', url: 'https://private.example/health' }],
    feeds: [{ id: 'feed', name: 'Feed', url: 'https://private.example/feed', site: '', limit: 5 }],
    widgets: [widget],
  });
  return {
    get: () => config,
    revision: 0,
    replace(value) {
      config = validateConfig(value);
      this.revision++;
    },
  };
}
test('fixed diagnostic categories discard sensitive error text and retain only safe HTTP codes', () => {
  for (const [error, expected] of [
    [new Error('API 返回 HTTP 401'), 'authentication'],
    [new Error('HTTP 429'), 'rate_limit'],
    [new DOMException('https://private.example?token=secret', 'TimeoutError'), 'timeout'],
    [new SyntaxError('secret payload'), 'format'],
    [new Error('映射字段 secret-path 无效'), 'mapping'],
    [new Error('缺少密钥环境变量'), 'credentials'],
    [new Error('Invalid current weather'), 'format'],
    [new Error('No valid hourly weather'), 'format'],
    [new Error('Response too large'), 'size'],
    [new Error('fetch failed https://private.example?token=secret'), 'network'],
  ]) {
    const result = classifyFailure(error);
    assert.equal(result.code, expected);
    assert.ok(!JSON.stringify(result).includes('secret'));
    assert.ok(!JSON.stringify(result).includes('private.example'));
  }
});
test('cache observations distinguish real attempts, hits, stale fallback and synchronous recovery', async () => {
  let clock = 1000,
    fail = false,
    calls = 0;
  const records = createDiagnostics({ now: () => clock });
  const cache = createCache(() => clock, { onEvent: (event) => records.observe(event) });
  const loader = () => {
    calls++;
    if (fail) throw Error('HTTP 401');
    return { value: 42 };
  };
  await cache('widget:api', 100, loader);
  const first = records.get('widget:api');
  assert.equal(first.lastSuccessAt, 1000);
  assert.equal(first.state, 'ready');
  clock = 1050;
  await cache('widget:api', 100, loader);
  assert.equal(calls, 1);
  assert.equal(records.get('widget:api').lastAttemptAt, 1000);
  clock = 1101;
  fail = true;
  const stale = await cache('widget:api', 100, loader);
  assert.equal(stale.state, 'stale');
  const failed = records.get('widget:api');
  assert.equal(failed.lastSuccessAt, 1000);
  assert.equal(failed.lastFailureAt, 1101);
  assert.equal(failed.error.code, 'authentication');
  assert.equal(failed.cacheState, 'backoff');
  assert.ok(!JSON.stringify(stale).includes('authentication'));
  clock = 31102;
  fail = false;
  await cache('widget:api', 100, loader);
  assert.equal(calls, 3);
  assert.equal(records.get('widget:api').state, 'ready');
  assert.equal(records.get('widget:api').failures, 0);
  const harmless = createCache(() => clock, {
    onEvent: () => {
      throw Error('observer failed');
    },
  });
  assert.equal((await harmless('a', 1, () => ({ ok: true }))).state, 'ready');
});
test('passive feed/widget/service diagnostics share caches and never include raw sources or tokens', async () => {
  const store = fixture();
  let calls = 0;
  const dashboard = createDashboardService(store, {
    env: { WIDGET_TEST_TOKEN: 'runtime-secret' },
    fetcher: async (url) => {
      calls++;
      if (url.endsWith('/feed')) return new Response(rss);
      if (url.endsWith('/health')) return new Response(null, { status: 401 });
      return new Response('{"value":9}');
    },
  });
  assert.ok(dashboard.diagnostics().sources.every((s) => s.state === 'idle'));
  assert.equal(calls, 0);
  await dashboard.feed('feed');
  await dashboard.widget('api');
  await dashboard.status();
  const report = dashboard.diagnostics(),
    text = JSON.stringify(report);
  assert.equal(calls, 3);
  assert.ok(
    !/private.example|runtime-secret|private-query|Authorization|latitude|longitude/.test(text),
  );
  const service = report.sources.find((s) => s.id === 'service:svc');
  assert.equal(service.state, 'ready');
  assert.equal(service.httpStatus, 401);
  await dashboard.checkDiagnostic('feed:feed');
  assert.equal(calls, 3);
  store.replace({ ...store.get(), title: 'new' });
  assert.ok(dashboard.diagnostics().sources.every((s) => s.state === 'idle'));
});
test('missing secret, format and mapping failures classify without leaking data', async () => {
  for (const [env, body, code] of [
    [{}, '{"value":1}', 'credentials'],
    [{ WIDGET_TEST_TOKEN: 'runtime-secret' }, 'not-json runtime-secret', 'format'],
    [{ WIDGET_TEST_TOKEN: 'runtime-secret' }, '{"secret":"runtime-secret"}', 'mapping'],
  ]) {
    const dashboard = createDashboardService(fixture(), {
      env,
      fetcher: async () => new Response(body),
    });
    const report = await dashboard.checkDiagnostic('widget:api'),
      source = report.sources.find((s) => s.id === 'widget:api');
    assert.equal(source.state, 'error');
    assert.equal(source.error.code, code);
    assert.ok(!JSON.stringify(report).includes('runtime-secret'));
  }
});
test('default weather diagnostics never invoke IP lookup or retain visitor location metadata', async () => {
  const store = fixture();
  store.replace({ ...store.get(), weather: { ...store.get().weather, mode: 'ip' } });
  let calls = 0;
  const dashboard = createDashboardService(store, {
    fetcher: async (url) => {
      calls++;
      assert.ok(url.startsWith('https://api.open-meteo.com/'));
      return new Response('{"current":{}}');
    },
  });
  const report = await dashboard.checkDiagnostic('weather');
  assert.equal(calls, 1);
  const source = report.sources.find((s) => s.id === 'weather');
  assert.equal(source.error.code, 'format');
  assert.ok(!/ipwho|latitude|longitude|London|51.5074/.test(JSON.stringify(report)));
});
test('hidden/unknown diagnostics reject without requests, in-flight old records cannot repopulate new config', async () => {
  const store = fixture();
  let release;
  const dashboard = createDashboardService(store, {
    env: { WIDGET_TEST_TOKEN: 'x' },
    fetcher: () => new Promise((r) => (release = r)),
  });
  const pending = dashboard.checkDiagnostic('feed:feed');
  await Promise.resolve();
  await Promise.resolve();
  store.replace({ ...store.get(), layout: { ...store.get().layout, hidden: ['feed-feed'] } });
  dashboard.diagnostics();
  release(new Response(rss));
  await assert.rejects(pending, (error) => error.status === 409);
  assert.equal(dashboard.diagnostics().sources.find((s) => s.id === 'feed:feed').state, 'idle');
  await assert.rejects(dashboard.checkDiagnostic('feed:feed'), (error) => error.status === 404);
  await assert.rejects(dashboard.checkDiagnostic('unknown'), (error) => error.status === 404);
});
test('admin diagnostic routes require authentication and same-origin POST; GET is read-only', async (t) => {
  const store = fixture();
  let calls = 0;
  const server = await createApplication({
    root,
    store,
    env: { ADMIN_PASSWORD: 'isolated-test' },
    fetcher: async () => {
      calls++;
      return new Response(rss);
    },
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`,
    headers = { Authorization: 'Basic ' + Buffer.from('admin:isolated-test').toString('base64') };
  assert.equal((await fetch(base + '/api/admin/diagnostics')).status, 401);
  const read = await fetch(base + '/api/admin/diagnostics', { headers });
  assert.equal(read.status, 200);
  assert.equal(read.headers.get('cache-control'), 'no-store');
  assert.equal(calls, 0);
  assert.equal(
    (
      await fetch(base + '/api/admin/diagnostics/check', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: '{"id":"feed:feed"}',
      })
    ).status,
    403,
  );
  const check = await fetch(base + '/api/admin/diagnostics/check', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json', Origin: base },
    body: '{"id":"feed:feed"}',
  });
  assert.equal(check.status, 200);
  assert.equal(calls, 1);
  assert.ok(!(await check.text()).includes('private.example'));
});

test('diagnostic probes coalesce and bound concurrency without starting rejected upstream work', async () => {
  const store = fixture();
  let calls = 0;
  const releases = [];
  const dashboard = createDashboardService(store, {
    env: { WIDGET_TEST_TOKEN: 'test' },
    fetcher: (url) => {
      calls++;
      return new Promise((resolve) =>
        releases.push(() => resolve(new Response(url.endsWith('/feed') ? rss : '{"value":1}'))),
      );
    },
  });
  const first = dashboard.checkDiagnostic('feed:feed'),
    duplicate = dashboard.checkDiagnostic('feed:feed'),
    second = dashboard.checkDiagnostic('widget:api');
  await Promise.resolve();
  await Promise.resolve();
  await assert.rejects(
    dashboard.checkDiagnostic('weather'),
    (error) => error.status === 429 && error.retryAfter === 2,
  );
  assert.equal(calls, 2);
  for (const release of releases) release();
  await Promise.all([first, duplicate, second]);
  assert.equal(calls, 2);
});
test('empty successful API responses are classified as format errors', async () => {
  const dashboard = createDashboardService(fixture(), {
    env: { WIDGET_TEST_TOKEN: 'test' },
    fetcher: async () => new Response(null, { status: 204 }),
  });
  const result = await dashboard.checkDiagnostic('widget:api');
  assert.equal(result.sources.find((s) => s.id === 'widget:api').error.code, 'format');
});

test('new config probes never reuse old-generation tasks while the global concurrency budget remains bounded', async () => {
  const store = fixture(),
    releases = [];
  let calls = 0;
  const dashboard = createDashboardService(store, {
    fetcher: () => {
      calls++;
      return new Promise((resolve) => releases.push(() => resolve(new Response(rss))));
    },
  });
  const old = dashboard.checkDiagnostic('feed:feed');
  await Promise.resolve();
  await Promise.resolve();
  store.replace({
    ...store.get(),
    feeds: [{ ...store.get().feeds[0], url: 'https://changed.example/feed' }],
  });
  const fresh = dashboard.checkDiagnostic('feed:feed');
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(calls, 2);
  await assert.rejects(dashboard.checkDiagnostic('weather'), (error) => error.status === 429);
  releases[0]();
  await assert.rejects(old, (error) => error.status === 409);
  releases[1]();
  const report = await fresh;
  assert.equal(report.sources.find((s) => s.id === 'feed:feed').state, 'ready');
});

test('resource caches survive presentation edits and invalidate only changed sources', async () => {
  const store = fixture();
  let clock = 1000;
  const calls = { feed: 0, widget: 0 };
  const dashboard = createDashboardService(store, {
    now: () => clock,
    env: { WIDGET_TEST_TOKEN: 'test' },
    fetcher: async (url) => {
      const kind = url.includes('/feed') ? 'feed' : 'widget';
      calls[kind]++;
      return new Response(kind === 'feed' ? rss : '{"value":9}');
    },
  });
  await dashboard.feed('feed');
  await dashboard.widget('api');
  store.replace({
    ...store.get(),
    title: 'Renamed',
    widgets: store.get().widgets.map((w) => ({ ...w, title: 'Renamed widget' })),
  });
  await dashboard.feed('feed');
  await dashboard.widget('api');
  assert.deepEqual(calls, { feed: 1, widget: 1 });
  const hit = dashboard.diagnostics().sources.find((s) => s.id === 'feed:feed');
  assert.equal(hit.cacheState, 'fresh');
  assert.equal(hit.lastSuccessAt, undefined, 'cache hit must not invent a successful request');
  store.replace({ ...store.get(), feeds: store.get().feeds.map((f) => ({ ...f, limit: 2 })) });
  await dashboard.feed('feed');
  await dashboard.widget('api');
  assert.deepEqual(calls, { feed: 2, widget: 1 });
  store.replace({
    ...store.get(),
    widgets: store.get().widgets.map((w) => ({
      ...w,
      source: { ...w.source, headers: { Authorization: 'changed' } },
    })),
  });
  await dashboard.widget('api');
  assert.deepEqual(calls, { feed: 2, widget: 2 });
  clock += 30001;
  await dashboard.widget('api');
  assert.equal(calls.widget, 3, 'presentation edits must not extend original TTL');
  store.replace({ ...store.get(), layout: { ...store.get().layout, hidden: ['feed-feed'] } });
  assert.throws(() => dashboard.feed('feed'), /Not found/);
  store.replace({ ...store.get(), layout: { ...store.get().layout, hidden: [] } });
  await dashboard.feed('feed');
  assert.equal(calls.feed, 3, 'hidden sources must release their cached data');
});
