import { node } from '../core/dom.js';
import { catalogPresets, buildPreset } from './preset-definitions.js';
import { createFieldEditor } from './fields.js';
export function mountPresetPicker(target, add) {
  target.replaceChildren();
  const picker = node('details');
  picker.className = 'preset-picker';
  picker.append(node('summary', '从常用数据源添加'));
  const label = node('label', '服务'),
    select = node('select');
  const placeholder = node('option', '选择一个数据源…');
  placeholder.value = '';
  select.append(placeholder);
  const categories = new Map();
  for (const [key, preset] of Object.entries(catalogPresets)) {
    const category = preset.category || '项目与服务';
    if (!categories.has(category)) {
      const group = node('optgroup');
      group.label = category;
      categories.set(category, group);
      select.append(group);
    }
    const option = node('option', preset.label);
    option.value = key;
    categories.get(category).append(option);
  }
  label.append(select);
  picker.append(label);
  const controls = node('div'),
    status = node('p');
  status.className = 'field-help';
  status.setAttribute('role', 'status');
  picker.append(controls, status);
  target.append(picker);
  select.onchange = () => {
    controls.replaceChildren();
    status.textContent = '';
    const preset = catalogPresets[select.value];
    if (!preset) return;
    const values = {
      title: preset.label,
      env: preset.env,
      auth: preset.optionalAuth ? 'none' : 'env',
    };
    const note = node('p', preset.note);
    note.className = 'field-help';
    controls.append(note);
    const docs = node('a', '查看接口说明 ↗');
    docs.href = preset.docs;
    docs.target = '_blank';
    docs.rel = 'noopener noreferrer';
    controls.append(docs);
    const input = createFieldEditor(controls);
    input('磁块标题', values.title, (v) => (values.title = v));
    for (const f of preset.fields) {
      const control = input(f.label, f.default || '', (v) => (values[f.key] = v), {
        required: f.required !== false,
        type: f.type || 'text',
        maxLength: f.maxLength,
      });
      control.placeholder = f.placeholder;
      if (f.default) values[f.key] = f.default;
    }
    let envLabel;
    if (preset.optionalAuth)
      input(
        '认证方式',
        'none',
        (v) => {
          values.auth = v;
          envLabel.hidden = v !== 'env';
        },
        { options: { none: '无需认证（公开数据）', env: '服务器环境变量 Token' } },
      );
    if (preset.env) {
      const control = input('密钥环境变量名', values.env, (v) => (values.env = v), {
        hint: '填写变量名，不是 Token 本身。在服务器 .env 设置后重启；Docker 还需显式传入该变量。',
      });
      envLabel = control.closest('label');
      envLabel.hidden = preset.optionalAuth;
    }
    const create = node('button', '添加为新磁块');
    create.type = 'button';
    create.onclick = () => {
      try {
        const widget = buildPreset(
          select.value,
          values,
          `preset-${crypto.randomUUID().slice(0, 8)}`,
        );
        add(widget);
        status.textContent = '已添加，下面可测试预览和继续编辑；保存后才会在首页生效。';
      } catch (error) {
        status.textContent = error.message;
      }
    };
    controls.append(create);
  };
}
