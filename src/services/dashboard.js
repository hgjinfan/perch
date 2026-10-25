import { createCache, checkService, readRemote, parseFeed } from '../data.js';
import { resolveWidgetConnection } from '../widgets/connections.js';
import { loadWidget } from '../widgets.js';
import { HttpError } from '../http.js';
import { createWeatherService } from './weather.js';
import { moduleVisible } from '../config/visibility.js';
import { clientIp, normalizeIp } from '../client-ip.js';
import { createRequestLimiter, boundedInteger } from '../request-budget.js';
import { createDiagnostics } from '../diagnostics.js';
import { createHash } from 'node:crypto';

function requireVisible(config, id) {
  if (!moduleVisible(config, id)) throw new HttpError(404, 'Not found');
}
export function createDashboardService(
  store,
  { fetcher = fetch, env = process.env, now = Date.now } = {},
) {
  const weatherService = createWeatherService({ fetcher, env, now });
  const weatherLimit = createRequestLimiter({
    limit: boundedInteger(env.WEATHER_RATE_LIMIT, 60, 1, 600),
  });
  const searchLimit = createRequestLimiter({
    limit: boundedInteger(env.CITY_SEARCH_RATE_LIMIT, 20, 1, 120),
  });
  const visitor = (request) =>
    clientIp(request, Number(env.TRUST_PROXY_HOPS || 0)) ||
    normalizeIp(request.socket.remoteAddress) ||
    'unresolved';
  const diagnostics = createDiagnostics({ now });
  const cacheStats = { hits: 0, loads: 0 };
  function countCache(event) {
    if (event.type === 'hit') cacheStats.hits++;
    if (event.type === 'start') cacheStats.loads++;
  }
  let revision = store.revision,
    cached,
    diagnosticWeather;
  const probes = new Map(),
    resourceCaches = new Map();
  function signature(value) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }
  function resource(key, inputs, ttl, loader) {
    const fingerprint = signature(inputs);
    let entry = resourceCaches.get(key);
    if (!entry || entry.fingerprint !== fingerprint) {
      entry = { fingerprint };
      let epoch;
      entry.read = createCache(now, {
        maxEntries: 1,
        onEvent(event) {
          countCache(event);
          if (event.type === 'start') epoch = store.revision;
          if (resourceCaches.get(key) !== entry) return;
          if (event.type === 'hit' || epoch === store.revision) diagnostics.observe(event);
        },
      });
      resourceCaches.set(key, entry);
    }
    return entry.read(key, ttl, loader);
  }
  function resetCaches() {
    const epoch = store.revision;
    cached = createCache(now, {
      onEvent: (event) => {
        countCache(event);
        if (epoch !== store.revision) return;
        if (event.key === 'status') {
          if (event.expiresAt !== undefined)
            for (const service of store.get().services)
              if (service.url || service.healthUrl || service.internalUrl)
                diagnostics.observe({
                  key: `service:${service.id}`,
                  type: 'cache',
                  expiresAt: event.expiresAt,
                });
        } else diagnostics.observe(event);
      },
    });
    // A separate admin-only forecast avoids observing visitor locations, IPs or city searches.
    diagnosticWeather = createWeatherService({
      fetcher: fetcher.background || fetcher,
      env,
      now,
      onForecastEvent: (event) => {
        if (epoch === store.revision) diagnostics.observe({ ...event, key: 'weather' });
      },
    });
  }
  resetCaches();
  function current() {
    if (revision !== store.revision) {
      revision = store.revision;
      diagnostics.clear();
      const config = store.get();
      const active = new Map([
        ...config.feeds
          .filter((f) => moduleVisible(config, `feed-${f.id}`) && f.url)
          .map((f) => [`feed:${f.id}`, signature([f.url, f.limit, f.filters])]),
        ...config.widgets
          .filter((w) => !config.layout.hidden.includes(`widget-${w.id}`))
          .map((w) => [`widget:${w.id}`, signature(widgetInputs(w, config.connections))]),
      ]);
      for (const [key, entry] of resourceCaches)
        if (active.get(key) !== entry.fingerprint) resourceCaches.delete(key);
      resetCaches();
    }
    return store.get();
  }
  function widgetInputs(widget, connections) {
    const { id, title, ...inputs } = resolveWidgetConnection(widget, connections);
    return inputs;
  }
  function sources() {
    const config = current();
    return [
      ...config.services.map((s) => ({
        id: `service:${s.id}`,
        name: s.name,
        kind: 'service',
        enabled: moduleVisible(config, 'status'),
        configured: Boolean(s.url || s.healthUrl || s.internalUrl),
        sourceType: 'http',
      })),
      ...config.feeds.map((f) => ({
        id: `feed:${f.id}`,
        name: f.name,
        kind: 'feed',
        enabled: moduleVisible(config, `feed-${f.id}`),
        configured: Boolean(f.url),
        sourceType: 'rss',
      })),
      ...config.widgets.map((w) => ({
        id: `widget:${w.id}`,
        name: w.title,
        kind: 'widget',
        enabled: !config.layout.hidden.includes(`widget-${w.id}`),
        configured:
          w.source.kind === 'static' || w.source.kind === 'connection' || Boolean(w.source.url),
        sourceType: w.source.kind === 'static' ? 'manual' : 'api',
      })),
      {
        id: 'weather',
        name: config.titles.weather || '默认城市天气',
        kind: 'weather',
        enabled: moduleVisible(config, 'weather'),
        configured: Boolean(config.weather),
        sourceType: 'default-city',
      },
    ];
  }
  const service = {
    cacheStats: () => ({ ...cacheStats }),
    status(requestFetcher = fetcher) {
      const config = current();
      requireVisible(config, 'status');
      const epoch = store.revision;
      return cached('status', 60000, () =>
        Promise.all(
          config.services.map(async (s) => {
            const key = `service:${s.id}`;
            if (epoch === store.revision && (s.url || s.healthUrl || s.internalUrl))
              diagnostics.observe({ key, type: 'start' });
            let failure;
            const result = await checkService(s, requestFetcher, (error) => (failure = error));
            if (epoch === store.revision && result.state !== 'unconfigured')
              diagnostics.observe({
                key,
                type: result.state === 'online' ? 'success' : 'error',
                error: failure || new Error(`HTTP ${result.status}`),
                httpStatus: result.status,
              });
            return result;
          }),
        ),
      );
    },
    feed(id, requestFetcher = fetcher) {
      const config = current();
      requireVisible(config, `feed-${id}`);
      const feed = config.feeds.find((f) => f.id === id);
      if (!feed) throw new HttpError(404, 'Not found');
      if (!feed.url) return { state: 'unconfigured' };
      return resource(`feed:${id}`, [feed.url, feed.limit, feed.filters], 300000, async () =>
        parseFeed(await readRemote(feed.url, requestFetcher), feed.limit, feed.filters),
      );
    },
    widget(id, requestFetcher = fetcher) {
      const config = current();
      const widget = config.widgets.find((w) => w.id === id);
      if (!widget || config.layout.hidden.includes(`widget-${id}`))
        throw new HttpError(404, 'Not found');
      return resource(
        `widget:${id}`,
        widgetInputs(widget, config.connections),
        widget.refresh * 1000,
        () => loadWidget(widget, requestFetcher, env, config.connections),
      );
    },
    weather(request) {
      const config = current();
      requireVisible(config, 'weather');
      weatherLimit(visitor(request));
      return weatherService.get(config.weather, request);
    },
    cities(query, request) {
      const config = current();
      requireVisible(config, 'weather');
      if (!config.weather) throw new HttpError(404, 'Not found');
      searchLimit(visitor(request));
      return weatherService.search(query);
    },
    diagnostics() {
      return {
        generatedAt: now(),
        sources: sources().map((source) => ({ ...source, ...diagnostics.get(source.id) })),
      };
    },
    async checkDiagnostic(id) {
      const source = sources().find((s) => s.id === id);
      if (!source || !source.enabled || !source.configured)
        throw new HttpError(404, '数据源未启用或尚未配置');
      const probeKey = `${store.revision}:${id}`;
      if (probes.has(probeKey)) return probes.get(probeKey);
      // Old-generation requests still count toward the global bound until they settle;
      // they may share a public cache request, so cancelling them would disrupt readers.
      if (probes.size >= 2) {
        const error = new HttpError(429, '诊断任务繁忙，请稍后重试');
        error.retryAfter = 2;
        throw error;
      }
      const config = store.get();
      const task = Promise.resolve()
        .then(async () => {
          if (store.get() !== config) throw new HttpError(409, '配置已变化，请刷新诊断列表');
          if (source.kind === 'service') await service.status(fetcher.background || fetcher);
          else if (source.kind === 'feed')
            await service.feed(id.slice(5), fetcher.background || fetcher);
          else if (source.kind === 'widget')
            await service.widget(id.slice(7), fetcher.background || fetcher);
          else
            await diagnosticWeather.get(
              { ...config.weather, mode: 'fixed' },
              { url: '/diagnostic-weather', headers: {}, socket: { remoteAddress: '127.0.0.1' } },
            );
          if (store.get() !== config) throw new HttpError(409, '配置已变化，请刷新诊断列表');
          return service.diagnostics();
        })
        .finally(() => probes.delete(probeKey));
      probes.set(probeKey, task);
      return task;
    },
  };
  return service;
}
