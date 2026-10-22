import { createCache, checkService, readRemote, parseFeed } from '../data.js';
import { loadWidget } from '../widgets.js';
import { HttpError } from '../http.js';
import { createWeatherService } from './weather.js';
import { moduleVisible } from '../config/visibility.js';
import { clientIp, normalizeIp } from '../client-ip.js';
import { createRequestLimiter, boundedInteger } from '../request-budget.js';

function requireVisible(config, id) {
  if (!moduleVisible(config, id)) throw new HttpError(404, 'Not found');
}

export function createDashboardService(store, { fetcher = fetch, env = process.env } = {}) {
  const weatherService = createWeatherService({ fetcher, env });
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
  let revision = store.revision;
  let cached = createCache();
  function current() {
    if (revision !== store.revision) {
      cached = createCache();
      revision = store.revision;
    }
    return store.get();
  }
  return {
    status() {
      const config = current();
      requireVisible(config, 'status');
      return cached('status', 60000, () =>
        Promise.all(config.services.map((s) => checkService(s, fetcher))),
      );
    },
    feed(id) {
      const config = current();
      requireVisible(config, `feed-${id}`);
      const feed = config.feeds.find((f) => f.id === id);
      if (!feed) throw new HttpError(404, 'Not found');
      if (!feed.url) return { state: 'unconfigured' };
      return cached(`feed:${id}`, 300000, async () =>
        parseFeed(await readRemote(feed.url, fetcher), feed.limit),
      );
    },
    widget(id) {
      const config = current();
      const widget = config.widgets.find((w) => w.id === id);
      if (!widget || config.layout.hidden.includes(`widget-${id}`))
        throw new HttpError(404, 'Not found');
      return cached(`widget:${id}`, widget.refresh * 1000, () => loadWidget(widget, fetcher, env));
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
  };
}
