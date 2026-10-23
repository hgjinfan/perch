import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { renderIcon } from '../src/render/icons.js';
import { createApplication } from '../src/application.js';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { validateConfig } from '../src/config/schema.js';

test('custom icons are SVG on the server and unsafe/unknown names fall back safely', () => {
  const { document } = parseHTML(renderIcon('terminal'));
  const svg = document.querySelector('svg');
  assert.equal(svg.dataset.lucide, 'terminal');
  assert.ok(svg.querySelector('polyline'));
  assert.equal(svg.getAttribute('aria-hidden'), 'true');
  for (const name of [
    'not-a-real-icon',
    'constructor',
    '__proto__',
    '<script>alert(1)</script>',
    'x'.repeat(1000),
    null,
  ]) {
    const result = renderIcon(name);
    assert.equal(result, renderIcon('box'));
    assert.ok(!result.includes('<script'));
  }
  assert.equal(renderIcon('cloud-rain'), renderIcon('cloud-rain'));
});

test('home contains ready SVG without a client icon script in source mode', async (t) => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const config = validateConfig({
    ...JSON.parse(await readFile(root + '/config.json', 'utf8')),
    services: [{ id: 'custom', name: 'Custom', url: '', icon: 'terminal' }],
    weather: null,
  });
  const server = await createApplication({
    root,
    store: { get: () => config, revision: 0 },
    env: {},
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const markup = await (await fetch(base)).text();
  const { document } = parseHTML(markup);
  assert.ok(document.querySelector('svg[data-lucide="terminal"]'));
  assert.ok(document.querySelector('#theme svg[data-lucide="sun-moon"]'));
  assert.ok(document.querySelector('#install-app svg[data-lucide="download"]'));
  assert.equal(document.querySelectorAll('i[data-lucide]').length, 0);
  assert.ok(!markup.includes('/icons.js'));
  assert.equal((await fetch(base + '/icons.js')).status, 404);
});

test('refreshed weather markup carries the selected condition SVG without client conversion', async () => {
  const { renderWeather } = await import('../src/render/weather.js');
  for (const [code, isDay, expected] of [
    [0, 1, 'sun'],
    [0, 0, 'moon'],
    [95, 1, 'cloud-lightning'],
  ]) {
    const markup = renderWeather({
      data: {
        current: {
          weather_code: code,
          is_day: isDay,
          temperature_2m: 20,
          apparent_temperature: 19,
        },
        hours: [],
      },
    });
    const { document } = parseHTML(markup);
    assert.ok(document.querySelector(`svg[data-lucide="${expected}"]`));
    assert.equal(document.querySelectorAll('i[data-lucide]').length, 0);
  }
});
