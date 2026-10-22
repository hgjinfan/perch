import { text, icon } from './html.js';

export function weatherCondition(code, isDay = 1) {
  if (code === 0) return ['晴', isDay === 0 ? 'moon' : 'sun'];
  if (code <= 3 && code !== null) return ['多云', isDay === 0 ? 'cloud-moon' : 'cloud-sun'];
  if (code <= 48 && code !== null) return ['雾', 'cloud-fog'];
  if (code <= 67 && code !== null) return ['雨', 'cloud-rain'];
  if (code <= 77 && code !== null) return ['雪', 'cloud-snow'];
  if (code <= 82 && code !== null) return ['阵雨', 'cloud-rain'];
  if (code <= 86 && code !== null) return ['阵雪', 'cloud-snow'];
  if (Number.isFinite(code)) return ['雷雨', 'cloud-lightning'];
  return ['天气预报', 'cloud'];
}

function hourDetail(hour, currentDate) {
  const nextDay = hour.time.slice(0, 10) > currentDate;
  const label = `${nextDay ? '明日 ' : ''}${hour.time.slice(11, 16)}`;
  const [condition] = weatherCondition(hour.code, hour.isDay);
  const rain = Number.isFinite(hour.rain) ? ` · 降水 ${Math.round(hour.rain)}%` : '';
  return `${label} · ${Math.round(hour.temperature)}° · ${condition}${rain}`;
}

export function renderHourly(hours, currentTime) {
  const valid = hours.filter((hour) => Number.isFinite(hour.temperature));
  if (!valid.length) return '<div class="state-label">小时预报暂不可用</div>';
  const temperatures = valid.map((hour) => hour.temperature);
  const min = Math.min(...temperatures),
    max = Math.max(...temperatures);
  const currentDate = String(currentTime || '').slice(0, 10);
  const points = valid
    .map((hour, index) => {
      const height = max === min ? 28 : 12 + ((hour.temperature - min) / (max - min)) * 32;
      const detail = hourDetail(hour, currentDate);
      const tick = index % 3 === 0 || index === valid.length - 1;
      return `<button type="button" class="hourly-point${tick ? ' hourly-tick' : ''}" aria-pressed="${index === 0}" aria-label="${text(detail)}" data-weather-hour="${text(hour.time)}" data-hour-detail="${text(detail)}"><span class="hourly-temp">${text(Math.round(hour.temperature))}°</span><svg viewBox="0 0 12 48" aria-hidden="true"><rect x="3" y="${(48 - height).toFixed(2)}" width="6" height="${height.toFixed(2)}" rx="3" fill="currentColor"></rect></svg><span class="hourly-time">${text(hour.time.slice(11, 13))}</span></button>`;
    })
    .join('');
  return `<section class="hourly-forecast" aria-label="未来12小时预报"><div class="hourly-heading"><span>未来 12 小时</span><span>${text(Math.round(min))}° — ${text(Math.round(max))}°</span></div><div class="hourly-scroll"><div class="hourly-chart">${points}</div></div><p class="hourly-detail" data-hour-detail-output aria-live="polite">${text(hourDetail(valid[0], currentDate))}</p></section>`;
}

export function renderWeather(result) {
  const { current, hours } = result.data;
  const [label, glyph] = weatherCondition(current.weather_code, current.is_day);
  const source =
    { ip: 'IP 定位', manual: '手动选择', fixed: '固定城市', fallback: '默认城市' }[
      result.location?.source
    ] || '';
  return `<div class="weather-main"><div><div class="temperature">${text(Math.round(current.temperature_2m))}°</div><span class="muted">${label} · 体感 ${text(Math.round(current.apparent_temperature))}°</span></div>${icon(glyph)}</div>${renderHourly(hours, current.time)}${result.location ? `<div class="state-label" title="${text(result.location.reason || '')}">${text(result.location.name)} · ${source}</div>` : ''}`;
}
