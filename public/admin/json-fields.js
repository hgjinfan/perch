import { validPath, validScale } from '../../shared/widget-types.js';
export function parseJsonField(value, kind = 'data') {
  let result;
  try {
    result = JSON.parse(value);
  } catch {
    throw new Error('请输入有效的 JSON，检查引号、逗号和括号');
  }
  if (JSON.stringify(result).length > 16000) throw new Error('JSON 内容最多 16000 字符');
  if (kind === 'headers') {
    if (
      !result ||
      typeof result !== 'object' ||
      Array.isArray(result) ||
      Object.keys(result).length > 12
    )
      throw new Error('请求头须为 JSON 对象，最多 12 项');
    for (const [key, value] of Object.entries(result))
      if (
        !/^[A-Za-z0-9-]{1,60}$/.test(key) ||
        ['host', 'cookie', 'connection', 'content-length', 'transfer-encoding'].includes(
          key.toLowerCase(),
        ) ||
        typeof value !== 'string' ||
        value.length > 2000 ||
        /[\r\n]/.test(value) ||
        [...value.matchAll(/\$\{([^}]+)\}/g)].some((m) => !/^WIDGET_[A-Z0-9_]+$/.test(m[1]))
      )
        throw new Error('请检查请求头名称、字符串值和 WIDGET_ 密钥变量');
  }
  if (kind === 'fields') {
    if (!Array.isArray(result) || !result.length || result.length > 8)
      throw new Error('指标映射须为包含 1–8 项的 JSON 数组');
    for (const field of result)
      if (
        !field ||
        typeof field !== 'object' ||
        typeof field.label !== 'string' ||
        field.label.length > 60 ||
        !validPath(field.path) ||
        typeof (field.unit ?? '') !== 'string' ||
        (field.unit || '').length > 20 ||
        !validScale(field.scale === undefined ? 1 : field.scale)
      )
        throw new Error('请检查每个指标的 label、path、unit 和可选 scale');
  }
  return result;
}
