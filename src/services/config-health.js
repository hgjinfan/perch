import { resolveWidgetConnection } from '../widgets/connections.js';
import { mapWidget } from '../../shared/widget-types.js';

export const healthAdvice = {
  missing_credentials: [
    '缺少密钥变量',
    '在 Perch 服务环境中设置列出的变量；Docker 需显式传入变量，设置后重启服务。',
  ],
  literal_credentials: [
    '认证信息直接写在配置中',
    '建议将认证值改为 ${WIDGET_*} 环境变量引用，避免令牌进入配置备份。',
  ],
  parameter_credentials: [
    '请求参数中存在认证信息',
    '优先使用支持请求头认证的接口，并在连接请求头中引用环境变量；如果上游必须在参数或正文中认证，请妥善保护配置备份。正文和查询参数不会展开环境变量。',
  ],
  unused_connection: ['连接未被引用', '确认是否仍需保留；不再使用时可在管理页删除。'],
  missing_connection: ['连接引用无效', '为磁块重新选择共享连接并保存。'],
  static_mapping: ['手动数据与映射不匹配', '使用字段映射助手检查路径和类型，再测试预览。'],
  unconfigured: ['尚未配置地址', '填写服务访问地址或健康检查地址、订阅地址后保存。'],
  authentication: [
    '上游拒绝认证',
    '检查令牌是否有效、只读权限是否足够，以及服务版本要求的认证方式。',
  ],
  credentials: [
    '服务器缺少密钥变量',
    '检查连接或磁块引用的 WIDGET_ 变量，确认变量已传入运行进程后重启。',
  ],
  mapping: [
    '字段映射与响应不匹配',
    '读取字段结构并重新预览；检查空结果、字段类型及上游接口版本变化。',
  ],
  format: ['响应格式不符', '确认填写的是 JSON 或订阅接口，而非登录页；检查反向代理和服务版本。'],
  timeout: ['上游请求超时', '从 Perch 所在服务器检查连通性和响应耗时；检查请求排队情况。'],
  tls: ['证书校验失败', '检查证书有效期、域名及服务器信任链；使用受信任的证书。'],
  rate_limit: [
    '上游限流或请求预算不足',
    '等待冷却结束；适当降低刷新频率，检查运行概览中的并发和排队。',
  ],
  http: ['上游返回异常状态', '结合 HTTP 状态检查接口路径、反向代理和服务是否可用。'],
  network: [
    '无法获取上游数据',
    '从 Perch 所在服务器检查 DNS、地址、端口及网络；浏览器可访问不代表容器可访问。',
  ],
  size: ['响应超过限制', '缩小查询范围或使用摘要接口，响应须在 1 MiB 内。'],
};

// Heuristic only: detect common credential fields without retaining their values.
function literalSecret(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 8) return false;
  return Object.entries(value).some(
    ([key, item]) =>
      (/^(?:access[_-]?token|refresh[_-]?token|token|password|passwd|secret|api[_-]?key|authorization)$/i.test(
        key,
      ) &&
        typeof item === 'string' &&
        item.trim() &&
        !/\$\{WIDGET_[A-Z0-9_]+\}/.test(item)) ||
      literalSecret(item, depth + 1),
  );
}

// Read-only analysis of saved configuration and existing observations. Never fetch upstream.
export function inspectConfiguration(config, env = {}, diagnostics = { sources: [] }) {
  const findings = [];
  const summary = { errors: 0, warnings: 0, information: 0, unchecked: 0 };
  let truncated = false;
  function add(scope, id, name, code, severity, extra = {}) {
    if (findings.some((f) => f.scope === scope && f.id === id && f.code === code)) return;
    const [title, advice] = healthAdvice[code];
    summary[
      severity === 'error' ? 'errors' : severity === 'warning' ? 'warnings' : 'information'
    ]++;
    if (findings.length >= 200) {
      truncated = true;
      return;
    }
    findings.push({ scope, id, name, code, severity, title, advice, ...extra });
  }
  function credentials(source, scope, id, name, active) {
    const missing = new Set();
    let literal = false;
    for (const [key, value] of Object.entries(source.headers || {})) {
      for (const match of value.matchAll(/\$\{(WIDGET_[A-Z0-9_]+)\}/g))
        if (!env[match[1]]) missing.add(match[1]);
      if (
        /authorization|api.?key|token|secret/i.test(key) &&
        value.trim() &&
        !/\$\{WIDGET_[A-Z0-9_]+\}/.test(value)
      )
        literal = true;
    }
    if (missing.size)
      add(scope, id, name, 'missing_credentials', active ? 'error' : 'warning', {
        missingVariables: [...missing].slice(0, 20),
        missingVariableCount: missing.size,
      });
    if (literal) add(scope, id, name, 'literal_credentials', 'warning');
  }
  const visible = (widget) => !config.layout.hidden.includes(`widget-${widget.id}`);
  for (const connection of config.connections || []) {
    const references = config.widgets.filter(
      (w) => w.source.kind === 'connection' && w.source.connectionId === connection.id,
    );
    if (!references.length)
      add('connection', connection.id, connection.name, 'unused_connection', 'info');
    credentials(connection, 'connection', connection.id, connection.name, references.some(visible));
  }
  for (const widget of config.widgets) {
    let parametersContainCredentials =
      literalSecret(widget.source.body) || literalSecret(widget.source.query);
    if (widget.source.kind === 'api') {
      try {
        parametersContainCredentials ||= literalSecret(
          Object.fromEntries(new URL(widget.source.url).searchParams),
        );
      } catch {}
    }
    if (parametersContainCredentials)
      add('widget', widget.id, widget.title, 'parameter_credentials', 'warning');
    if (widget.source.kind === 'connection') {
      try {
        resolveWidgetConnection(widget, config.connections);
      } catch {
        add('widget', widget.id, widget.title, 'missing_connection', 'error');
      }
    } else if (widget.source.kind === 'api')
      credentials(widget.source, 'widget', widget.id, widget.title, visible(widget));
    else {
      try {
        mapWidget(widget, widget.source.data);
      } catch {
        add(
          'widget',
          widget.id,
          widget.title,
          'static_mapping',
          visible(widget) ? 'error' : 'warning',
        );
      }
    }
  }
  for (const source of diagnostics.sources) {
    if (!source.enabled) continue;
    if (!source.configured) {
      if (['service', 'feed'].includes(source.kind))
        add(source.kind, source.id, source.name, 'unconfigured', 'warning');
      continue;
    }
    if (source.state === 'idle' || source.checking) summary.unchecked++;
    if (
      ['error', 'stale'].includes(source.state) &&
      Object.hasOwn(healthAdvice, source.error?.code || '')
    )
      add(
        source.kind,
        source.id,
        source.name,
        source.error.code,
        source.state === 'error' ? 'error' : 'warning',
      );
  }
  return { summary, findings, truncated };
}
