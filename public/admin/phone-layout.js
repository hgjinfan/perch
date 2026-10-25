import { createFieldEditor } from './fields.js';
import { layoutEntries } from '../../shared/layout.js';
import { phoneOrder, phoneItemLimit } from '../../shared/phone-layout.js';
import { node } from '../core/dom.js';
const sessions = new WeakMap();
export function mountPhoneEditor(target, config) {
  let state = sessions.get(target);
  if (!state || state.config !== config) {
    state = { config, drafts: new Map() };
    sessions.set(target, state);
  }
  for (const control of target.querySelectorAll('[data-draft-key]'))
    if (!control.validity.valid)
      state.drafts.set(control.dataset.draftKey, {
        value: control.value,
        message: control.validationMessage,
      });
  const settings = (config.layout.phone ||= { enabled: false, order: [], hidden: [], limits: {} });
  const names = new Map(layoutEntries(config).map((item) => [item.id, item.title]));
  target.replaceChildren();
  const label = node('label', '启用手机独立展示'),
    enable = node('input');
  enable.type = 'checkbox';
  enable.checked = settings.enabled;
  label.append(enable);
  target.append(label);
  enable.onchange = () => {
    settings.enabled = enable.checked;
    mountPhoneEditor(target, config);
  };
  target.append(
    node(
      'p',
      settings.enabled
        ? '520px 及以下按此顺序单列展示，不保留桌面分组标题。全局隐藏优先；列表条数只能减少。'
        : '当前继承桌面顺序、显隐和条数。',
    ),
  );
  if (!settings.enabled) return;
  const order = phoneOrder(config);
  order.forEach((id, index) => {
    const row = node('div');
    row.className = 'phone-item';
    const title = node('strong', names.get(id));
    row.append(title);
    const globallyHidden = config.layout.hidden.includes(id);
    const visibleLabel = node('label', globallyHidden ? '全局已隐藏' : '手机显示'),
      visible = node('input');
    visible.type = 'checkbox';
    visible.checked = !globallyHidden && !settings.hidden.includes(id);
    visible.disabled = globallyHidden;
    visible.onchange = () => {
      settings.hidden = visible.checked
        ? settings.hidden.filter((item) => item !== id)
        : [...settings.hidden, id];
    };
    visibleLabel.append(visible);
    row.append(visibleLabel);
    for (const [offset, caption] of [
      [-1, '上移'],
      [1, '下移'],
    ]) {
      const button = node('button', caption);
      button.type = 'button';
      button.disabled = index + offset < 0 || index + offset >= order.length;
      button.setAttribute('aria-label', `${caption}手机磁块 ${names.get(id)}`);
      button.onclick = () => {
        [order[index], order[index + offset]] = [order[index + offset], order[index]];
        settings.order = order;
        mountPhoneEditor(target, config);
      };
      row.append(button);
    }
    const max = phoneItemLimit(config, id);
    if (max) {
      const input = createFieldEditor(row, { drafts: state.drafts, prefix: 'phone:' + id })(
        `${names.get(id)}手机条数`,
        settings.limits[id] ?? '',
        (value, control) => {
          if (value === '') delete settings.limits[id];
          else if (control.checkValidity()) settings.limits[id] = Number(value);
        },
        {
          type: 'number',
          draftId: 'limit',
          min: 1,
          max,
          step: 1,
          hint: `留空继承桌面（${max}），只能减少显示数量。`,
        },
      );
      input.placeholder = `继承（${max}）`;
    }
    target.append(row);
  });
  const reset = node('button', '恢复继承桌面');
  reset.type = 'button';
  reset.onclick = () => {
    state.drafts.clear();
    target.replaceChildren();
    config.layout.phone = { enabled: false, order: [], hidden: [], limits: {} };
    mountPhoneEditor(target, config);
  };
  target.append(reset);
}
