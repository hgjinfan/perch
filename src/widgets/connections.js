import { safeUrl } from '../../shared/url.js';
import { connectionUrl } from '../../shared/connection-request.js';
import { validateHeaders } from './request-schema.js';

export function validateConnections(value = []) {
  if (!Array.isArray(value) || value.length > 40) throw new Error('共享连接最多 40 个');
  const ids = new Set();
  return value.map((c) => {
    if (
      !c ||
      typeof c.id !== 'string' ||
      !/^[a-z0-9_-]{1,50}$/.test(c.id) ||
      ids.has(c.id) ||
      typeof c.name !== 'string' ||
      !c.name.trim() ||
      c.name.length > 80 ||
      typeof c.baseUrl !== 'string' ||
      c.baseUrl.length > 2048 ||
      !safeUrl(c.baseUrl)
    )
      throw new Error('共享连接名称、标识或地址无效');
    const url = new URL(c.baseUrl);
    if (url.search || url.hash) throw new Error('共享连接基础地址不能包含查询参数或片段');
    ids.add(c.id);
    return {
      id: c.id,
      name: c.name.trim(),
      baseUrl: url.href.replace(/\/+$/, ''),
      headers: validateHeaders(c.headers),
    };
  });
}
export function resolveWidgetConnection(widget, connections = []) {
  if (widget.source.kind !== 'connection') return widget;
  const connection = connections.find((c) => c.id === widget.source.connectionId);
  if (!connection) throw new Error('共享连接不存在，请重新选择');
  const { method, body } = widget.source;
  return {
    ...widget,
    source: {
      kind: 'api',
      url: connectionUrl(connection, widget.source),
      method,
      headers: connection.headers,
      ...(body !== undefined ? { body } : {}),
    },
  };
}
