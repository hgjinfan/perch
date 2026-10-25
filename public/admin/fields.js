import { safeUrl } from '../../shared/url.js';
import { attachFieldValidation } from './validation.js';
import { node } from '../core/dom.js';
let helpSequence = 0;
export function createFieldEditor(controls, { drafts, prefix = '' } = {}) {
  return function input(
    label,
    value,
    change,
    {
      type = 'text',
      hint = '',
      options = null,
      multiline = false,
      min,
      max,
      step,
      required = false,
      maxLength,
      validate,
      draftId,
    } = {},
  ) {
    const wrap = node('label'),
      caption = node('span', label);
    wrap.append(caption);
    const control = node(options ? 'select' : multiline ? 'textarea' : 'input');
    if (options)
      for (const [key, name] of Object.entries(options)) {
        const option = node('option', name);
        option.value = key;
        control.append(option);
      }
    else if (!multiline) control.type = type;
    control.required = required;
    if (maxLength !== undefined) control.maxLength = maxLength;
    control.value = value ?? '';
    if (min !== undefined) control.min = min;
    if (max !== undefined) control.max = max;
    if (step !== undefined) control.step = step;
    const draftKey = prefix + ':' + (draftId || label);
    if (drafts?.has(draftKey)) {
      const draft = drafts.get(draftKey);
      control.value = draft.value;
      control.setCustomValidity(draft.message);
    }
    control.dataset.draftKey = draftKey;
    const event = options ? 'change' : 'input';
    control.addEventListener(event, () => {
      control.setCustomValidity('');
      change(control.value, control);
      if (drafts) {
        if (control.validity.valid) drafts.delete(draftKey);
        else drafts.set(draftKey, { value: control.value, message: control.validationMessage });
      }
    });
    wrap.append(control);
    controls.append(wrap);
    const check = attachFieldValidation(
      control,
      validate ||
        (type === 'url'
          ? (value) => (value && !safeUrl(value) ? '仅支持 HTTP(S) 地址，不能包含账号密码' : '')
          : undefined),
    );
    control.addEventListener('admin:validate', check);
    if (hint) {
      const help = node('p', hint);
      help.className = 'field-help';
      help.id = `field-help-${++helpSequence}`;
      control.setAttribute(
        'aria-describedby',
        [control.getAttribute('aria-describedby'), help.id].filter(Boolean).join(' '),
      );
      controls.append(help);
    }
    return control;
  };
}
