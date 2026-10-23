import { compareConfigs } from '../config/diff.js';
import { inspectWidget } from '../widgets/source.js';
import { createRequestLimiter } from '../request-budget.js';
import { createBackup, parseBackup, summarizeConfig, BACKUP_LIMIT } from '../config/backups.js';
import { HttpError, json, readJson, requireMethod, requireSameOriginJson } from '../http.js';
import { validateWidget, loadWidget } from '../widgets.js';
import { html } from '../render/html.js';
import { renderPreview } from '../render/widgets.js';

export function createAdminRoutes({ store, assets, guard, fetcher, env, dashboard }) {
  const limitPreview = createRequestLimiter({ limit: 20 });
  const limitDiagnostics = createRequestLimiter({ limit: 30 });
  function configVersionHeaders(response) {
    response.setHeader('ETag', store.version);
    response.setHeader('X-Config-Version', store.version.slice(1, -1));
  }
  return async (path, request, response) => {
    guard(request, response);
    if (path === '/api/admin/runtime') {
      requireMethod(request, 'GET');
      return json(response, {
        budget: fetcher.snapshot?.(),
        cache: dashboard.cacheStats(),
        sources: dashboard.diagnostics().sources.reduce((counts, source) => {
          counts[source.cacheState] = (counts[source.cacheState] || 0) + 1;
          return counts;
        }, {}),
      });
    }
    if (path === '/api/admin/diagnostics') {
      requireMethod(request, 'GET');
      return json(response, dashboard.diagnostics());
    }
    if (path === '/api/admin/diagnostics/check') {
      requireMethod(request, 'POST');
      requireSameOriginJson(request);
      limitDiagnostics('admin');
      const body = await readJson(request, 1024);
      if (typeof body?.id !== 'string' || body.id.length > 80)
        throw new HttpError(400, '数据源标识无效');
      return json(response, await dashboard.checkDiagnostic(body.id));
    }
    if (path === '/api/admin/backup') {
      requireMethod(request, 'GET');
      response.setHeader(
        'Content-Disposition',
        'attachment; filename="perch-homepage-backup.json"',
      );
      return json(response, createBackup(store.get()));
    }
    if (path === '/api/admin/backups') {
      requireMethod(request, 'GET');
      return json(response, await store.backups.list());
    }
    if (path.startsWith('/api/admin/backups/')) {
      requireMethod(request, 'GET');
      return json(response, await store.backups.read(path.slice('/api/admin/backups/'.length)));
    }
    if (path === '/api/admin/backup/preview' || path === '/api/admin/backup/restore') {
      requireMethod(request, 'POST');
      requireSameOriginJson(request);
      const config = parseBackup(await readJson(request, BACKUP_LIMIT));
      if (path.endsWith('/preview')) {
        configVersionHeaders(response);
        return json(response, {
          ...summarizeConfig(config),
          ...compareConfigs(store.get(), config),
        });
      }
      await store.save(config, request.headers['if-match'], { recovery: true });
      configVersionHeaders(response);
      return json(response, { restored: true });
    }
    if (path === '/api/admin/config') {
      if (request.method === 'GET') {
        configVersionHeaders(response);
        return json(response, store.get());
      }
      requireMethod(request, 'PUT');
      requireSameOriginJson(request);
      const saved = await store.save(await readJson(request), request.headers['if-match']);
      configVersionHeaders(response);
      return json(response, saved);
    }
    if (path === '/api/admin/widget-preview' || path === '/api/admin/widget-inspect') {
      requireMethod(request, 'POST');
      requireSameOriginJson(request);
      limitPreview('admin');
      const value = await readJson(request);
      let widget;
      try {
        widget = validateWidget(value);
      } catch (error) {
        throw new HttpError(400, error.message);
      }
      try {
        const controller = new AbortController();
        response.once('close', () => {
          if (!response.writableEnded) controller.abort();
        });
        const upstream = fetcher.background || fetcher;
        const background = (url, options = {}) =>
          upstream(url, {
            ...options,
            signal: options.signal
              ? AbortSignal.any([options.signal, controller.signal])
              : controller.signal,
          });
        if (path.endsWith('widget-inspect'))
          return json(response, await inspectWidget(widget, background, env));
        return html(response, renderPreview(widget, await loadWidget(widget, background, env)));
      } catch (error) {
        const known =
          /^(映射字段|找不到文本|总量必须|列表路径|API 返回 HTTP|缺少密钥|响应不是|响应超过)/.test(
            error.message,
          );
        throw new HttpError(422, known ? error.message : '接口请求失败，请检查地址、认证和网络');
      }
    }
    requireMethod(request, 'GET', 'HEAD');
    await assets.send(path, request, response);
  };
}
