import { requestHtml } from '../core/api.js';
const storageKey = 'kyrie-weather-city';
function savedCity() {
  try {
    return JSON.parse(localStorage.getItem(storageKey));
  } catch {
    return null;
  }
}
function persist(city) {
  try {
    city
      ? localStorage.setItem(storageKey, JSON.stringify(city))
      : localStorage.removeItem(storageKey);
  } catch {}
}
export function weatherFragmentUrl(base) {
  const city = savedCity();
  if (!city) return base;
  const params = new URLSearchParams({
    lat: city.latitude,
    lon: city.longitude,
    city: city.name,
    tz: city.timezone || 'auto',
  });
  return `${base}?${params}`;
}
export function bindWeatherPicker(module, load) {
  const picker = module.node.querySelector('.city-picker');
  if (!picker) return;
  const form = picker.querySelector('form'),
    input = form.querySelector('input'),
    search = form.querySelector('button'),
    results = picker.querySelector('.city-results');
  picker.querySelector('.city-auto').onclick = () => {
    persist(null);
    picker.open = false;
    load();
  };
  form.onsubmit = async (event) => {
    event.preventDefault();
    search.disabled = true;
    results.textContent = '正在查找…';
    try {
      results.innerHTML = await requestHtml(
        `${module.node.dataset.fragment}/cities?q=${encodeURIComponent(input.value.trim())}`,
      );
    } catch {
      results.textContent = '搜索暂不可用，请稍后重试。';
    } finally {
      search.disabled = false;
    }
  };
  results.addEventListener('click', (event) => {
    const option = event.target.closest('.city-option');
    if (!option) return;
    persist({
      name: option.dataset.cityName,
      latitude: Number(option.dataset.latitude),
      longitude: Number(option.dataset.longitude),
      timezone: option.dataset.timezone,
    });
    picker.open = false;
    load();
  });
}
