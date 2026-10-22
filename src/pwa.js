export async function buildServiceWorker(files, { version, urlFor }) {
  const shell = [...files]
    .filter(([path, file]) => !file.admin && !['/sw.js', '/', '/index.html'].includes(path))
    .map(([path]) => urlFor(path));
  const precache = [...files]
    .filter(
      ([path, file]) =>
        !file.admin && file.precache !== false && !['/sw.js', '/', '/index.html'].includes(path),
    )
    .map(([path]) => urlFor(path));
  return files
    .get('/sw.js')
    .body.toString()
    .replace('__SHELL_VERSION__', version)
    .replace(/\[\s*['"]__SHELL_FILES__['"]\s*\]/, JSON.stringify(shell))
    .replace(/\[\s*['"]__PRECACHE_FILES__['"]\s*\]/, JSON.stringify(precache))
    .replace('__OFFLINE_URL__', urlFor('/offline.html'));
}
