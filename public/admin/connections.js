import { safeUrl } from '../../shared/url.js';
import { node } from '../core/dom.js';
import { createFieldEditor } from './fields.js';
import { parseJsonField } from './json-fields.js';
import { validateFields } from './validation.js';

export function extractConnectionSource(source, connection) {
  if (!safeUrl(connection.baseUrl)) throw new Error('基础地址须为不含账号密码的 HTTP(S) 地址');
  const url = new URL(source.url),
    base = new URL(connection.baseUrl);
  const prefix = base.pathname.replace(/\/+$/, '');
  if (
    url.origin !== base.origin ||
    (prefix && url.pathname === prefix && !url.pathname.endsWith('/')) ||
    (url.pathname !== prefix && !url.pathname.startsWith(prefix + '/')) ||
    base.search ||
    base.hash
  )
    throw new Error('基础地址必须是接口地址的同源路径前缀');
  if (new Set(url.searchParams.keys()).size !== [...url.searchParams.keys()].length)
    throw new Error('重复查询参数请继续使用独立 API');
  return {
    kind: 'connection',
    connectionId: connection.id,
    path: url.pathname.slice(prefix.length) || '/',
    query: Object.fromEntries(url.searchParams),
    method: source.method || 'GET',
    ...(source.body !== undefined ? { body: source.body } : {}),
  };
}
export function widgetPreviewPayload(widget, config) {
  return widget.source.kind === 'connection'
    ? {
        widget,
        connections: (config.connections || []).filter((c) => c.id === widget.source.connectionId),
      }
    : widget;
}
const editors = new WeakMap();
export function refreshConnections(target) {
  editors.get(target)?.();
}
export function mountConnections(target, config, onChanged) {
  config.connections ||= [];
  const drafts = new Map();
  const open = new Map();
  function draw() {
    for (const section of target.querySelectorAll('[data-connection-id]'))
      open.set(section.dataset.connectionId, section.open);
    for (const control of target.querySelectorAll('[data-draft-key]'))
      if (!control.validity.valid)
        drafts.set(control.dataset.draftKey, {
          value: control.value,
          message: control.validationMessage,
        });
    target.replaceChildren();
    for (const connection of config.connections) {
      const section = node('details');
      section.className = 'widget-editor';
      section.dataset.connectionId = connection.id;
      section.open = open.get(connection.id) || false;
      const summary = node('summary', connection.name);
      section.append(summary);
      const controls = node('div');
      section.append(controls);
      const changed = () => {
        for (const controls of target.ownerDocument.querySelectorAll(
          '#widgets-editor .widget-editor > div',
        ))
          controls.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const input = createFieldEditor(controls, { drafts, prefix: 'connection:' + connection.id });
      input(
        '连接名称',
        connection.name,
        (value) => {
          connection.name = value;
          summary.textContent = value;
        },
        { required: true, maxLength: 80 },
      );
      input(
        '基础地址',
        connection.baseUrl,
        (value) => {
          connection.baseUrl = value;
          changed();
        },
        {
          type: 'url',
          required: true,
          maxLength: 2048,
          hint: '可包含反向代理路径前缀；不要填写查询参数。',
        },
      );
      input(
        '连接请求头',
        JSON.stringify(connection.headers, null, 2),
        (value, control) => {
          try {
            connection.headers = parseJsonField(value, 'headers');
            changed();
          } catch (error) {
            control.setCustomValidity(error.message);
          }
        },
        { multiline: true, hint: '填写 ${WIDGET_API_TOKEN} 等环境变量引用，不填写真实密钥。' },
      );
      const references = node('p');
      const updateReferences = () => {
        const names = config.widgets
          .filter((w) => w.source.kind === 'connection' && w.source.connectionId === connection.id)
          .map((w) => w.title);
        references.textContent = names.length
          ? '使用此连接：' + names.join('、')
          : '暂无磁块使用此连接。';
      };
      updateReferences();
      section.addEventListener('toggle', updateReferences);
      const remove = node('button', '删除连接');
      remove.type = 'button';
      remove.className = 'remove';
      remove.onclick = () => {
        if (
          config.widgets.some(
            (w) => w.source.kind === 'connection' && w.source.connectionId === connection.id,
          )
        ) {
          references.textContent = '无法删除：请先修改使用此连接的磁块。';
          return;
        }
        config.connections = config.connections.filter((c) => c !== connection);
        draw();
        onChanged();
        changed();
      };
      controls.addEventListener('change', () => onChanged());
      controls.append(references, remove);
      target.append(section);
    }
    const add = node('button', '＋ 添加共享连接');
    add.type = 'button';
    add.disabled = config.connections.length >= 40;
    add.onclick = () => {
      if (!validateFields(target)) return;
      config.connections.push({
        id: 'connection-' + crypto.randomUUID().slice(0, 8),
        name: '新连接',
        baseUrl: '',
        headers: {},
      });
      draw();
      target.lastElementChild.previousElementSibling.open = true;
      onChanged();
    };
    target.append(add);
  }
  editors.set(target, draw);
  draw();
  return draw;
}
