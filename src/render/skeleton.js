const bar = (size = 'long') => `<span class="skeleton-bar skeleton-${size}"></span>`;
export function skeleton(kind, count = 3) {
  const rows = Math.max(1, Math.min(20, Number(count) || 3));
  let body;
  if (kind === 'weather')
    body = `<div class="weather-main"><div><div class="temperature skeleton-weather-temperature">${bar('temperature')}</div><span class="muted skeleton-line">&nbsp;</span></div>${bar('weather-icon')}</div><section class="hourly-forecast"><div class="hourly-heading"><span class="skeleton-line">&nbsp;</span><span class="skeleton-line">&nbsp;</span></div><div class="hourly-scroll"><div class="hourly-chart skeleton-weather-hours">${Array.from({ length: 12 }, () => '<div class="hourly-point"><span class="hourly-temp">&nbsp;</span><svg viewBox="0 0 12 48" aria-hidden="true"><rect x="3" y="8" width="6" height="40" rx="3" fill="currentColor"></rect></svg><span class="hourly-time">&nbsp;</span></div>').join('')}</div></div><p class="hourly-detail skeleton-line">&nbsp;</p></section><div class="state-label skeleton-line">&nbsp;</div><div class="state-label freshness skeleton-line">&nbsp;</div>`;
  else if (kind === 'metric') body = bar('number');
  else if (kind === 'metrics')
    body = Array.from({ length: rows }, () => `<div>${bar('medium')}${bar('number')}</div>`).join(
      '',
    );
  else if (kind === 'progress') body = bar('medium') + bar('track');
  else if (kind === 'links') body = Array.from({ length: rows }, () => bar('chip')).join('');
  else if (kind === 'text') body = bar() + bar('medium') + bar();
  else
    body = Array.from(
      { length: rows },
      (_, i) =>
        `<div class="skeleton-row${kind === 'status' ? ' skeleton-status-row' : ''}">${bar(i % 2 ? 'medium' : 'long')}${kind !== 'status' ? bar('medium') : ''}</div>`,
    ).join('');
  return `<div class="skeleton skeleton-${kind}${kind === 'metrics' ? ' widget-metrics' : kind === 'links' ? ' skeleton-chips' : ''}" aria-hidden="true">${body}</div>`;
}
