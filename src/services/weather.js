import { createHash } from 'node:crypto';
import { createCache, readRemote } from '../data.js';
import { visitorIp } from '../client-ip.js';
import { HttpError } from '../http.js';
import { normalizeForecast } from './weather-data.js';
import { createUpstreamBudget, boundedInteger } from '../request-budget.js';

function location(value) {
  if (
    !value ||
    typeof value.name !== 'string' ||
    !value.name.trim() ||
    value.name.length > 100 ||
    !Number.isFinite(value.latitude) ||
    Math.abs(value.latitude) > 90 ||
    !Number.isFinite(value.longitude) ||
    Math.abs(value.longitude) > 180
  )
    throw new Error('Invalid location');
  const timezone = value.timezone || 'auto';
  if (timezone !== 'auto') new Intl.DateTimeFormat('en', { timeZone: timezone }).format();
  return { name: value.name, latitude: value.latitude, longitude: value.longitude, timezone };
}

export function createWeatherService({ fetcher = fetch, env = process.env, now = Date.now } = {}) {
  const upstream = createUpstreamBudget({
    concurrency: boundedInteger(env.WEATHER_CONCURRENCY, 4, 1, 16),
    now,
  });
  const remoteJson = (url) =>
    upstream.run(new URL(url).hostname, async () => JSON.parse(await readRemote(url, fetcher)));
  const geo = createCache(now, { maxEntries: 512 });
  const weather = createCache(now, { maxEntries: 256 });
  const cities = createCache(now, { maxEntries: 128 });
  return {
    async get(fallback, request) {
      if (!fallback) return { state: 'unconfigured' };
      const params = new URL(request.url, 'http://localhost').searchParams;
      let selected = location(fallback),
        source = 'fixed',
        reason;
      if (['lat', 'lon', 'city', 'tz'].some((key) => params.has(key))) {
        if (!params.get('lat')?.trim() || !params.get('lon')?.trim())
          throw new HttpError(400, '城市位置无效');
        try {
          selected = location({
            name: params.get('city'),
            latitude: Number(params.get('lat')),
            longitude: Number(params.get('lon')),
            timezone: params.get('tz'),
          });
        } catch {
          throw new HttpError(400, '城市位置无效');
        }
        source = 'manual';
      } else if ((fallback.mode || 'fixed') === 'ip') {
        const ip = visitorIp(request, Number(env.TRUST_PROXY_HOPS || 0));
        if (ip) {
          // The raw address is never returned to clients or written to disk.
          const key = createHash('sha256').update(ip).digest('hex');
          const result = await geo(key, 6 * 60 * 60 * 1000, async () => {
            const data = await remoteJson(`https://ipwho.is/${encodeURIComponent(ip)}`);
            if (data.success !== true) throw new Error('IP lookup failed');
            return location({
              name: data.city || data.region || data.country,
              latitude: data.latitude,
              longitude: data.longitude,
              timezone: data.timezone?.id,
            });
          });
          if (result.data) {
            selected = result.data;
            source = 'ip';
          } else {
            source = 'fallback';
            reason = '定位暂不可用，显示默认城市';
          }
        } else {
          source = 'fallback';
          reason = '无法识别公网位置，显示默认城市';
        }
      }
      const key = `${selected.latitude.toFixed(3)},${selected.longitude.toFixed(3)},${selected.timezone}`;
      const result = await weather(key, 900000, () => fetchWeather(selected, remoteJson));
      return {
        ...result,
        location: { name: selected.name, source, ...(reason ? { reason } : {}) },
      };
    },
    async search(query) {
      const term = typeof query === 'string' ? query.trim() : '';
      if (term.length < 2 || term.length > 80) throw new HttpError(400, '请输入 2–80 字的城市名称');
      const result = await cities(term.toLowerCase(), 3600000, async () => {
        const params = new URLSearchParams({
          name: term,
          count: '6',
          language: 'zh',
          format: 'json',
        });
        const data = await remoteJson(`https://geocoding-api.open-meteo.com/v1/search?${params}`);
        return (data.results || []).slice(0, 6).flatMap((item) => {
          try {
            return [
              {
                ...location(item),
                region: [item.admin1, item.country].filter(Boolean).join(' · '),
              },
            ];
          } catch {
            return [];
          }
        });
      });
      if (!result.data) throw new HttpError(502, '城市搜索暂不可用');
      return { results: result.data };
    },
  };
}

async function fetchWeather(selected, remoteJson) {
  const params = new URLSearchParams({
    latitude: selected.latitude,
    longitude: selected.longitude,
    current: 'temperature_2m,apparent_temperature,weather_code,is_day',
    hourly: 'temperature_2m,weather_code,precipitation_probability,is_day',
    forecast_days: '2',
    timezone: selected.timezone,
  });
  const data = await remoteJson(`https://api.open-meteo.com/v1/forecast?${params}`);
  return normalizeForecast(data);
}
