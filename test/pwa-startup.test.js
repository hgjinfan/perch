import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML, DOMParser } from 'linkedom';
import { launchHomepage } from '../public/pwa/startup.js';
const version = 'a'.repeat(20) + '-' + 'b'.repeat(32);
const markup = `<html data-page-version="${version}" data-asset-version="${'a'.repeat(20)}" data-density="compact"><head><title>Latest</title><link rel="stylesheet" href="/client/public/styles-ABC.css"><script type="module" src="/client/public/app-ABC.js"></script></head><body><main id="board">Live content</main></body></html>`;
function fixture(t) {
  const previous = globalThis.DOMParser;
  globalThis.DOMParser = DOMParser;
  t.after(() => {
    globalThis.DOMParser = previous;
  });
  return parseHTML(
    '<html data-theme="dark"><head><title>Launch</title></head><body><main id="launch">Opening</main></body></html>',
  ).document;
}
test('startup keeps the generic shell visible until actual resources are ready, then mounts fresh markup', async (t) => {
  const host = fixture(t);
  let ready,
    loaded = false;
  const prepared = new Promise((resolve) => {
    ready = resolve;
  });
  const pending = launchHomepage({
    host,
    pathname: '/launch.html',
    fetcher: async (path, options) => {
      assert.equal(path, '/');
      assert.equal(options.cache, 'no-store');
      assert.equal(options.credentials, 'omit');
      return new Response(markup, { headers: { 'Content-Type': 'text/html' } });
    },
    prepare: () => prepared,
    load: async (url) => {
      assert.equal(url, '/client/public/app-ABC.js');
      loaded = true;
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(host.querySelector('#launch').textContent, 'Opening');
  assert.equal(loaded, false);
  ready();
  await pending;
  assert.equal(host.querySelector('#board').textContent, 'Live content');
  assert.equal(host.documentElement.dataset.theme, 'dark');
  assert.equal(loaded, true);
});
test('startup rejects failed/malformed responses without removing the usable launch shell', async (t) => {
  const host = fixture(t);
  for (const response of [
    new Response('failed', { status: 503 }),
    new Response('<html>bad</html>', { headers: { 'Content-Type': 'text/html' } }),
    new Response(markup.replace('/client/public/app-ABC.js', 'https://evil.example/app.js'), {
      headers: { 'Content-Type': 'text/html' },
    }),
  ]) {
    await assert.rejects(
      launchHomepage({
        host,
        pathname: '/',
        fetcher: async () => response,
        load: () => assert.fail(),
      }),
    );
    assert.ok(host.querySelector('#launch'));
  }
});
test('failed script activation restores the launch shell and previous document metadata for retry', async (t) => {
  const host = fixture(t);
  await assert.rejects(
    launchHomepage({
      host,
      pathname: '/page/latest',
      fetcher: async (path) => {
        assert.equal(path, '/page/latest');
        return new Response(markup, { headers: { 'Content-Type': 'text/html' } });
      },
      prepare: async () => {},
      load: async () => {
        throw new Error('module unavailable');
      },
    }),
    /module unavailable/,
  );
  assert.ok(host.querySelector('#launch'));
  assert.equal(host.title, 'Launch');
  assert.equal(host.documentElement.dataset.pageVersion, undefined);
});
