import { createThemeBootstrap } from './theme-bootstrap.js';
import { createLayoutBootstrap } from './layout-bootstrap.js';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { HttpError } from './http.js';
import { versionHtml } from './asset-version.js';
import { buildServiceWorker } from './pwa.js';
import { mountedPath } from './base-path.js';
export async function createBuiltAssets(
  root,
  { directory = resolve(root, 'dist/client'), basePath = '' } = {},
) {
  const manifest = JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8'));
  if (!/^[a-f0-9]{20}$/.test(manifest.version)) throw Error('Invalid client build manifest');
  const files = new Map(),
    aliases = {
      ...manifest.aliases,
      '/': '/index.html',
      '/admin': '/admin.html',
      '/admin/': '/admin.html',
    };
  for (const entry of manifest.files) {
    const disk = resolve(directory, entry.disk);
    if (!disk.startsWith(resolve(directory) + sep)) throw Error('Invalid build asset path');
    files.set(entry.url, { ...entry, disk, body: await readFile(disk) });
  }
  const rawUrlFor = (path) => aliases[path] || path,
    urlFor = (path) => mountedPath(basePath, rawUrlFor(path)),
    known = (path) => files.has(rawUrlFor(path));
  const theme = createThemeBootstrap(files.get(rawUrlFor('/pwa/theme.js')).body.toString());
  const layout = createLayoutBootstrap(
    files.get(rawUrlFor('/home/initial-layout.js'))?.body.toString() || '',
  );
  for (const path of [
    '/index.html',
    '/admin.html',
    '/offline.html',
    '/launch.html',
    '/setup.html',
  ]) {
    const file = files.get(path);
    const source = layout.render(theme.render(file.body.toString()));
    file.body = Buffer.from(versionHtml(source, urlFor, known, basePath));
  }
  const appManifest = files.get('/manifest.webmanifest');
  const parsed = JSON.parse(appManifest.body.toString());
  parsed.id = mountedPath(basePath, '/');
  parsed.start_url = mountedPath(basePath, '/launch.html');
  parsed.scope = mountedPath(basePath, '/');
  for (const icon of parsed.icons || []) icon.src = urlFor(icon.src);
  appManifest.body = Buffer.from(JSON.stringify(parsed));
  files.get('/sw.js').body = Buffer.from(
    await buildServiceWorker(files, { version: manifest.version, urlFor, basePath }),
  );
  for (const file of files.values())
    file.etag = '"' + createHash('sha256').update(file.body).digest('hex') + '"';
  const assetFor = (path) => files.get(rawUrlFor(path));
  const types = {
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.webmanifest': 'application/manifest+json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
  };
  return {
    version: manifest.version,
    scriptHashes: [theme.hash, layout.hash],
    urlFor,
    homeShell: files.get('/index.html').body.toString(),
    isAdmin: (path) =>
      path.startsWith('/api/admin/') || path.startsWith('/client/admin/') || assetFor(path)?.admin,
    async send(path, request, response) {
      const file = assetFor(path);
      if (!file) throw new HttpError(404, 'Not found');
      const headers = {
        'Content-Type': types[extname(file.disk)],
        'Cache-Control': file.admin
          ? 'no-store'
          : path.startsWith('/client/public/')
            ? 'public, max-age=31536000, immutable'
            : 'no-cache',
      };
      if (path === '/sw.js') headers['Service-Worker-Allowed'] = mountedPath(basePath, '/');
      if (!file.admin) {
        headers.ETag = file.etag;
        if (
          request.headers?.['if-none-match']
            ?.split(',')
            .some((tag) => tag.trim() === '*' || tag.trim().replace(/^W\//, '') === file.etag)
        ) {
          response.writeHead(304, headers);
          response.end();
          return;
        }
      }
      response.writeHead(200, headers);
      response.end(request.method === 'HEAD' ? undefined : file.body);
    },
  };
}
