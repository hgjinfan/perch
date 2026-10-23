export function normalizeBasePath(value = '') {
  const path = String(value).trim();
  if (!path || path === '/') return '';
  if (!path.startsWith('/') || path.endsWith('/') || path.includes('//'))
    throw new Error('BASE_PATH must be an absolute path without a trailing slash');
  if (
    path
      .slice(1)
      .split('/')
      .some((part) => !/^[A-Za-z0-9._~-]+$/.test(part) || part === '.' || part === '..')
  )
    throw new Error('BASE_PATH contains an invalid path segment');
  return path;
}

export function mountedPath(basePath, path) {
  return `${basePath}${path === '/' ? '/' : path}`;
}

export function stripBasePath(path, basePath) {
  if (!basePath) return path;
  if (path === basePath || path === `${basePath}/`) return '/';
  return path.startsWith(`${basePath}/`) ? path.slice(basePath.length) : path;
}
