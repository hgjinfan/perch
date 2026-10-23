import { build } from 'esbuild';
import { readFile, writeFile, mkdir, readdir, rm, copyFile } from 'node:fs/promises';
import { resolve, relative, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
const root = fileURLToPath(new URL('../', import.meta.url));
const out = resolve(root, process.env.PERCH_BUILD_DIR || 'dist/client');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex').slice(0, 16);
await mkdir(out, { recursive: true });
// Only generated client folders are replaced; configuration and data are never inputs.
for (const part of ['public', 'admin'])
  await rm(resolve(out, part), { recursive: true, force: true });
const files = [],
  aliases = {};
for (const [scope, entries] of [
  [
    'public',
    {
      app: 'public/app.js',
      offline: 'public/pwa/offline.js',
      launch: 'public/pwa/launch.js',
      theme: 'public/pwa/theme.js',
      styles: 'public/styles.css',
    },
  ],
  ['admin', { admin: 'public/admin.js', styles: 'public/admin.css' }],
]) {
  const result = await build({
    absWorkingDir: root,
    entryPoints: entries,
    outdir: resolve(out, scope),
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    sourcemap: false,
    metafile: true,
    entryNames: '[name]-[hash]',
    chunkNames: 'chunks/[name]-[hash]',
    legalComments: 'eof',
    logLevel: 'silent',
  });
  if (
    scope === 'public' &&
    Object.keys(result.metafile.inputs).some((path) =>
      /^(public\/admin(?:\/|\.js|\.css)|public\/widget-editor\.js|shared\/(?:layout|widget-types)\.js)/.test(
        path,
      ),
    )
  )
    throw new Error('Public bundle imports administrator-only code');
  if (Object.keys(result.metafile.inputs).some((path) => path.includes('node_modules/lucide/')))
    throw new Error('Client bundle must not include the server-side icon library');
  const outputs = result.metafile.outputs;
  const eager = new Set();
  function visit(path) {
    if (eager.has(path)) return;
    eager.add(path);
    for (const item of outputs[path]?.imports || [])
      if (item.kind !== 'dynamic-import') visit(item.path);
  }
  for (const [path, value] of Object.entries(outputs))
    if (value.entryPoint && Object.values(entries).includes(value.entryPoint)) visit(path);
  for (const [path, value] of Object.entries(outputs)) {
    const disk = relative(out, resolve(root, path)).split('\\').join('/'),
      url = '/client/' + disk;
    files.push({ url, disk, admin: scope === 'admin', precache: eager.has(path) });
    for (const [name, entry] of Object.entries(entries))
      if (value.entryPoint === entry) {
        const canonical =
          scope === 'admin' && name === 'styles'
            ? '/admin.css'
            : name === 'styles'
              ? '/styles.css'
              : ['offline', 'launch', 'theme'].includes(name)
                ? `/pwa/${name}.js`
                : `/${name}.js`;
        aliases[canonical] = url;
      }
  }
}
const sw = await build({
  absWorkingDir: root,
  entryPoints: ['public/sw.js'],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  write: false,
  legalComments: 'eof',
});
await writeFile(resolve(out, 'sw.js'), sw.outputFiles[0].contents);
for (const name of [
  'index.html',
  'admin.html',
  'offline.html',
  'launch.html',
  'manifest.webmanifest',
])
  await copyFile(resolve(root, 'public', name), resolve(out, name));
for (const path of [
  'favicon.svg',
  ...(await readdir(resolve(root, 'public/icons')))
    .filter((f) => f.endsWith('.png'))
    .map((f) => 'icons/' + f),
]) {
  const bytes = await readFile(resolve(root, 'public', path)),
    extension = extname(path),
    base = path.slice(0, -extension.length),
    disk = `public/${base}-${hash(bytes)}${extension}`,
    url = '/client/' + disk;
  await mkdir(dirname(resolve(out, disk)), { recursive: true });
  await writeFile(resolve(out, disk), bytes);
  files.push({ url, disk, admin: false, precache: true });
  aliases['/' + path] = url;
}
for (const [url, disk, admin] of [
  ['/index.html', 'index.html', false],
  ['/admin.html', 'admin.html', true],
  ['/offline.html', 'offline.html', false],
  ['/launch.html', 'launch.html', false],
  ['/manifest.webmanifest', 'manifest.webmanifest', false],
  ['/sw.js', 'sw.js', false],
])
  files.push({ url, disk, admin, precache: !['/index.html', '/sw.js'].includes(url) });
const versionHash = createHash('sha256');
for (const file of [...files].sort((a, b) => a.url.localeCompare(b.url)))
  versionHash.update(file.url).update(await readFile(resolve(out, file.disk)));
const version = versionHash.digest('hex').slice(0, 20);
const manifest = { version, aliases, files };
await writeFile(resolve(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
const report = [];
for (const file of files)
  if (/\.(js|css)$/.test(file.url)) {
    const bytes = await readFile(resolve(out, file.disk));
    report.push({
      url: file.url,
      admin: file.admin,
      precache: file.precache,
      bytes: bytes.length,
      gzip: gzipSync(bytes).length,
    });
  }
await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(
  `Built ${version}: ${report.filter((f) => !f.admin && f.precache && f.url !== '/sw.js').reduce((n, f) => n + f.bytes, 0)} B public eager JS/CSS; ${report.filter((f) => !f.admin && f.precache && f.url !== '/sw.js').reduce((n, f) => n + f.gzip, 0)} B gzip. Optional chunks and admin assets are separate.`,
);
