import { requestJson } from '../core/api.js';
import { node } from '../core/dom.js';
const time = (value) =>
  value === undefined ? '—' : new Date(value).toLocaleString('zh-CN', { hour12: false });
const kinds = { service: '服务检测', feed: '订阅', widget: '磁块', weather: '默认城市天气' };
const states = { ready: '正常', stale: '沿用旧内容', error: '失败', idle: '未检查' };
const caches = { fresh: '有效缓存', backoff: '失败结果缓存', expired: '已到期', empty: '无缓存' };
export function mountDiagnostics(root) {
  const list = root.querySelector('#diagnostics-list'),
    message = root.querySelector('#diagnostics-message'),
    refreshButton = root.querySelector('#diagnostics-refresh'),
    search = root.querySelector('#diagnostics-search'),
    filter = root.querySelector('#diagnostics-filter');
  async function runtime(current) {
    const target = root.querySelector('#runtime-overview');
    if (!target) return;
    try {
      const { budget, sources, cache } = await requestJson('/api/admin/runtime');
      if (current !== epoch) return;
      target.replaceChildren();
      target.append(node('h3', '运行概览'));
      const metrics = node('dl');
      metrics.className = 'diagnostic-metrics';
      for (const [label, value] of [
        ['正在请求', `${budget.active} / ${budget.concurrency}`],
        ['排队', `${budget.queued} / ${budget.maxQueue}`],
        ['后台请求', budget.backgroundActive],
        ['冷却来源', budget.cooling],
        ['已完成', budget.completed],
        ['请求失败', budget.failed],
        ['预算拒绝', budget.rejected],
        ['有效缓存来源', sources.fresh || 0],
        ['RSS / 磁块 / 状态缓存命中', cache.hits],
        ['RSS / 磁块 / 状态缓存加载', cache.loads],
      ]) {
        const pair = node('div');
        pair.append(node('dt', label), node('dd', String(value)));
        metrics.append(pair);
      }
      target.append(
        metrics,
        node('p', '当前进程累计；手动刷新记录时更新，不包含地址、凭据或访客位置。'),
      );
    } catch {
      if (current === epoch) target.textContent = '运行概览暂时不可用，刷新记录可重试。';
    }
  }
  let report,
    epoch = 0,
    checking = false,
    refreshQueued = false;
  function controls() {
    refreshButton.disabled = checking;
    for (const button of list.querySelectorAll('button'))
      button.disabled = checking || button.dataset.enabled !== 'true';
  }
  function draw() {
    if (!report) return;
    list.replaceChildren();
    const term = search.value.trim().toLowerCase();
    const items = report.sources.filter(
      (s) =>
        (!term || s.name.toLowerCase().includes(term)) &&
        (filter.value !== 'error' ||
          (s.enabled && s.configured && ['error', 'stale'].includes(s.state))) &&
        (filter.value !== 'idle' || (s.enabled && s.configured && s.state === 'idle')),
    );
    if (!items.length) {
      list.append(node('p', '没有符合条件的数据源。'));
      return;
    }
    for (const source of items) {
      const card = node('article');
      card.className = 'diagnostic-card';
      const header = node('div');
      header.className = 'diagnostic-header';
      const name = node('strong', source.name),
        status = node(
          'span',
          !source.enabled
            ? '已隐藏'
            : !source.configured
              ? '待配置'
              : source.checking
                ? '检测中'
                : states[source.state] || '未检查',
        );
      status.className = `diagnostic-state state-${source.enabled && source.configured ? source.state : 'idle'}`;
      const button = node('button', '检查');
      button.type = 'button';
      button.dataset.enabled = String(source.enabled && source.configured);
      button.setAttribute('aria-label', `检查 ${source.name}`);
      button.onclick = () => check(source.id);
      header.append(name, status, button);
      card.append(header);
      const kind = node(
        'p',
        `${kinds[source.kind]}${source.sourceType === 'manual' ? ' · 手动数据映射' : ''}${source.kind === 'weather' ? ' · 仅默认城市，不检查访客定位' : ''}`,
      );
      kind.className = 'field-help';
      card.append(kind);
      const metrics = node('dl');
      metrics.className = 'diagnostic-metrics';
      for (const [label, value] of [
        ['最近尝试', time(source.lastAttemptAt)],
        ['最近成功', time(source.lastSuccessAt)],
        ['最近失败', time(source.lastFailureAt)],
        ['处理耗时', source.durationMs === undefined ? '—' : `${source.durationMs} ms`],
        ['缓存', caches[source.cacheState] || '无缓存'],
        ['缓存到期', time(source.expiresAt)],
      ]) {
        const pair = node('div');
        pair.append(node('dt', label), node('dd', value));
        metrics.append(pair);
      }
      card.append(metrics);
      if (source.httpStatus) {
        const hint = node(
          'p',
          `HTTP ${source.httpStatus}${source.kind === 'service' && [401, 403].includes(source.httpStatus) ? ' · 服务可达，访问需要认证' : ''}`,
        );
        hint.className = 'field-help';
        card.append(hint);
      }
      if (source.error) {
        const error = node(
          'p',
          `${source.state === 'ready' ? '最近异常（已恢复）' : '异常原因'}：${source.error.message}${source.failures ? ` · 连续失败 ${source.failures} 次` : ''}`,
        );
        error.className = 'diagnostic-error';
        card.append(error);
      }
      list.append(card);
    }
    controls();
  }
  async function refresh() {
    if (!root.open) return;
    if (checking) {
      refreshQueued = true;
      return;
    }
    const current = ++epoch;
    message.textContent = '正在读取诊断记录…';
    try {
      const result = await requestJson('/api/admin/diagnostics');
      if (current !== epoch) return;
      report = result;
      draw();
      await runtime(current);
      if (current !== epoch) return;
      message.textContent = `记录更新于 ${time(report.generatedAt)}，共 ${report.sources.length} 个数据源。`;
    } catch (error) {
      if (current === epoch) message.textContent = `读取失败：${error.message}`;
    }
  }
  async function check(id) {
    if (checking) return;
    checking = true;
    controls();
    const current = ++epoch;
    message.textContent = '正在检查，已有有效缓存时直接使用缓存…';
    try {
      const result = await requestJson('/api/admin/diagnostics/check', {
        method: 'POST',
        body: { id },
      });
      if (current !== epoch) return;
      report = result;
      draw();
      await runtime(current);
      if (current !== epoch) return;
      message.textContent = `检查完成，记录更新于 ${time(report.generatedAt)}。`;
    } catch (error) {
      if (current === epoch) message.textContent = error.message;
    } finally {
      checking = false;
      controls();
      if (refreshQueued) {
        refreshQueued = false;
        refresh();
      }
    }
  }
  root.addEventListener('toggle', () => {
    if (root.open) refresh();
  });
  refreshButton.onclick = refresh;
  search.oninput = draw;
  filter.onchange = draw;
  return { refresh };
}
