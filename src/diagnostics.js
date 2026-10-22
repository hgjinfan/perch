// Retain only classified metadata. Raw errors, URLs, responses and credentials never enter records.
export function classifyFailure(error) {
  const message = typeof error?.message === 'string' ? error.message : '';
  const match = message.match(/^(?:API 返回 )?HTTP (\d{3})$/);
  if (match) {
    const status = Number(match[1]);
    return {
      code: [401, 403].includes(status) ? 'authentication' : status === 429 ? 'rate_limit' : 'http',
      message: [401, 403].includes(status)
        ? '上游拒绝认证，请检查访问权限或密钥'
        : status === 429
          ? '上游请求受限，请稍后重试'
          : '上游返回异常 HTTP 状态',
      httpStatus: status,
    };
  }
  if (
    ['TimeoutError', 'AbortError'].includes(error?.name) ||
    [
      'ETIMEDOUT',
      'UND_ERR_CONNECT_TIMEOUT',
      'UND_ERR_HEADERS_TIMEOUT',
      'UND_ERR_BODY_TIMEOUT',
    ].includes(error?.cause?.code || error?.code)
  )
    return { code: 'timeout', message: '请求超时，请检查上游响应与网络' };
  if (message === '缺少密钥环境变量')
    return { code: 'credentials', message: '服务器缺少所需密钥环境变量' };
  if (/^(映射字段|找不到文本字段|总量必须|列表路径)/.test(message))
    return { code: 'mapping', message: '字段映射或数据类型不匹配，请检查映射与接口版本' };
  if (
    error instanceof SyntaxError ||
    [
      'Invalid feed',
      'Not an RSS or Atom feed',
      '响应不是有效 JSON',
      'Invalid weather response',
      'Invalid current weather',
      'No valid hourly weather',
      'Invalid hourly forecast',
    ].includes(message) ||
    /^(Invalid weather|Invalid forecast|Invalid hourly)/.test(message)
  )
    return { code: 'format', message: '上游响应格式不符合要求' };
  if (message === 'Response too large' || message === '响应超过 1 MiB')
    return { code: 'size', message: '上游响应超过 1 MiB 限制' };
  if (error?.retryAfter) return { code: 'rate_limit', message: '请求预算或上游冷却中，请稍后重试' };
  const code = error?.cause?.code || error?.code || '';
  if (/CERT|TLS|SSL/.test(code)) return { code: 'tls', message: 'TLS 连接或证书校验失败' };
  return { code: 'network', message: '请求失败，请检查服务地址、网络与上游可用性' };
}
export function createDiagnostics({ now = Date.now, maxEntries = 256 } = {}) {
  const records = new Map();
  return {
    clear() {
      records.clear();
    },
    observe({ key, type, error, hasData, expiresAt, httpStatus }) {
      const record = records.get(key) || { state: 'idle', checking: false, failures: 0 };
      const time = now();
      if (type === 'start') {
        record.checking = true;
        record.lastAttemptAt = time;
      }
      if (type === 'success' || type === 'error') {
        record.checking = false;
        record.durationMs = Math.max(0, time - (record.lastAttemptAt ?? time));
        if (type === 'success') {
          record.state = 'ready';
          record.lastSuccessAt = time;
          record.failures = 0;
        } else {
          record.state = hasData ? 'stale' : 'error';
          record.lastFailureAt = time;
          record.failures++;
          record.error = classifyFailure(error);
        }
        record.httpStatus = Number.isInteger(httpStatus)
          ? httpStatus
          : record.error?.httpStatus && type === 'error'
            ? record.error.httpStatus
            : null;
      }
      if (expiresAt !== undefined) record.expiresAt = expiresAt;
      records.set(key, record);
      if (records.size > maxEntries) records.delete(records.keys().next().value);
    },
    get(key) {
      const record = records.get(key);
      if (!record) return { state: 'idle', checking: false, failures: 0, cacheState: 'empty' };
      return {
        ...record,
        error: record.error ? { ...record.error } : undefined,
        cacheState:
          record.expiresAt === undefined
            ? 'empty'
            : now() < record.expiresAt
              ? record.state === 'ready'
                ? 'fresh'
                : 'backoff'
              : 'expired',
      };
    },
  };
}
