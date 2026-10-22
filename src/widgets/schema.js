import { safeUrl } from '../../shared/url.js';
import { validPath, validScale, widgetDefinitions } from '../../shared/widget-types.js';
const widgetTypes = Object.keys(widgetDefinitions);
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const short = (value, length = 200) => typeof value === 'string' && value.length <= length;
export function validateWidget(w) {
  const fail = (message) => {
    throw new Error(`自定义磁块：${message}`);
  };
  if (
    !plain(w) ||
    !short(w.id, 50) ||
    !/^[a-z0-9_-]{1,50}$/.test(w.id) ||
    !short(w.title, 80) ||
    !w.title.trim() ||
    !widgetTypes.includes(w.type)
  )
    fail('名称、标识或展示类型无效');
  if (!/^[a-z0-9-]{1,60}$/.test(w.icon || 'box') || !short(w.description || '', 200))
    fail('图标或说明无效');
  const refresh = w.refresh ?? 300;
  if (!Number.isInteger(refresh) || refresh < 30 || refresh > 86400)
    fail('刷新间隔须为 30–86400 秒');
  const source = w.source;
  if (!plain(source) || !['static', 'api'].includes(source.kind)) fail('请选择手动内容或 API');
  let normalizedSource;
  if (source.kind === 'static') {
    if (source.data === undefined || JSON.stringify(source.data).length > 16000)
      fail('手动内容不能为空，最多 16000 字符');
    normalizedSource = { kind: 'static', data: source.data };
  } else {
    if (
      !safeUrl(source.url) ||
      source.url.length > 2048 ||
      !['GET', 'POST'].includes(source.method || 'GET')
    )
      fail('API 地址或请求方式无效');
    const headers = source.headers || {};
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
    if (source.body !== undefined && JSON.stringify(source.body).length > 16000)
      fail('请求正文过大');
    normalizedSource = {
      kind: 'api',
      url: source.url,
      method: source.method || 'GET',
      headers,
      ...(source.body !== undefined ? { body: source.body } : {}),
    };
  }
  const mapping = w.mapping || {};
  if (!plain(mapping)) fail('字段映射无效');
  const normalizedMap = {};
  for (const key of ['value', 'max', 'items', 'label', 'url', 'detail', 'text'])
    if (mapping[key] !== undefined) {
      if (!validPath(mapping[key]))
        fail(`字段路径 ${key} 无效，使用 data.items 或 data.0.value 格式`);
      normalizedMap[key] = mapping[key];
    }
  if (!validScale(w.scale ?? 1)) fail('数值倍率须为 1e-12–1e12');
  const fields = w.fields || [];
  if (!Array.isArray(fields) || fields.length > 8) fail('多指标最多 8 项');
  const normalizedFields = fields.map((f) => {
    if (
      !plain(f) ||
      !short(f.label, 60) ||
      !validPath(f.path) ||
      !short(f.unit || '', 20) ||
      !validScale(f.scale === undefined ? 1 : f.scale)
    )
      fail('指标名称、路径或单位无效');
    return {
      label: f.label,
      path: f.path,
      unit: f.unit || '',
      ...(f.scale === undefined ? {} : { scale: f.scale }),
    };
  });
  if (widgetDefinitions[w.type].controls.fields && !normalizedFields.length)
    fail('请至少添加一个指标');
  const limit = w.limit ?? 5;
  if (!Number.isInteger(limit) || limit < 1 || limit > 20 || !short(w.unit || '', 20))
    fail('显示条数或单位无效');
  const decimals = w.decimals ?? 1;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 6) fail('小数位数须为 0–6');
  const threshold = w.threshold ?? null;
  if (threshold !== null && (!Number.isFinite(threshold) || threshold < 0 || threshold > 100))
    fail('告警阈值须为 0–100%');
  return {
    id: w.id,
    title: w.title,
    icon: w.icon || 'box',
    description: w.description || '',
    type: w.type,
    source: normalizedSource,
    mapping: normalizedMap,
    fields: normalizedFields,
    refresh,
    limit,
    unit: w.unit || '',
    decimals,
    scale: w.scale ?? 1,
    threshold,
  };
}
