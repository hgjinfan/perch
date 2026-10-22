import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { createWeatherService } from '../src/services/weather.js';
import { renderHourly } from '../src/render/weather.js';
import { bindWeatherHours, restoreWeatherHour } from '../public/home/weather-hours.js';

const times = Array.from({ length: 36 }, (_, i) =>
  new Date(Date.UTC(2026, 9, 21, i)).toISOString().slice(0, 16),
);
const hours = times
  .slice(23, 35)
  .map((time, i) => ({ time, temperature: -5 + i, code: i % 2 ? 3 : 0, rain: i * 5, isDay: 0 }));

test('Weather returns all 12 upcoming hourly points across midnight, with conditions and rain probability', async () => {
  const service = createWeatherService({
    fetcher: async (url) => {
      const query = new URL(url).searchParams;
      assert.ok(query.get('hourly').includes('precipitation_probability'));
      return new Response(
        JSON.stringify({
          current: { time: '2026-10-21T22:30', temperature_2m: 5, apparent_temperature: 5 },
          hourly: {
            time: times,
            temperature_2m: times.map((_, i) => i),
            weather_code: times.map(() => 3),
            precipitation_probability: times.map(() => 25),
            is_day: times.map(() => 0),
          },
        }),
      );
    },
  });
  const result = await service.get(
    { mode: 'fixed', name: '首尔', latitude: 37.5, longitude: 127, timezone: 'Asia/Seoul' },
    { url: '/fragments/weather', headers: {}, socket: { remoteAddress: '127.0.0.1' } },
  );
  assert.equal(result.data.hours.length, 12);
  assert.equal(result.data.hours[0].time, '2026-10-21T23:00');
  assert.equal(result.data.hours[11].time, '2026-10-22T10:00');
  assert.ok(
    result.data.hours.every((hour) => hour.code === 3 && hour.rain === 25 && hour.isDay === 0),
  );
});

test('Hourly chart renders accessible negative temperatures, tomorrow labels and finite flat-temperature bars', () => {
  const { document } = parseHTML(renderHourly(hours, '2026-10-21T22:30'));
  const points = document.querySelectorAll('[data-weather-hour]');
  assert.equal(points.length, 12);
  assert.equal(points[0].getAttribute('aria-pressed'), 'true');
  assert.equal(document.querySelectorAll('[aria-pressed="true"]').length, 1);
  assert.ok(points[0].getAttribute('aria-label').includes('-5°'));
  assert.ok(points[1].dataset.hourDetail.includes('明日 00:00'));
  assert.ok(points[1].dataset.hourDetail.includes('降水 5%'));
  const flat = renderHourly(
    hours.map((hour) => ({ ...hour, temperature: 0 })),
    '2026-10-21T22:30',
  );
  assert.ok(!flat.includes('NaN'));
  assert.ok(!flat.includes('Infinity'));
  assert.ok(renderHourly([], '2026-10-21T22:30').includes('小时预报暂不可用'));
});

test('Click, focus and keyboard navigation select hourly details; fragment replacement keeps selected hour', (t) => {
  const { document, window } = parseHTML(
    `<section>${renderHourly(hours, '2026-10-21T22:30')}</section>`,
  );
  const module = { node: document.querySelector('section') };
  bindWeatherHours(module);
  const points = [...module.node.querySelectorAll('[data-weather-hour]')];
  points[3].click();
  assert.equal(points[3].getAttribute('aria-pressed'), 'true');
  assert.equal(
    module.node.querySelector('[data-hour-detail-output]').textContent,
    points[3].dataset.hourDetail,
  );
  const right = new window.Event('keydown', { bubbles: true, cancelable: true });
  Object.defineProperty(right, 'key', { value: 'ArrowRight' });
  points[3].dispatchEvent(right);
  assert.equal(points[4].getAttribute('aria-pressed'), 'true');
  module.node.innerHTML = renderHourly(
    hours.map((hour) => ({ ...hour, temperature: 20 })),
    '2026-10-21T22:30',
  );
  restoreWeatherHour(module);
  assert.equal(
    module.node.querySelector('[aria-pressed="true"]').dataset.weatherHour,
    points[4].dataset.weatherHour,
  );
  assert.ok(module.node.querySelector('[data-hour-detail-output]').textContent.includes('20°'));
  module.node
    .querySelectorAll('[data-weather-hour]')[6]
    .dispatchEvent(new window.Event('focusin', { bubbles: true }));
  assert.equal(
    module.node.querySelector('[aria-pressed="true"]').dataset.weatherHour,
    hours[6].time,
  );
});
