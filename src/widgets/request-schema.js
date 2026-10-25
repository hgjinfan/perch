const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const short = (value, length) => typeof value === 'string' && value.length <= length;
export function validateHeaders(value) {
  const fail = (message) => {
    throw new Error(message);
  };
  const headers = value || {};
  if (!plain(headers) || Object.keys(headers).length > 12) fail('请求头须为对象，最多 12 个');
  for (const [key, value] of Object.entries(headers)) {
    if (
      !/^[A-Za-z0-9-]{1,60}$/.test(key) ||
      ['host', 'cookie', 'connection', 'content-length', 'transfer-encoding'].includes(
        key.toLowerCase(),
      ) ||
      !short(value, 2000) ||
      /[\r\n]/.test(value)
    )
      fail('请求头无效');
    for (const match of value.matchAll(/\$\{([^}]+)\}/g))
      if (!/^WIDGET_[A-Z0-9_]+$/.test(match[1])) fail('密钥变量名必须以 WIDGET_ 开头');
  }
  return headers;
}
