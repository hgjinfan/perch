import { mountDiagnostics } from './admin/diagnostics.js';
import { notifyConfigChange } from './core/config-events.js';
import { createEditSession } from './admin/edit-session.js';
import { attachFieldValidation, validateFields, validateTimeZone } from './admin/validation.js';
import { safeUrl } from '../shared/url.js';
import { mountBackups } from './admin/backups.js';
import { mountLayoutEditor } from './admin/layout-editor.js';
import { setupWidgets } from './widget-editor.js';
import { node } from './core/dom.js';
import { requestJson } from './core/api.js';
const form = document.querySelector('#admin-form');
const message = document.querySelector('#admin-message');
let config,
  configVersion,
  session,
  savedConfig,
  saving = false,
  diagnosticsPanel;
const field = (name) => form.elements.namedItem(name);
function moduleOptions() {
  const target = document.querySelector('#module-options');
  mountLayoutEditor(document.querySelector('#layout-editor'), config);
  target.replaceChildren();
  const entries = [['status', '服务入口状态']];
  for (const [id, name] of entries) {
    const label = node('label', name);
    const input = node('input');
    input.type = 'checkbox';
    input.checked = !config.layout.hidden.includes(id);
    input.onchange = () => {
      config.layout.hidden = input.checked
        ? config.layout.hidden.filter((k) => k !== id)
        : [...config.layout.hidden, id];
    };
    label.append(input);
    target.append(label);
  }
}
const fields = {
  services: [
    ['name', '名称'],
    ['url', '访问地址'],
    ['healthUrl', '健康检查地址（可选）'],
    ['icon', '图标名称'],
  ],
  feeds: [
    ['name', '名称'],
    ['url', '订阅地址'],
    ['site', '源站地址'],
    ['limit', '显示条数'],
  ],
  bookmarks: [
    ['name', '名称'],
    ['url', '网址'],
  ],
  projects: [
    ['name', '名称'],
    ['url', '网址'],
  ],
};
function editor(key) {
  const target = document.querySelector(`#${key}-editor`);
  target.replaceChildren();
  config[key].forEach((item, index) => {
    const row = node('div');
    row.className = 'editor-row';
    for (const [property, title] of fields[key]) {
      const label = node('label', title),
        input = node('input');
      input.value = item[property] ?? '';
      input.type =
        property === 'limit'
          ? 'number'
          : ['url', 'site', 'healthUrl'].includes(property)
            ? 'url'
            : 'text';
      if (property === 'limit') {
        input.min = 1;
        input.max = 20;
        input.required = true;
      }
      if (property === 'name') {
        input.required = true;
        input.maxLength = 80;
      }
      input.oninput = () => {
        item[property] = property === 'limit' ? Number(input.value) : input.value;
        if (key === 'feeds' && property === 'name') moduleOptions();
      };
      label.append(input);
      row.append(label);
      const check = attachFieldValidation(input, (value) =>
        ['url', 'site', 'healthUrl'].includes(property) && value && !safeUrl(value)
          ? '网址只支持 HTTP(S)，不能包含账号密码'
          : property === 'name' && !value.trim()
            ? '名称不能为空'
            : '',
      );
      input.addEventListener('admin:validate', check);
    }
    const remove = node('button', '移除');
    remove.type = 'button';
    remove.className = 'remove';
    remove.onclick = () => {
      config[key].splice(index, 1);
      if (key === 'feeds')
        config.layout.hidden = config.layout.hidden.filter((id) => id !== `feed-${item.id}`);
      editor(key);
      moduleOptions();
    };
    for (const [offset, caption] of [
      [-1, '上移'],
      [1, '下移'],
    ]) {
      const move = node('button', caption);
      move.type = 'button';
      move.disabled = !config[key][index + offset];
      move.onclick = () => {
        [config[key][index], config[key][index + offset]] = [
          config[key][index + offset],
          config[key][index],
        ];
        editor(key);
        moduleOptions();
      };
      row.append(move);
    }
    row.append(remove);
    target.append(row);
  });
}
for (const button of document.querySelectorAll('[data-add]'))
  button.onclick = () => {
    const key = button.dataset.add,
      id = `item-${crypto.randomUUID().slice(0, 8)}`;
    config[key].push(
      key === 'services'
        ? { id, name: '新服务', url: '', icon: 'box' }
        : key === 'feeds'
          ? { id, name: '新订阅', url: '', site: '', icon: 'rss', limit: 5 }
          : { name: '新链接', url: '' },
    );
    editor(key);
    moduleOptions();
  };
field('weather-enabled').onchange = () => {
  const enabled = field('weather-enabled').checked;
  document.querySelector('#weather-fields').hidden = !enabled;
  for (const control of document.querySelectorAll('#weather-fields input,#weather-fields select'))
    control.disabled = !enabled;
};
function captureConfig() {
  return {
    ...config,
    title: field('title').value,
    timezone: field('timezone').value,
    layout: { ...config.layout, density: field('density').value },
    weather: field('weather-enabled').checked
      ? {
          mode: field('weather-mode').value,
          name: field('city').value,
          latitude: Number(field('latitude').value),
          longitude: Number(field('longitude').value),
          timezone: field('weather-timezone').value,
        }
      : null,
  };
}
function renderEditor(value) {
  config = value;
  field('title').value = config.title;
  field('timezone').value = config.timezone;
  field('density').value = config.layout.density;
  field('weather-enabled').checked = Boolean(config.weather);
  field('weather-mode').value = config.weather?.mode || 'fixed';
  field('city').value = config.weather?.name || '';
  field('latitude').value = config.weather?.latitude ?? '';
  field('longitude').value = config.weather?.longitude ?? '';
  field('weather-timezone').value = config.weather?.timezone || 'Asia/Shanghai';
  field('weather-enabled').onchange();
  document.querySelector('#title-options').replaceChildren();
  for (const [key, labelText] of [
    ['weather', '天气'],
    ['bookmarks', '常用书签'],
    ['projects', '关注项目'],
  ]) {
    const label = node('label', labelText),
      input = node('input');
    input.value =
      config.titles[key] || (key === 'weather' ? config.weather?.name || '天气' : labelText);
    input.maxLength = 80;
    input.required = true;
    input.oninput = () => {
      config.titles[key] = input.value;
      moduleOptions();
    };
    label.append(input);
    document.querySelector('#title-options').append(label);
    const check = attachFieldValidation(input, (value) => (value.trim() ? '' : '磁块标题不能为空'));
    input.addEventListener('admin:validate', check);
  }
  Object.keys(fields).forEach(editor);
  moduleOptions();
  setupWidgets(config, moduleOptions);
}
for (const [name, validate] of [
  ['title', (v) => (v.trim() ? '' : '首页名称不能为空')],
  ['timezone', validateTimeZone],
  ['weather-timezone', validateTimeZone],
]) {
  const check = attachFieldValidation(field(name), validate);
  field(name).addEventListener('admin:validate', check);
}
for (const name of ['city', 'latitude', 'longitude']) {
  field(name).required = true;
  const check = attachFieldValidation(field(name));
  field(name).addEventListener('admin:validate', check);
}
form.onsubmit = async (event) => {
  event.preventDefault();
  if (saving) return;
  if (!validateFields(form)) {
    message.textContent = '请修正标出的字段后再保存。';
    message.className = 'error';
    return;
  }
  if (!session.dirty) return;
  const snapshot = structuredClone(captureConfig());
  saving = true;
  document.querySelector('#editor-fields').disabled = true;
  session.setBusy(true);
  try {
    const result = await requestJson('/api/admin/config', {
      method: 'PUT',
      body: snapshot,
      headers: { 'If-Match': configVersion },
      onResponse: (r) => (configVersion = r.headers.get('etag')),
    });
    notifyConfigChange();
    diagnosticsPanel?.refresh();
    renderEditor(result);
    savedConfig = structuredClone(result);
    session.saved();
    document.querySelector('#config-conflict').hidden = true;
    message.className = '';
    message.textContent = '已保存，公开首页刷新后即可看到更新。';
  } catch (error) {
    message.className = 'error';
    message.textContent = error.message;
    document.querySelector('#config-conflict').hidden = error.status !== 409;
  } finally {
    saving = false;
    document.querySelector('#editor-fields').disabled = false;
    session.setBusy(false);
  }
};
document.querySelector('#discard').onclick = () => {
  document.querySelector('#discard-confirm').hidden = false;
};
document.querySelector('#discard-no').onclick = () => {
  document.querySelector('#discard-confirm').hidden = true;
};
document.querySelector('#discard-yes').onclick = () => {
  if (saving) return;
  renderEditor(structuredClone(savedConfig));
  for (const control of form.querySelectorAll('[aria-invalid]')) {
    control.setCustomValidity('');
    control.removeAttribute('aria-invalid');
  }
  for (const error of form.querySelectorAll('.field-error')) error.hidden = true;
  session.saved();
  document.querySelector('#discard-confirm').hidden = true;
  message.className = '';
  message.textContent = '已放弃本页未保存的修改。';
};
(async () => {
  try {
    const result = await requestJson('/api/admin/config', {
      onResponse: (r) => (configVersion = r.headers.get('etag')),
    });
    renderEditor(result);
    savedConfig = structuredClone(result);
    session = createEditSession({
      form,
      capture: captureConfig,
      onState: ({ dirty, busy }) => {
        document.querySelector('#edit-state').textContent = busy
          ? '正在保存…'
          : dirty
            ? '有未保存的修改'
            : '所有修改已保存';
        document.querySelector('#save').disabled = busy || !dirty;
        document.querySelector('#discard').disabled = busy || !dirty;
        document.querySelector('#discard-yes').disabled = busy;
        document.querySelector('#discard-no').disabled = busy;
      },
    });
    session.saved();
    mountBackups(document.querySelector('#backup-settings'), {
      onRestored: () => session.allowLeave(),
    });
    const panel = document.querySelector('#diagnostics-panel');
    diagnosticsPanel = mountDiagnostics(panel);
    panel.hidden = false;
    form.hidden = false;
    message.textContent = '仅管理员可访问和修改此页面。';
  } catch (error) {
    message.className = 'error';
    message.textContent = error.message;
  }
})();
