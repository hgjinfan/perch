import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createConfigStore } from './config/store.js';
import { createApplication } from './application.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const envPath = resolve(root, '.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);
const store = await createConfigStore({
  statePath: process.env.STATE_PATH || resolve(root, 'data/site.json'),
  configPath: process.env.CONFIG_PATH || resolve(root, 'config.json'),
});
const server = await createApplication({ root, store });
const host = process.env.HOST || '127.0.0.1';
server.listen(Number(process.env.PORT || 3210), host, () => {
  console.log(`Perch Homepage: http://${host}:${server.address().port}`);
});
