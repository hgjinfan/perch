import { validateFields } from './validation.js';
import { node } from '../core/dom.js';
import { requestHtml } from '../core/api.js';
export function mountWidgetPreview(controls, w, onRemove) {
  const actions = node('div');
  actions.className = 'widget-actions';
  const preview = node('button', '测试数据并预览');
  preview.type = 'button';
  const remove = node('button', '删除磁块');
  remove.type = 'button';
  remove.className = 'remove';
  const status = node('p');
  status.className = 'field-help';
  status.setAttribute('role', 'status');
  const result = node('div');
  result.className = 'widget-preview tile';
  result.hidden = true;
  let epoch = 0,
    controller,
    attempted = false;
  function invalidate() {
    epoch++;
    controller?.abort();
    preview.disabled = false;
    result.hidden = true;
    if (attempted) status.textContent = '配置已修改，请重新测试预览。';
  }
  controls.addEventListener('input', invalidate);
  controls.addEventListener('change', invalidate);
  preview.onclick = async () => {
    if (!validateFields(controls)) return;
    controller?.abort();
    controller = new AbortController();
    const current = ++epoch,
      snapshot = JSON.stringify(w);
    attempted = true;
    preview.disabled = true;
    result.hidden = true;
    status.textContent = '正在读取数据…';
    try {
      const fragment = await requestHtml('/api/admin/widget-preview', {
        method: 'POST',
        body: JSON.parse(snapshot),
        signal: controller.signal,
      });
      if (current !== epoch || !controls.isConnected) return;
      if (JSON.stringify(w) !== snapshot) {
        invalidate();
        return;
      }
      result.innerHTML = fragment;
      result.hidden = false;
      status.textContent = '映射成功，以下内容将对访客展示。保存后生效。';
    } catch (error) {
      if (current === epoch && controls.isConnected) status.textContent = error.message;
    } finally {
      if (current === epoch) preview.disabled = false;
    }
  };
  remove.onclick = () => {
    invalidate();
    onRemove();
  };
  actions.append(preview, remove);
  controls.append(actions, status, result);
}
