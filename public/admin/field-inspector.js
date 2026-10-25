import { requestJson } from '../core/api.js';
import { node } from '../core/dom.js';
import { validateFields } from './validation.js';

export function mountFieldInspector(controls, widget, targets, payload = () => widget) {
  const section = node('details');
  section.className = 'field-inspector';
  section.dataset.editorAuxiliary = 'true';
  section.append(node('summary', '字段映射助手'));
  section.append(
    node(
      'p',
      '读取当前数据的字段路径和类型，不显示原始值。选择目标字段，再选路径填入；列表条目字段相对于列表项。',
    ),
  );
  const read = node('button', '读取字段结构');
  read.type = 'button';
  const message = node('p');
  message.setAttribute('role', 'status');
  const result = node('div');
  result.hidden = true;
  const targetLabel = node('label', '填入字段'),
    target = node('select');
  target.setAttribute('aria-label', '填入字段');
  targets.forEach((item, index) => {
    const option = node('option', item.label);
    option.value = String(index);
    if (index === 0) option.selected = true;
    target.append(option);
  });
  targetLabel.append(target);
  const paths = node('div');
  paths.className = 'field-paths';
  result.append(targetLabel, paths);
  section.append(read, message, result);
  controls.append(section);
  let epoch = 0,
    controller,
    fields;
  function invalidate(event) {
    if (section.contains(event.target)) return;
    epoch++;
    controller?.abort();
    read.disabled = false;
    result.hidden = true;
    message.textContent = '配置已变化，请重新读取字段。';
  }
  controls.addEventListener('input', invalidate);
  controls.addEventListener('change', invalidate);

  function draw() {
    paths.replaceChildren();
    const selected = targets[Number(target.value)];
    if (!selected) return;
    let base = '';
    if (['label', 'url', 'detail'].includes(selected.key)) {
      base = widget.mapping.items || '';
      base = base ? base + '.0.' : '0.';
    }
    const available = fields.filter((field) => {
      if (base && !field.path.startsWith(base)) return false;
      if (selected.key === 'items') return field.type === 'array';
      if (selected.key === 'value' || selected.key === 'max' || selected.key.startsWith('metric-'))
        return ['number', 'string'].includes(field.type);
      return ['string', 'number', 'boolean'].includes(field.type);
    });
    for (const field of available) {
      const path = base ? field.path.slice(base.length) : field.path;
      const button = node('button', `${path || '(整个响应)'} · ${field.type}`);
      button.type = 'button';
      button.onclick = () => {
        if (selected.set) selected.set(path);
        else selected.control.value = path;
        selected.control.dispatchEvent(new Event('input', { bubbles: true }));
        message.textContent = '路径已填入，请测试数据并预览确认展示效果。';
      };
      paths.append(button);
    }
    if (!available.length)
      paths.append(node('p', '没有适合的路径。列表条目字段需先设置列表路径，再重新读取。'));
  }
  target.onchange = draw;
  read.onclick = async () => {
    if (!validateFields(controls)) return;
    const connectionsEditor =
      widget.source?.kind === 'connection'
        ? controls.ownerDocument.querySelector(
            `[data-connection-id="${widget.source.connectionId}"]`,
          )
        : null;
    if (connectionsEditor && !validateFields(connectionsEditor)) return;
    controller?.abort();
    controller = new AbortController();
    const current = ++epoch,
      snapshot = JSON.stringify(payload());
    read.disabled = true;
    result.hidden = true;
    message.textContent = '正在读取字段结构…';
    try {
      const info = await requestJson('/api/admin/widget-inspect', {
        method: 'POST',
        body: JSON.parse(snapshot),
        signal: controller.signal,
      });
      if (current !== epoch || !controls.isConnected || snapshot !== JSON.stringify(payload()))
        return;
      fields = info.fields;
      draw();
      result.hidden = false;
      message.textContent = info.truncated
        ? '字段较多，仅展示有限层级与前 100 个字段。敏感字段已过滤。'
        : '仅显示字段路径与类型，敏感字段已过滤。';
    } catch (error) {
      if (current === epoch) message.textContent = error.message;
    } finally {
      if (current === epoch) read.disabled = false;
    }
  };
}
