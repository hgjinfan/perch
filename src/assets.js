import { createThemeBootstrap } from './theme-bootstrap.js';
import { createLayoutBootstrap } from './layout-bootstrap.js';
import { createBuiltAssets } from './built-assets.js';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, extname, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { HttpError } from './http.js';
import { buildServiceWorker } from './pwa.js';
import { versionModule, versionHtml, canonicalAsset } from './asset-version.js';
import { mountedPath } from './base-path.js';

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};
const privateFiles = new Set(['admin.html', 'admin.js', 'admin.css', 'widget-editor.js']);
export async function createAssets(root, { mode = 'source', directory, basePath = '' } = {}) {
  if (mode === 'built') return createBuiltAssets(root, { directory, basePath });
  const files = new Map();
  async function collect(directory, prefix, admin = false) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name),
        url = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) await collect(path, url, admin || entry.name === 'admin');
      else if (entry.isFile() && contentTypes[extname(entry.name)]) {
        const name = relative(resolve(root, 'public'), path).split(sep).join('/');
        files.set(url, {
          path,
          admin:
            admin ||
            privateFiles.has(name) ||
            ['/shared/widget-types.js', '/shared/layout.js'].includes(url),
          body: await readFile(path),
        });
      }
    }
  }
  await collect(resolve(root, 'public'), '');
  await collect(resolve(root, 'shared'), '/shared');
  const theme = createThemeBootstrap(files.get('/pwa/theme.js').body.toString());
  // Source mode has public/ available; production reads the emitted bootstrap instead.
  const { arrangeTileGrids } = await import('../public/home/tile-layout.js');
  const layout = createLayoutBootstrap(
    `if(globalThis.ResizeObserver)(${arrangeTileGrids.toString()})(document.querySelectorAll('#board .content-board'));`,
  );
  const hash = createHash('sha256');
  for (const [path, file] of [...files].sort(([a], [b]) => a.localeCompare(b)))
    hash.update(path).update(file.body);
  const version = hash.digest('hex').slice(0, 20),
    urlFor = (path) => mountedPath(basePath, `/assets/${version}${path}`);
  for (const [path, file] of files) {
    const type = extname(path);
    let source = file.body.toString('utf8');
    if (type === '.js') source = await versionModule(source, path, urlFor, (p) => files.has(p));
    else if (type === '.html')
      source = versionHtml(
        layout.render(theme.render(source)),
        urlFor,
        (p) => files.has(p),
        basePath,
      );
    else if (type === '.webmanifest') {
      const manifest = JSON.parse(source);
      manifest.id = mountedPath(basePath, '/');
      manifest.start_url = mountedPath(basePath, '/launch.html');
      manifest.scope = mountedPath(basePath, '/');
      for (const icon of manifest.icons || []) if (files.has(icon.src)) icon.src = urlFor(icon.src);
      source = JSON.stringify(manifest);
    } else continue;
    file.body = Buffer.from(source);
  }
  const worker = await buildServiceWorker(files, { version, urlFor, basePath });
  files.get('/sw.js').body = Buffer.from(worker);
  for (const file of files.values())
    file.etag = '"' + createHash('sha256').update(file.body).digest('hex') + '"';
  files.set('/', files.get('/index.html'));
  files.set('/admin', files.get('/admin.html'));
  files.set('/admin/', files.get('/admin.html'));
  function assetFor(path) {
    return files.get(canonicalAsset(path, version) || path);
  }
  return {
    version,
    scriptHashes: [theme.hash, layout.hash],
    urlFor,
    homeShell: files.get('/index.html').body.toString(),
    isAdmin: (path) => path.startsWith('/api/admin/') || assetFor(path)?.admin,
    async send(path, request, response) {
      const file = assetFor(path);
      if (!file) throw new HttpError(404, 'Not found');
      const immutable = Boolean(canonicalAsset(path, version));
      const headers = {
        'Content-Type': contentTypes[extname(file.path)],
        'Cache-Control': file.admin
          ? 'no-store'
          : immutable
            ? 'public, max-age=31536000, immutable'
            : 'no-cache',
      };
      if (path === '/sw.js') headers['Service-Worker-Allowed'] = mountedPath(basePath, '/');
      if (!file.admin) {
        headers.ETag = file.etag;
        const incoming = request.headers?.['if-none-match'];
        if (
          typeof incoming === 'string' &&
          incoming
            .split(',')
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
