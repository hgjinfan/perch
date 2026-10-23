import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { hydrateInitialContent } from '../public/pwa/initial-content.js';
import { mountModules } from '../public/home/board.js';
import { createLoaders } from '../public/home/loaders.js';
function page() {
  const tile = (id) =>
    `<section data-module="${id}" data-fragment="/fragments/${id}"><h2><span data-module-title>${id}</span><span class="module-update" hidden></span></h2><div class="module-content" data-load-state="loading"><div class="skeleton">placeholder</div></div><template data-loading-placeholder><div class="skeleton">placeholder</div></template></section>`;
  return parseHTML(
    `<html><body><main id="board">${tile('fast')}${tile('slow')}</main></body></html>`,
  ).document;
}
const result = (text) =>
  new Response(`<div data-fragment-result data-state="ready"><strong>${text}</strong></div>`, {
    headers: { 'Content-Type': 'text/html' },
  });

test('startup preloads ready tiles, limits waiting, and slow tiles never reintroduce a second skeleton', async (t) => {
  const document = page();
  let aborted = false;
  await hydrateInitialContent(document, {
    waitMs: 20,
    fetcher: async (path, { signal }) => {
      if (path.endsWith('/fast')) return result('Already ready');
      return new Promise((_, reject) =>
        signal.addEventListener(
          'abort',
          () => {
            aborted = true;
            reject(signal.reason);
          },
          { once: true },
        ),
      );
    },
  });
  assert.equal(aborted, true);
  assert.equal(
    document.querySelector('[data-module="fast"] .module-content').textContent,
    'Already ready',
  );
  assert.equal(document.querySelectorAll('.module-content .skeleton').length, 0);
  const previous = { document: globalThis.document, fetch: globalThis.fetch };
  Object.assign(globalThis, { document });
  t.after(() => Object.assign(globalThis, previous));
  let calls = 0,
    release;
  globalThis.fetch = async () => {
    calls++;
    return new Promise((resolve) => {
      release = resolve;
    });
  };
  const loaders = createLoaders(mountModules(document.querySelector('#board')));
  await loaders.get('fast')();
  assert.equal(calls, 0, 'hydrated tile must skip duplicate startup fetch');
  const slow = loaders.get('slow')();
  await Promise.resolve();
  assert.equal(document.querySelectorAll('.module-content .skeleton').length, 0);
  assert.match(
    document.querySelector('[data-module="slow"] .module-content').textContent,
    /加载中/,
  );
  release(result('Ready later'));
  await slow;
  assert.equal(
    document.querySelector('[data-module="slow"] .module-content').textContent,
    'Ready later',
  );
  assert.equal(
    document.querySelector('[data-module="slow"] .module-content').dataset.initialPending,
    undefined,
  );
});

test('prefetch failure is isolated but an obsolete config version cannot be mounted', async () => {
  const document = page();
  await assert.rejects(
    hydrateInitialContent(document, {
      fetcher: async (path) =>
        path.endsWith('/fast')
          ? new Response('', { status: 409, headers: { 'X-Homepage-Reload': '1' } })
          : result('Other'),
    }),
    /Configuration changed/,
  );
  const failed = page();
  await hydrateInitialContent(failed, {
    fetcher: async () => new Response('Unavailable', { status: 503 }),
  });
  assert.equal(failed.querySelectorAll('.initial-module-loading').length, 2);
  assert.equal(failed.querySelectorAll('.module-content .skeleton').length, 0);
});
