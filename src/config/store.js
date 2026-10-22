import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createBackupRepository } from './backups.js';
import { validateConfig } from './schema.js';
import { HttpError } from '../http.js';
import { createHash } from 'node:crypto';

export async function createConfigStore({
  statePath,
  configPath,
  persist = writeAtomically,
  backups = createBackupRepository(join(dirname(statePath), 'backups')),
}) {
  let raw;
  try {
    raw = await readFile(statePath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    raw = await readFile(configPath, 'utf8');
  }
  let config = validateConfig(JSON.parse(raw));
  let revision = 0;
  let saving = false;
  return {
    get: () => config,
    backups,
    get version() {
      return '"' + createHash('sha256').update(JSON.stringify(config)).digest('hex') + '"';
    },
    get revision() {
      return revision;
    },
    async save(value, expectedVersion, { recovery = false } = {}) {
      if (saving) throw new HttpError(409, '正在保存，请稍后重试');
      const version = '"' + createHash('sha256').update(JSON.stringify(config)).digest('hex') + '"';
      if (!expectedVersion) throw new HttpError(428, '保存需要配置版本，请重新打开管理页');
      // The same configuration digest may arrive with a weak marker after gzip.
      // Compare the complete opaque digest; stale values still fail normally.
      const expected =
        typeof expectedVersion === 'string' ? expectedVersion.replace(/^W\//, '') : expectedVersion;
      if (expected !== version)
        throw new HttpError(409, '配置已被其他页面更新，当前修改已保留，请对照最新配置合并');
      saving = true;
      try {
        let next;
        try {
          next = validateConfig(value);
        } catch (error) {
          throw new HttpError(400, error.message);
        }
        if (recovery) await backups.write(config);
        await persist(statePath, next);
        config = next;
        revision += 1;
        return next;
      } finally {
        saving = false;
      }
    },
  };
}

async function writeAtomically(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(`${path}.tmp`, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  await rename(`${path}.tmp`, path);
}
