let sequence = 0;
export function fieldError(control) {
  if (control.validity?.valid) return '';
  if (control.validity?.customError) return control.validationMessage;
  if (control.validity?.valueMissing) return '请填写此项';
  if (control.validity?.typeMismatch) return '请填写有效的网址';
  if (control.validity?.rangeUnderflow || control.validity?.rangeOverflow)
    return `数值须在 ${control.min || '允许的最小值'}–${control.max || '允许的最大值'} 之间`;
  if (control.validity?.stepMismatch) return '请填写符合要求的数值';
  return control.validationMessage || '请检查此项';
}
export function attachFieldValidation(control, validate) {
  const error = document.createElement('span');
  error.className = 'field-error';
  error.id = `field-error-${++sequence}`;
  error.hidden = true;
  error.setAttribute('aria-hidden', 'true');
  control.setAttribute(
    'aria-describedby',
    [control.getAttribute('aria-describedby'), error.id].filter(Boolean).join(' '),
  );
  control.after(error);
  function show() {
    const message = fieldError(control);
    error.textContent = message;
    error.hidden = !message;
    if (message) control.setAttribute('aria-invalid', 'true');
    else control.removeAttribute('aria-invalid');
  }
  control.addEventListener('invalid', (event) => {
    event.preventDefault();
    show();
  });
  for (const event of ['input', 'change'])
    control.addEventListener(event, () => {
      if (validate) control.setCustomValidity(validate(control.value) || '');
      if (control.hasAttribute('aria-invalid')) show();
    });
  return () => {
    if (validate) control.setCustomValidity(validate(control.value) || '');
    show();
  };
}
export function validateFields(root) {
  let first;
  for (const control of root.querySelectorAll('input,textarea,select')) {
    if (control.matches(':disabled') || control.closest('#preset-picker,#backup-settings'))
      continue;
    control.dispatchEvent(new Event('admin:validate'));
    if (!control.checkValidity()) first ||= control;
  }
  if (!first) return true;
  for (let parent = first.parentElement; parent; parent = parent.parentElement)
    if (parent.tagName === 'DETAILS') parent.open = true;
  first.scrollIntoView({ block: 'center' });
  first.focus({ preventScroll: true });
  return false;
}
export function validateTimeZone(value) {
  try {
    if (!value.trim()) return '请填写时区';
    new Intl.DateTimeFormat('en', { timeZone: value });
    return '';
  } catch {
    return '时区无效，例如 Asia/Shanghai';
  }
}
