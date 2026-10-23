export function appPath(path, documentRef = globalThis.document) {
  const basePath = documentRef?.documentElement?.dataset?.basePath || '';
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//'))
    throw new TypeError('Expected an application-absolute path');
  return `${basePath}${path}`;
}
