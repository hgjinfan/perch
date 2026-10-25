import { widgetPreviewPayload } from './admin/connections.js';
import { mountFieldInspector } from './admin/field-inspector.js';
import { duplicateWidget } from './admin/widget-copy.js';
import { parseJsonField } from './admin/json-fields.js';
import { validPath } from '../shared/widget-types.js';
import { validateFields } from './admin/validation.js';
import { mountPresetPicker } from './admin/preset-picker.js';
import { createFieldEditor } from './admin/fields.js';
import { editWidgetSource } from './admin/widget-source.js';
import { mountWidgetPreview } from './admin/widget-preview.js';

import { widgetDefinitions } from '../shared/widget-types.js';
import { node } from './core/dom.js';
const types = Object.fromEntries(
  Object.entries(widgetDefinitions).map(([key, definition]) => [key, definition.label]),
);
const examples = Object.fromEntries(
  Object.entries(widgetDefinitions).map(([key, definition]) => [key, definition.example]),
);
const mappings = Object.fromEntries(
  Object.entries(widgetDefinitions).map(([key, definition]) => [key, definition.mapping]),
);
export function setupWidgets(config, onModulesChanged) {
  config.widgets ||= [];
  const target = document.querySelector('#widgets-editor');
  const drafts = new Map();
  const openStates = new Map();
  const add = document.querySelector('#add-widget');
  mountPresetPicker(
    document.querySelector('#preset-picker'),
    (widget) => {
      if (config.widgets.length >= 20)
        throw new Error('自定义磁块最多 20 个，请先删除不需要的磁块');
      config.widgets.unshift(widget);
      draw();
      onModulesChanged();
    },
    config,
  );
  function draw() {
    for (const section of target.querySelectorAll('.widget-editor'))
      openStates.set(section.dataset.widgetId, section.open);
    for (const control of target.querySelectorAll('[data-draft-key]'))
      if (!control.validity.valid)
        drafts.set(control.dataset.draftKey, {
          value: control.value,
          message: control.validationMessage,
        });
    add.disabled = config.widgets.length >= 20;
    target.replaceChildren();
    for (const w of config.widgets) {
      const section = node('details');
      section.className = 'widget-editor';
      section.dataset.widgetId = w.id;
      section.open = openStates.get(w.id) ?? true;
      const summary = node('summary', w.title);
      section.append(summary);
      const controls = node('div');
      section.append(controls);
      const input = createFieldEditor(controls, {
        drafts,
        prefix: w.id + ':' + w.type + ':' + w.source.kind,
      });
      input(
        '磁块标题',
        w.title,
        (value) => {
          w.title = value;
          summary.textContent = value;
          onModulesChanged();
        },
        {
          required: true,
          maxLength: 80,
          validate: (value) => (value.trim() ? '' : '磁块标题不能为空'),
        },
      );
      input('图标名称', w.icon, (value) => (w.icon = value), {
        maxLength: 60,
        validate: (value) =>
          !value || /^[a-z0-9-]{1,60}$/.test(value) ? '' : '图标名只支持小写字母、数字和横线',
      });
      input('说明', w.description, (value) => (w.description = value), { maxLength: 200 });
      input(
        '展示模板',
        w.type,
        (value) => {
          w.type = value;
          w.scale = 1;
          w.mapping = { ...mappings[value] };
          if (w.source.kind === 'static') w.source.data = structuredClone(examples[value]);
          if (widgetDefinitions[value].controls.fields && !w.fields.length)
            w.fields = structuredClone(widgetDefinitions[value].fields);
          draw();
          onModulesChanged();
        },
        { options: types },
      );
      editWidgetSource(w, input, draw, config, controls);
      const heading = node('h3', '字段映射');
      controls.append(heading);
      const labels = {
        text: '文本字段',
        value: '数值字段',
        max: '总量字段',
        items: '列表路径',
        label: '条目标题字段',
        url: '条目链接字段',
        detail: '条目说明字段',
      };
      const mappingTargets = [];
      for (const key of Object.keys(mappings[w.type])) {
        const control = input(
          labels[key],
          w.mapping[key] ?? mappings[w.type][key],
          (value) => (w.mapping[key] = value),
          {
            validate: (value) =>
              validPath(value) ? '' : '路径须为 data.items 格式，不能包含表达式',
            hint:
              key === 'items'
                ? '例如 data.items；条目标题、链接、说明路径相对于每个条目。'
                : key === 'value' || key === 'text'
                  ? '例如 data.balance；空路径表示整个响应。'
                  : '',
          },
        );
        mappingTargets.push({ key, label: labels[key], control });
      }
      if (widgetDefinitions[w.type].controls.fields) {
        const fieldsControl = input(
          '指标映射',
          JSON.stringify(w.fields, null, 2),
          (value, control) => {
            try {
              w.fields = parseJsonField(value, 'fields');
            } catch (error) {
              control.setCustomValidity(error.message);
            }
          },
          {
            multiline: true,
            hint: '每项包含 label（名称）、path（字段路径）、unit（单位），可选 scale（数值倍率），最多 8 项。',
          },
        );
        w.fields.forEach((field, index) =>
          mappingTargets.push({
            key: `metric-${index}`,
            label: field.label,
            control: fieldsControl,
            set(path) {
              const fields = JSON.parse(fieldsControl.value);
              fields[index].path = path;
              fieldsControl.value = JSON.stringify(fields, null, 2);
            },
          }),
        );
      }
      if (mappingTargets.length)
        mountFieldInspector(controls, w, mappingTargets, () => ({
          widget: w,
          connections: config.connections || [],
        }));
      if (w.type === 'metric')
        input('数值倍率', w.scale ?? 1, (value) => (w.scale = Number(value)), {
          type: 'number',
          required: true,
          min: 0.000000000001,
          step: 'any',
          max: 1000000000000,
          hint: '原值 × 倍率。例如 0–1 比例转百分比填 100，字节转 GiB 填 0.0000000009313225746154785。',
        });
      if (widgetDefinitions[w.type].controls.decimals) {
        if (widgetDefinitions[w.type].controls.unit)
          input('单位', w.unit, (value) => (w.unit = value), { maxLength: 20 });
        input('最多小数位', w.decimals, (value) => (w.decimals = Number(value)), {
          type: 'number',
          required: true,
          min: 0,
          max: 6,
        });
      }
      if (widgetDefinitions[w.type].controls.limit)
        input(
          '显示条数',
          w.limit,
          (value) => {
            w.limit = Number(value);
            onModulesChanged();
          },
          {
            type: 'number',
            required: true,
            min: 1,
            max: 20,
          },
        );
      if (widgetDefinitions[w.type].controls.threshold)
        input(
          '告警阈值（%）',
          w.threshold ?? '',
          (value) => (w.threshold = value === '' ? null : Number(value)),
          { type: 'number', min: 0, max: 100, hint: '留空不告警；达到阈值时显示提示。' },
        );
      input('刷新间隔（秒）', w.refresh, (value) => (w.refresh = Number(value)), {
        type: 'number',
        required: true,
        min: 30,
        max: 86400,
      });
      const copy = node('button', '复制磁块');
      copy.type = 'button';
      copy.disabled = config.widgets.length >= 20;
      copy.onclick = () => {
        if (config.widgets.length >= 20 || !validateFields(controls)) return;
        const clone = duplicateWidget(config, w);
        openStates.set(clone.id, true);
        draw();
        onModulesChanged();
      };
      controls.append(copy);
      mountWidgetPreview(
        controls,
        w,
        () => {
          config.widgets = config.widgets.filter((item) => item.id !== w.id);
          config.layout.hidden = config.layout.hidden.filter((id) => id !== `widget-${w.id}`);
          draw();
          onModulesChanged();
        },
        () => widgetPreviewPayload(w, config),
      );
      target.append(section);
    }
    if (!config.widgets.length) {
      const empty = node('p', '还没有自定义磁块。添加后可以选择展示模板和数据来源。');
      empty.className = 'muted';
      target.append(empty);
    }
  }
  add.onclick = () => {
    config.widgets.push({
      id: `custom-${crypto.randomUUID().slice(0, 8)}`,
      title: '自定义磁块',
      icon: 'box',
      description: '',
      type: 'metric',
      source: { kind: 'static', data: { value: 42 } },
      mapping: { value: 'value' },
      fields: [],
      refresh: 300,
      unit: '',
      limit: 5,
      decimals: 1,
      threshold: null,
    });
    draw();
    onModulesChanged();
  };
  draw();
  return draw;
}
