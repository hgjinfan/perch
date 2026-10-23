import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startPresetServices } from '../test/helpers/preset-services.js';
import { publicPresetWidgets } from '../test/helpers/public-presets.js';
import { catalogPresets, buildPreset } from '../public/admin/preset-definitions.js';
import { createConfigStore } from '../src/config/store.js';
import { createApplication } from '../src/application.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.PRESET_LAB_PORT ?? 3216);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid PRESET_LAB_PORT');
const upstream = await startPresetServices();
const directory = await mkdtemp(join(tmpdir(), 'perch-preset-lab-'));
let server,
  closing = false;
async function cleanup() {
  if (closing) return;
  closing = true;
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  await upstream.close();
  await rm(directory, { recursive: true, force: true });
}
try {
  const widgets = Object.entries(upstream.services).map(([key, service]) =>
    buildPreset(key, { ...service.values, env: catalogPresets[key].env, auth: 'env' }, key),
  );
  const config = {
    title: 'Perch · 数据源测试',
    timezone: 'UTC',
    services: [],
    feeds: [],
    weather: null,
    bookmarks: [],
    projects: [],
    widgets: process.argv.includes('--public') ? [...widgets, ...publicPresetWidgets()] : widgets,
  };
  await writeFile(join(directory, 'config.json'), JSON.stringify(config));
  const store = await createConfigStore({
    configPath: join(directory, 'config.json'),
    statePath: join(directory, 'site.json'),
  });
  server = await createApplication({
    root,
    store,
    assetsMode: 'built',
    env: { ...upstream.env, ADMIN_PASSWORD: 'preset-lab-only' },
  });
  // Disposable local browser lab only. HTTP tests independently verify admin authentication.
  server.prependListener('request', (request) => {
    request.headers.authorization =
      'Basic ' + Buffer.from('admin:preset-lab-only').toString('base64');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  console.log(`Preset HTTP lab: http://127.0.0.1:${server.address().port}/ (admin: /admin)`);
  console.log('Temporary data only; Ctrl+C stops all five local servers and removes test state.');
  if (process.argv.includes('--public'))
    console.log('Public demo sources enabled: PromLabs and Jellyfin (availability is external).');
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, async () => {
      await cleanup();
      process.exit(0);
    });
} catch (error) {
  await cleanup();
  throw error;
}
