import { requestJson } from '../core/api.js';
import { node } from '../core/dom.js';

export async function renderConfigHealth(root, isCurrent = () => true) {
  const message = root.querySelector('#health-message'),
    list = root.querySelector('#health-findings');
  if (!message || !list) return;
  message.textContent = '正在检查已保存配置…';
  try {
    const report = await requestJson('/api/admin/config-check');
    if (!isCurrent()) return;
    list.replaceChildren();
    const { errors, warnings, information, unchecked } = report.summary;
    message.textContent = `${errors} 项错误 · ${warnings} 项建议 · ${information} 项提示。${unchecked} 个启用的数据源尚未完成检查；配置体检不代表服务在线。${report.truncated ? '问题较多，仅显示前 200 项。' : ''}`;
    if (!report.findings.length)
      list.append(node('p', '未发现配置问题。接口可用性请以下方实际检查结果为准。'));
    const priority = { error: 0, warning: 1, info: 2 };
    for (const finding of [...report.findings].sort(
      (a, b) => (priority[a.severity] ?? 3) - (priority[b.severity] ?? 3),
    )) {
      const card = node('article');
      card.className = 'diagnostic-card';
      const header = node('div');
      header.className = 'health-finding-header';
      const severity = ['error', 'warning', 'info'].includes(finding.severity)
        ? finding.severity
        : 'info';
      const badge = node('span', { error: '错误', warning: '建议', info: '提示' }[severity]);
      badge.className = `health-severity health-severity-${severity}`;
      header.append(badge, node('strong', `${finding.name} · ${finding.title}`));
      const advice = node('p', finding.advice);
      advice.className = 'health-advice';
      card.append(header, advice);
      if (finding.missingVariables?.length)
        card.append(
          node(
            'p',
            '缺少变量：' +
              finding.missingVariables.join('、') +
              (finding.missingVariableCount > finding.missingVariables.length
                ? '（仅列出前 20 项）'
                : ''),
          ),
        );
      list.append(card);
    }
  } catch (error) {
    if (isCurrent()) {
      list.replaceChildren();
      message.textContent = `配置体检失败：${error.message}`;
    }
  }
}
