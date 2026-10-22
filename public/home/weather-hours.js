function selectHour(module, point) {
  for (const button of module.node.querySelectorAll('[data-weather-hour]')) {
    button.setAttribute('aria-pressed', String(button === point));
  }
  const output = module.node.querySelector('[data-hour-detail-output]');
  if (output) output.textContent = point.dataset.hourDetail;
  module.node.dataset.selectedHour = point.dataset.weatherHour;
}

export function restoreWeatherHour(module, focusedKey) {
  const points = [...module.node.querySelectorAll('[data-weather-hour]')];
  const selected = points.find(
    (point) => point.dataset.weatherHour === module.node.dataset.selectedHour,
  );
  if (selected || points[0]) selectHour(module, selected || points[0]);
  if (focusedKey)
    (points.find((point) => point.dataset.weatherHour === focusedKey) || points[0])?.focus();
}

export function bindWeatherHours(module) {
  for (const eventName of ['pointerover', 'focusin', 'click']) {
    module.node.addEventListener(eventName, (event) => {
      const point = event.target.closest('[data-weather-hour]');
      if (point) selectHour(module, point);
    });
  }
  module.node.addEventListener('keydown', (event) => {
    const point = event.target.closest('[data-weather-hour]');
    if (!point || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const points = [...module.node.querySelectorAll('[data-weather-hour]')];
    const current = points.indexOf(point);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? points.length - 1
          : Math.max(
              0,
              Math.min(points.length - 1, current + (event.key === 'ArrowRight' ? 1 : -1)),
            );
    event.preventDefault();
    selectHour(module, points[next]);
    points[next].focus();
  });
}
