export async function buildServiceWorker(files, { version, urlFor }) {
  const shell = [...files]
    .filter(([path, file]) => !file.admin && !['/sw.js', '/', '/index.html'].includes(path))
    .map(([path]) => urlFor(path));
  return files
    .get('/sw.js')
    .body.toString()
    .replace('__SHELL_VERSION__', version)
    .replace(/\[\s*['"]__SHELL_FILES__['"]\s*\]/, JSON.stringify(shell))
    .replace('__OFFLINE_URL__', urlFor('/offline.html'));
}
