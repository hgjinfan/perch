import { createServer } from 'node:http';
import { createAdminGuard } from './security.js';
import { createAssets } from './assets.js';
import { createDashboardService } from './services/dashboard.js';
import { createAdminRoutes } from './routes/admin.js';
import { createPublicRoutes } from './routes/public.js';
import { HttpError, json, securityHeaders } from './http.js';
import { html, empty } from './render/html.js';

export async function createApplication({
  root,
  store,
  env = process.env,
  fetcher = fetch,
  logger = console,
}) {
  const assets = await createAssets(root);
  const guard = createAdminGuard({
    username: env.ADMIN_USERNAME || 'admin',
    password: env.ADMIN_PASSWORD,
    trustProxyHops: Number(env.TRUST_PROXY_HOPS || 0),
  });
  const dashboard = createDashboardService(store, { fetcher, env });
  const admin = createAdminRoutes({ store, assets, guard, fetcher, env, dashboard });
  const publicRoutes = createPublicRoutes({ store, dashboard, assets, shell: assets.homeShell });
  return createServer(async (request, response) => {
    securityHeaders(response);
    try {
      const path = new URL(request.url, 'http://localhost').pathname;
      await (assets.isAdmin(path) ? admin : publicRoutes)(path, request, response);
    } catch (error) {
      if (!(error instanceof HttpError)) logger.error('Request failed:', error.message);
      if (error.reload) response.setHeader('X-Homepage-Reload', '1');
      if (error.retryAfter) response.setHeader('Retry-After', String(error.retryAfter));
      if (request.url?.startsWith('/fragments/'))
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
