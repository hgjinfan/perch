import { mkdir, open, readdir, writeFile, rename, unlink, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateConfig } from './schema.js';
import { HttpError } from '../http.js';
export const BACKUP_LIMIT = 1024 * 1024;
const format = 'perch-homepage-backup';
const compatibleFormats = new Set([format, 'kyrie-homepage-backup']);
export function createBackup(config, now = new Date()) {
  return { format, version: 1, createdAt: now.toISOString(), config };
}
export function parseBackup(value) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('备份格式无效');
    if (Object.hasOwn(value, 'format')) {
      if (!compatibleFormats.has(value.format) || value.version !== 1)
        throw new Error('不支持的备份格式或版本');
      value = value.config;
    }
    return validateConfig(value);
  } catch (error) {
    throw new HttpError(400, error.message);
  }
}
export function summarizeConfig(config) {
  return {
    title: config.title,
    services: config.services.length,
    feeds: config.feeds.length,
    widgets: config.widgets.length,
    connections: (config.connections || []).length,
    groups: config.layout.groups.length,
    bookmarks: config.bookmarks.length,
    projects: config.projects.length,
  };
}
export function createBackupRepository(directory, { keep = 10 } = {}) {
  const validId = (id) => /^\d{13}-[a-f0-9-]{36}\.json$/.test(id);
  async function files() {
    try {
      return (await readdir(directory)).filter(validId).sort().reverse();
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }
  async function readSnapshot(id) {
    const file = await open(join(directory, id), 'r');
    try {
      const bytes = Buffer.alloc(BACKUP_LIMIT + 1);
      let size = 0;
      while (size < bytes.length) {
        const read = await file.read(bytes, size, bytes.length - size, null);
        if (!read.bytesRead) break;
        size += read.bytesRead;
      }
      if (size > BACKUP_LIMIT) throw new HttpError(413, '历史文件超过 1 MiB');
      return JSON.parse(bytes.subarray(0, size).toString('utf8'));
    } finally {
      await file.close();
    }
  }
  return {
    async list() {
      const items = [];
      for (const id of await files()) {
        try {
          const backup = await readSnapshot(id);
          const config = parseBackup(backup);
          items.push({
            id,
            createdAt: backup.createdAt,
            reason: backup.reason === 'save' ? 'save' : 'restore',
            ...summarizeConfig(config),
          });
        } catch {
          /* Ignore incomplete or externally damaged snapshots. */
        }
      }
      return items;
    },
    async read(id) {
      if (!validId(id)) throw new HttpError(404, '备份不存在');
      try {
        const backup = await readSnapshot(id);
        parseBackup(backup);
        return backup;
      } catch (error) {
        if (error.code === 'ENOENT') throw new HttpError(404, '备份不存在');
        throw error;
      }
    },
    async write(config, { reason = 'restore' } = {}) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await chmod(directory, 0o700);
      const id = `${Date.now()}-${randomUUID()}.json`,
        path = join(directory, id);
      await writeFile(
        path + '.tmp',
        JSON.stringify(
          { ...createBackup(config), reason: reason === 'save' ? 'save' : 'restore' },
          null,
          2,
        ) + '\n',
        {
          mode: 0o600,
        },
      );
      await rename(path + '.tmp', path);
      // Cleanup must never turn an already-created recovery point into a failed restore.
      for (const old of (await files()).slice(keep))
        await unlink(join(directory, old)).catch(() => {});
      return id;
    },
  };
}
