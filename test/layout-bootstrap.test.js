import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createAssets } from '../src/assets.js';
import { createLayoutBootstrap } from '../src/layout-bootstrap.js';
import { arrangeTileGrids } from '../public/home/tile-layout.js';

const root = fileURLToPath(new URL('../', import.meta.url));
test('initial layout is embedded after the board and authorized by its exact CSP hash', async () => {
  const assets = await createAssets(root, { basePath: '/perch' });
  const html = assets.homeShell;
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 2);
  const layout = scripts[1];
  assert.ok(layout.index > html.indexOf('</main>'));
  assert.ok(!html.includes('<!--perch:initial-layout-->'));
  for (const [, code] of scripts)
    assert.ok(
      assets.scriptHashes.includes('sha256-' + createHash('sha256').update(code).digest('base64')),
    );
});

test('embedded first layout needs no module download and keeps no-observer fallback', () => {
  const bootstrap = createLayoutBootstrap(
    `if(globalThis.ResizeObserver)(${arrangeTileGrids.toString()})(document.querySelectorAll('#board .content-board'));`,
  );
  const code = bootstrap.render('<!--perch:initial-layout-->').slice(8, -9);
  const tile = { style: {}, getBoundingClientRect: () => ({ height: 100 }) };
  const grid = { style: {}, children: [tile] };
  const document = { querySelectorAll: () => [grid] };
  runInNewContext(code, { document });
  assert.equal(grid.style.gridAutoRows, undefined);
  runInNewContext(code, {
    document,
    ResizeObserver: class {},
    getComputedStyle: () => ({ rowGap: '14px' }),
  });
  assert.equal(grid.style.gridAutoRows, '4px');
  assert.equal(tile.style.gridRowEnd, 'span 7');
});
