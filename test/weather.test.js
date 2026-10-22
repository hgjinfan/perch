import test from 'node:test';
import assert from 'node:assert/strict';
import { publicIp, visitorIp } from '../src/client-ip.js';
import { createWeatherService } from '../src/services/weather.js';
import { validateConfig } from '../src/config/schema.js';
import { readFile } from 'node:fs/promises';

const request = (ip, url = '/api/weather', headers = {}) => ({
  url,
  headers,
  socket: { remoteAddress: ip },
});
const fallback = {
  mode: 'ip',
  name: '首尔',
  latitude: 37.5665,
  longitude: 126.978,
  timezone: 'Asia/Seoul',
};
const forecast = (temperature) => ({
  current: {
    time: '2026-10-21T10:00',
    temperature_2m: temperature,
    apparent_temperature: temperature,
  },
  hourly: { time: ['2026-10-21T11:00'], temperature_2m: [temperature] },
});

test('IP extraction ignores untrusted forwarding and honors exact trusted hop count', () => {
  assert.equal(visitorIp(request('8.8.8.8', '/', { 'x-forwarded-for': '1.1.1.1' })), '8.8.8.8');
  assert.equal(
    visitorIp(request('127.0.0.1', '/', { 'x-forwarded-for': '9.9.9.9, 8.8.8.8' }), 1),
    '8.8.8.8',
  );
  assert.equal(
    visitorIp(request('127.0.0.1', '/', { 'x-forwarded-for': '9.9.9.9, 8.8.8.8' }), 2),
    '9.9.9.9',
  );
  assert.equal(visitorIp(request('127.0.0.1', '/', { 'x-forwarded-for': '8.8.8.8' }), 2), null);
  assert.equal(
    visitorIp(request('127.0.0.1', '/', { 'x-forwarded-for': 'garbage, 8.8.8.8' }), 1),
    null,
  );
});
test('Private, reserved and mapped-local addresses never reach geolocation', () => {
  for (const ip of [
    '127.0.0.1',
    '10.0.0.1',
    '100.64.0.1',
    '169.254.0.1',
    '192.168.1.1',
    '198.18.0.1',
    '224.0.0.1',
    '::1',
    'fe80::1',
    'fc00::1',
    '2001:db8::1',
    '2::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    'not-an-ip',
  ])
    assert.equal(publicIp(ip), null, ip);
  assert.equal(publicIp('::ffff:8.8.8.8'), '8.8.8.8');
  assert.equal(publicIp('2606:4700:4700::1111'), '2606:4700:4700::1111');
});
test('Separate visitor locations and weather caches; response never includes visitor IP', async () => {
  let geocalls = 0,
    weathercalls = 0;
  const service = createWeatherService({
    env: {},
    fetcher: async (url) => {
      const u = new URL(url);
      if (u.hostname === 'ipwho.is') {
        geocalls++;
        const first = u.pathname.includes('8.8.8.8');
        return new Response(
          JSON.stringify({
            success: true,
            city: first ? 'Tokyo' : 'London',
            latitude: first ? 35.6 : 51.5,
            longitude: first ? 139.7 : -0.1,
            timezone: { id: first ? 'Asia/Tokyo' : 'Europe/London' },
          }),
        );
      }
      weathercalls++;
      return new Response(JSON.stringify(forecast(Number(u.searchParams.get('latitude')))));
    },
  });
  const a = await service.get(fallback, request('8.8.8.8')),
    b = await service.get(fallback, request('1.1.1.1'));
  assert.equal(a.location.name, 'Tokyo');
  assert.equal(b.location.name, 'London');
  assert.equal(a.location.source, 'ip');
  assert.notEqual(a.data.current.temperature_2m, b.data.current.temperature_2m);
  await service.get(fallback, request('8.8.8.8'));
  assert.equal(geocalls, 2);
  assert.equal(weathercalls, 2);
  assert.ok(!JSON.stringify(a).includes('8.8.8.8'));
});
test('Local IP, upstream errors and invalid geo coordinates fall back to configured city', async () => {
  for (const kind of ['local', 'error', 'invalid']) {
    let geoCalls = 0;
    const service = createWeatherService({
      fetcher: async (url) => {
        if (new URL(url).hostname === 'ipwho.is') {
          geoCalls++;
          if (kind === 'error') throw new Error('offline');
          return new Response(
            JSON.stringify({ success: true, city: 'bad', latitude: 999, longitude: 10 }),
          );
        }
        return new Response(JSON.stringify(forecast(14)));
      },
    });
    const result = await service.get(fallback, request(kind === 'local' ? '127.0.0.1' : '8.8.8.8'));
    assert.equal(result.location.name, '首尔');
    assert.equal(result.location.source, 'fallback');
    assert.equal(result.state, 'ready');
    if (kind === 'local') assert.equal(geoCalls, 0);
  }
});
test('Manual city takes priority, validates coordinates, and disabled weather stays disabled', async () => {
  const service = createWeatherService({
    fetcher: async (url) => {
      assert.equal(new URL(url).hostname, 'api.open-meteo.com');
      return new Response(JSON.stringify(forecast(20)));
    },
  });
  const result = await service.get(
    fallback,
    request('8.8.8.8', '/api/weather?city=上海&lat=31.23&lon=121.47&tz=Asia%2FShanghai'),
  );
  assert.equal(result.location.source, 'manual');
  assert.equal(result.location.name, '上海');
  await assert.rejects(
    service.get(fallback, request('8.8.8.8', '/api/weather?lat=999&lon=10&city=x')),
    (error) => error.status === 400,
  );
  await assert.rejects(
    service.get(fallback, request('8.8.8.8', '/api/weather?lat=&lon=10&city=x')),
    (error) => error.status === 400,
  );
  assert.deepEqual(await service.get(null, request('8.8.8.8')), { state: 'unconfigured' });
});
test('City search projects safe result fields and old configs keep fixed-city behavior', async () => {
  const service = createWeatherService({
    fetcher: async (url) => {
      assert.equal(new URL(url).searchParams.get('language'), 'zh');
      return new Response(
        JSON.stringify({
          results: [
            {
              name: '上海',
              latitude: 31.23,
              longitude: 121.47,
              timezone: 'Asia/Shanghai',
              country: '中国',
              secret: 'private',
            },
          ],
        }),
      );
    },
  });
  const data = await service.search('上海');
  assert.equal(data.results[0].name, '上海');
  assert.ok(!JSON.stringify(data).includes('private'));
  await assert.rejects(service.search('x'), (error) => error.status === 400);
  const config = JSON.parse(await readFile(new URL('../config.json', import.meta.url)));
  delete config.weather.mode;
  assert.equal(validateConfig(config).weather.mode, 'fixed');
  config.weather.mode = 'unknown';
  assert.throws(() => validateConfig(config), /模式/);
});
