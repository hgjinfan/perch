import { resolveWidgetConnection } from './connections.js';
import { mapWidget, validPath } from '../../shared/widget-types.js';
export async function readWidgetSource(w, fetcher = fetch, env = process.env, connections = []) {
  w = resolveWidgetConnection(w, connections);
  let raw = w.source.data;
  if (w.source.kind === 'api') {
    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...w.source.headers,
    };
    for (const [key, value] of Object.entries(headers))
      headers[key] = value.replace(/\$\{(WIDGET_[A-Z0-9_]+)\}/g, (_, name) => {
        if (!env[name]) throw new Error('缺少密钥环境变量');
        return env[name];
      });
    const response = await fetcher(w.source.url, {
      method: w.source.method,
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
      ...(w.source.method === 'POST' && w.source.body !== undefined
        ? { body: JSON.stringify(w.source.body) }
        : {}),
    });
    if (!response.ok) throw new Error(`API 返回 HTTP ${response.status}`);
    if (!response.body) throw new Error('响应不是有效 JSON');
    let size = 0;
    const chunks = [];
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 1024 * 1024) throw new Error('响应超过 1 MiB');
      chunks.push(Buffer.from(chunk));
    }
    try {
      raw = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new Error('响应不是有效 JSON');
    }
  }
  return raw;
}

export async function loadWidget(w, fetcher = fetch, env = process.env, connections = []) {
  return mapWidget(w, await readWidgetSource(w, fetcher, env, connections));
}
export async function inspectWidget(w, fetcher = fetch, env = process.env, connections = []) {
  const raw = await readWidgetSource(w, fetcher, env, connections);
  const fields = [];
  let truncated = false;
  function visit(value, path = '', depth = 0) {
    if (fields.length >= 100 || depth > 6) {
      truncated = true;
      return;
    }
    if (!validPath(path)) return;
    const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    fields.push({ path, type });
    if (Array.isArray(value)) {
      if (value.length) visit(value[0], path ? `${path}.0` : '0', depth + 1);
    } else if (value && typeof value === 'object') {
      for (const key of Object.keys(value)) {
        if (
          key.includes('.') ||
          !validPath(key) ||
          /token|secret|password|authorization|cookie|api.?key|credential/i.test(key)
        )
          continue;
        visit(value[key], path ? `${path}.${key}` : key, depth + 1);
      }
    }
  }
  visit(raw);
  return { fields, truncated };
}
