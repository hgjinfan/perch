export async function requestJson(path, { method = 'GET', body, headers = {}, onResponse } = {}) {
  const response = await fetch(path, {
    method,
    signal: AbortSignal.timeout(15000),
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
