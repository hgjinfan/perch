import { mapWidget } from '../../shared/widget-types.js';
export async function loadWidget(w, fetcher = fetch, env = process.env) {
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
  return mapWidget(w, raw);
}
