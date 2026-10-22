const bar = (size = 'long') => `<span class="skeleton-bar skeleton-${size}"></span>`;
export function skeleton(kind, count = 3) {
  const rows = Math.max(1, Math.min(20, Number(count) || 3));
  let body;
  if (kind === 'weather')
    body = `<div class="skeleton-weather-main">${bar('temperature')}${bar('weather-icon')}</div>${bar('medium')}<div class="skeleton-hours">${Array.from({ length: 12 }, () => `<div>${bar('short')}${bar('short')}</div>`).join('')}</div>${bar('medium')}`;
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
