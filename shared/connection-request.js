// Relative endpoint paths are appended, never resolved against another origin.
export function validConnectionPath(path) {
  if (
    typeof path !== 'string' ||
    path.length > 2048 ||
    !path.startsWith('/') ||
    path.startsWith('//') ||
    /[\\?#\s]/.test(path)
  )
    return false;
  try {
    const decoded = decodeURIComponent(path);
    return (
      !decoded.includes('\\') &&
      !decoded.includes('%') &&
      !decoded.includes('//') &&
      !/[?#\s]/.test(decoded) &&
      !decoded.split('/').some((part) => part === '.' || part === '..')
    );
  } catch {
    return false;
  }
}
export function validConnectionQuery(query) {
  return (
    query &&
    typeof query === 'object' &&
    !Array.isArray(query) &&
    Object.keys(query).length <= 30 &&
    Object.entries(query).every(
      ([key, value]) =>
        key.length > 0 && key.length <= 200 && typeof value === 'string' && value.length <= 2000,
    )
  );
}
export function connectionUrl(connection, source) {
  if (!validConnectionPath(source.path) || !validConnectionQuery(source.query || {}))
    throw new Error('共享连接请求路径或查询参数无效');
  const url = new URL(connection.baseUrl.replace(/\/+$/, '') + source.path);
  if (url.origin !== new URL(connection.baseUrl).origin) throw new Error('共享连接请求地址无效');
  for (const [key, value] of Object.entries(source.query || {})) url.searchParams.set(key, value);
  if (url.href.length > 8192) throw new Error('共享连接请求地址过长');
  return url.href;
}
