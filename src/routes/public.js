import { createPageVersion } from '../config/page-version.js';
import { json, requireMethod, HttpError } from '../http.js';
import { html } from '../render/html.js';
import { renderHome } from '../render/page.js';
import { renderServiceResult } from '../render/services.js';
import { moduleVisible } from '../config/visibility.js';
import { describeModules, renderModuleResult, renderCities } from '../render/modules.js';

export function createPublicRoutes({ store, dashboard, assets, shell }) {
  const pageVersion = createPageVersion(store, assets.version);
  return async (path, request, response) => {
    requireMethod(request, 'GET', 'HEAD');
    const versioned = path.match(/^\/fragments\/([a-f0-9]{20})(\/.*)$/);
    if (path.startsWith('/fragments/')) {
      if (!versioned || versioned[1] !== assets.version) {
        const error = new HttpError(409, '页面已更新，请重新加载');
        error.reload = true;
        throw error;
      }
      path = '/fragments' + versioned[2];
    }
    if (path === '/page-version') {
      const etag = '"' + pageVersion() + '"';
      response.writeHead(request.headers['if-none-match'] === etag ? 304 : 204, {
        ETag: etag,
        'Cache-Control': 'no-store',
      });
      response.end();
      return;
    }
    if (path === '/healthz') return json(response, { ok: true });
    if (path === '/' || path === '/index.html')
      return html(
        response,
        renderHome(store.get(), shell, assets.version, pageVersion()),
        200,
        request.method,
      );
    if (path === '/fragments/weather/cities') {
      const result = await dashboard.cities(
        new URL(request.url, 'http://localhost').searchParams.get('q'),
        request,
      );
      return html(response, renderCities(result.results), 200, request.method);
    }
    if (path === '/fragments/status') {
      const config = store.get();
      if (!moduleVisible(config, 'status') || !config.services.length)
        throw new HttpError(404, 'Not found');
      const result = await dashboard.status();
      if (!moduleVisible(store.get(), 'status')) throw new HttpError(404, 'Not found');
      if (store.get() !== config) throw new HttpError(409, '配置已更新，请重试');
      if (result.state === 'error') throw new HttpError(503, '暂时无法更新');
      return html(response, renderServiceResult(config, result), 200, request.method);
    }
    const match = path.match(/^\/fragments\/([a-z0-9_-]+)$/);
    if (match) {
      const config = store.get();
      const module = describeModules(config).find((item) => item.id === match[1]);
      if (!module || !module.dynamic) throw new HttpError(404, 'Not found');
      const result =
        module.kind === 'feed'
          ? await dashboard.feed(module.sourceId)
          : module.kind === 'widget'
            ? await dashboard.widget(module.sourceId)
            : module.kind === 'weather'
              ? await dashboard.weather(request)
              : await dashboard.status();
      if (result.state === 'error') throw new HttpError(503, '暂时无法更新');
      // A configuration may have changed while awaiting the upstream.
      if (!describeModules(store.get()).some((item) => item.id === module.id && item.dynamic))
        throw new HttpError(404, 'Not found');
      if (store.get() !== config) throw new HttpError(409, '配置已更新，请重试');
      return html(response, renderModuleResult(module, result, config), 200, request.method);
    }
    await assets.send(path, request, response);
  };
}
