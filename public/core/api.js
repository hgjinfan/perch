// Compression proxies may weaken or replace the HTTP entity ETag. Prefer the
// application-level config version; accept legacy weak ETags only as opaque tokens.
export function readConfigVersion(response) {
  const explicit = response.headers.get('x-config-version');
  if (/^[a-f0-9]{64}$/.test(explicit || '')) return `"${explicit}"`;
  const legacy = response.headers.get('etag')?.replace(/^W\//, '');
  if (/^"[a-f0-9]{64}"$/.test(legacy || '')) return legacy;
  throw new Error('无法读取配置版本，请检查反向代理是否保留 X-Config-Version 响应头');
}
export async function requestJson(
  path,
  { method = 'GET', body, headers = {}, onResponse, signal } = {},
) {
  const response = await fetch(path, {
    method,
    cache: 'no-store',
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
      : AbortSignal.timeout(15000),
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.error || 'Request failed');
    error.status = response.status;
    throw error;
  }
  onResponse?.(response);
  return result;
}

export async function requestHtml(path, { method = 'GET', body, signal } = {}) {
  const response = await fetch(path, {
    method,
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
      : AbortSignal.timeout(15000),
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    let message = '内容暂时无法加载';
    if (response.headers.get('content-type')?.includes('application/json'))
      message = (await response.json()).error || message;
    const error = new Error(message);
    error.status = response.status;
    error.reload = response.headers.get('X-Homepage-Reload') === '1';
    throw error;
  }
  if (!response.headers.get('content-type')?.includes('text/html'))
    throw new Error('Unexpected fragment content type');
  return response.text();
}
