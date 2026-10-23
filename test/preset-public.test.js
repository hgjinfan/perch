import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import { publicPresetWidgets } from './helpers/public-presets.js';
import { createApplication } from '../src/application.js';
import { createConfigStore } from '../src/config/store.js';

test(
  'public demos render through real Perch preview and public fragments',
  {
    skip: process.env.PRESET_PUBLIC_TEST !== '1',
    timeout: 60000,
  },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'perch-public-presets-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const widgets = publicPresetWidgets();
    const configPath = join(directory, 'config.json');
    await writeFile(
      configPath,
      JSON.stringify({
        title: 'Public demo test',
        timezone: 'UTC',
        services: [],
        feeds: [],
        weather: null,
        bookmarks: [],
        projects: [],
        widgets,
      }),
    );
    const store = await createConfigStore({ configPath, statePath: join(directory, 'site.json') });
    const server = await createApplication({
      root: fileURLToPath(new URL('../', import.meta.url)),
      store,
      env: { ADMIN_PASSWORD: 'public-test-only' },
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const base = `http://127.0.0.1:${server.address().port}`;
    const { document } = parseHTML(await (await fetch(base)).text());
    for (const widget of widgets) {
      const preview = await fetch(base + '/api/admin/widget-preview', {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from('admin:public-test-only').toString('base64'),
          Origin: base,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(widget),
      });
      assert.equal(preview.status, 200, `${widget.id}: preview`);
      const path = document.querySelector(`[data-module="widget-${widget.id}"]`).dataset.fragment;
      const fragment = await fetch(base + path);
      assert.equal(fragment.status, 200, `${widget.id}: fragment`);
      for (const html of [await preview.text(), await fragment.text()]) {
        const { document: result } = parseHTML(html);
        if (widget.id === 'public-prometheus') {
          const value = result.querySelector('.widget-value')?.textContent;
          assert.match(value ?? '', /^\d+(?:\.\d+)?个$/);
        } else {
          assert.match(result.querySelector('.widget-text')?.textContent ?? '', /^\d+\.\d+\.\d+/);
        }
      }
    }
  },
);
