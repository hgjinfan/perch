import { createServer } from 'node:http';
import { createBudgetedFetcher } from './request-budget.js';
import { createAdminGuard } from './security.js';
import { createAssets } from './assets.js';
import { createDashboardService } from './services/dashboard.js';
import { createAdminRoutes } from './routes/admin.js';
import { createPublicRoutes } from './routes/public.js';
import { HttpError, json, securityHeaders } from './http.js';
import { html, empty } from './render/html.js';
import { readJson, requireMethod, requireSameOriginJson } from './http.js';
import { normalizeIp } from './client-ip.js';
import { normalizeBasePath, stripBasePath } from './base-path.js';

function requireLocalSetup(request) {
  let hostname;
  try {
    hostname = new URL(`http://${request.headers.host}`).hostname;
  } catch {}
  if (
    !['127.0.0.1', '::1'].includes(normalizeIp(request.socket.remoteAddress)) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(hostname) ||
    ['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip'].some(
      (key) => request.headers[key] !== undefined,
    )
  )
    throw new HttpError(403, '首次初始化仅允许直接本机访问');
}

export async function createApplication({
  root,
  store,
  env = process.env,
  fetcher = fetch,
  logger = console,
  assetsMode = 'source',
  assetsDirectory,
}) {
  const basePath = normalizeBasePath(env.BASE_PATH || '');
  const assets = await createAssets(root, {
    mode: assetsMode,
    directory: assetsDirectory,
    basePath,
  });
  const guard = createAdminGuard({
    username: env.ADMIN_USERNAME || 'admin',
    password: env.ADMIN_PASSWORD,
    trustProxyHops: Number(env.TRUST_PROXY_HOPS || 0),
  });
  fetcher = createBudgetedFetcher(fetcher, { env });
  const dashboard = createDashboardService(store, { fetcher, env });
  const admin = createAdminRoutes({ store, assets, guard, fetcher, env, dashboard });
  const publicRoutes = createPublicRoutes({
    store,
    dashboard,
    assets,
    shell: assets.homeShell,
    basePath,
  });
  return createServer(async (request, response) => {
    securityHeaders(response, { scriptHashes: assets.scriptHashes });
    let path = '/';
    try {
      path = stripBasePath(new URL(request.url, 'http://localhost').pathname, basePath);
      if (path === '/api/setup') {
        requireMethod(request, 'GET', 'POST');
        requireLocalSetup(request);
        guard(request, response);
        if (store.initialized) throw new HttpError(409, '首页已经完成初始化');
        if (request.method === 'GET')
          return json(response, { initialized: false, config: store.get() });
        requireSameOriginJson(request);
        const body = await readJson(request, 1024 * 32);
        const current = store.get();
        const next = {
          ...current,
          title: body.title ?? current.title,
          timezone: body.timezone ?? current.timezone,
          weather: body.weather === null ? null : { ...current.weather, ...body.weather },
        };
        await store.initialize(next);
        return json(response, { initialized: true });
      }
      if (path === '/setup' && !store.initialized) {
        requireMethod(request, 'GET', 'HEAD');
        requireLocalSetup(request);
        guard(request, response);
        return assets.send('/setup.html', request, response);
      }
      await (assets.isAdmin(path) ? admin : publicRoutes)(path, request, response);
    } catch (error) {
      if (!(error instanceof HttpError)) logger.error('Request failed:', error.message);
      if (error.reload) response.setHeader('X-Homepage-Reload', '1');
      if (error.retryAfter) response.setHeader('Retry-After', String(error.retryAfter));
      if (path.startsWith('/fragments/'))
        return html(
          response,
          empty(error.status === 404 ? '内容不可用' : '暂时无法更新', '请稍后重试。', true),
          error.status || 500,
          request.method,
        );
      json(
        response,
        { error: error instanceof HttpError ? error.message : '暂时无法完成请求' },
        error.status || 500,
      );
    }
  });
}
