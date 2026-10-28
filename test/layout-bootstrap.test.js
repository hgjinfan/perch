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
    getComputedStyle: () => ({ gridTemplateColumns: '300px 300px', columnGap: '14px' }),
  });
  assert.equal(grid.style.gridAutoRows, '1px');
  assert.equal(tile.style.gridRowEnd, 'span 114');
});

test('multi-column spacing stays below one pixel error and single-column restores natural rows', (t) => {
  let columns = '300px 300px',
    gap = '14px';
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'getComputedStyle');
  Object.defineProperty(globalThis, 'getComputedStyle', {
    configurable: true,
    value: () => ({ gridTemplateColumns: columns, columnGap: gap }),
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'getComputedStyle', previous);
    else delete globalThis.getComputedStyle;
  });
  const heights = [100, 149, 438.34, 671.63];
  const tiles = heights.map((height) => ({ style: {}, getBoundingClientRect: () => ({ height }) }));
  const grid = { style: {}, children: tiles };
  for (gap of ['14px', '10px']) {
    arrangeTileGrids([grid]);
    for (const [index, tile] of tiles.entries()) {
      const actual = Number(tile.style.gridRowEnd.split(' ')[1]) - heights[index];
      assert.ok(actual >= parseFloat(gap) && actual < parseFloat(gap) + 1);
    }
    assert.equal(grid.style.rowGap, '0px');
    assert.equal(grid.style.marginBottom, `${-parseFloat(gap)}px`);
  }
  columns = '600px';
  arrangeTileGrids([grid]);
  assert.equal(grid.style.gridAutoRows, '');
  assert.equal(grid.style.rowGap, '');
  assert.equal(grid.style.marginBottom, '');
  assert.ok(tiles.every((tile) => tile.style.gridRowEnd === ''));
});
