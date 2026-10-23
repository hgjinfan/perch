const appPath = (path) => `${document.documentElement.dataset.basePath || ''}${path}`;
const form = document.querySelector('#setup-form');
const weather = document.querySelector('[name="weather-enabled"]');
const fields = document.querySelector('#weather-fields');
const message = document.querySelector('#message');
weather.onchange = () => {
  fields.hidden = !weather.checked;
};
form.onsubmit = async (event) => {
  event.preventDefault();
  message.textContent = '正在保存…';
  const value = (name) => form.elements.namedItem(name).value.trim();
  const body = {
    title: value('title'),
    timezone: value('timezone'),
    weather: weather.checked
      ? {
          mode: 'fixed',
          name: value('city'),
          latitude: Number(value('latitude')),
          longitude: Number(value('longitude')),
          timezone: value('weather-timezone'),
        }
      : null,
  };
  try {
    const response = await fetch(appPath('/api/setup'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '保存失败');
    message.textContent = '设置完成，正在打开首页…';
    location.href = appPath('/');
  } catch (error) {
    message.textContent = error.message;
  }
};
