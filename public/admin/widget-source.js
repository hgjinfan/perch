import { validConnectionPath, validConnectionQuery } from '../../shared/connection-request.js';
import { extractConnectionSource, refreshConnections } from './connections.js';
import { node } from '../core/dom.js';
import { createFieldEditor } from './fields.js';
import { validateFields } from './validation.js';
import { parseJsonField } from './json-fields.js';
import { widgetDefinitions } from '../../shared/widget-types.js';
const examples = Object.fromEntries(
  Object.entries(widgetDefinitions).map(([key, d]) => [key, d.example]),
);
export function editWidgetSource(w, input, draw, config = { connections: [] }, controls) {
  input(
    '数据来源',
    w.source.kind,
    (value) => {
      w.source =
        value === 'static'
          ? { kind: 'static', data: structuredClone(examples[w.type]) }
          : value === 'connection'
            ? {
                kind: 'connection',
                connectionId: config.connections?.[0]?.id || '',
                path: '/',
                query: {},
                method: 'GET',
              }
            : { kind: 'api', url: '', method: 'GET', headers: {} };
      draw();
    },
    { options: { static: '手动填写', api: '独立 JSON API', connection: '共享连接' } },
  );
  if (w.source.kind === 'static') {
    if (widgetDefinitions[w.type].controls.text)
      input(
        '文本内容',
        w.source.data?.text ?? '',
        (value) => {
          w.source.data = { text: value };
          w.mapping = { text: 'text' };
        },
        { multiline: true },
      );
    else
      input(
        '手动数据',
        JSON.stringify(w.source.data, null, 2),
        (value, control) => {
          try {
            w.source.data = parseJsonField(value);
          } catch (error) {
            control.setCustomValidity(error.message);
          }
        },
        {
          multiline: true,
          hint: '示例已填好；修改数值或列表即可。字段映射决定哪些内容会显示。',
        },
      );
  } else {
    if (w.source.kind === 'api')
      input('接口地址', w.source.url, (value) => (w.source.url = value), {
        type: 'url',
        required: true,
        maxLength: 2048,
      });
    if (w.source.kind === 'connection') {
      input('选择连接', w.source.connectionId, (value) => (w.source.connectionId = value), {
        options: {
          '': '请选择连接…',
          ...Object.fromEntries((config.connections || []).map((c) => [c.id, c.name])),
        },
        required: true,
      });
      input('请求路径', w.source.path, (value) => (w.source.path = value), {
        required: true,
        hint: '以 / 开头，追加到连接基础地址；例如 /api/v1/query。',
        validate: (value) =>
          validConnectionPath(value) ? '' : '路径须以 / 开头，不包含域名、查询参数或目录回退',
      });
      input(
        '查询参数',
        JSON.stringify(w.source.query || {}, null, 2),
        (value, control) => {
          try {
            const query = parseJsonField(value);
            if (!validConnectionQuery(query))
              throw new Error('查询参数须为字符串值的对象，最多 30 项');
            w.source.query = query;
          } catch (error) {
            control.setCustomValidity(error.message);
          }
        },
        { multiline: true, hint: 'JSON 对象，值为字符串。例如 {"query":"sum(up)"}。' },
      );
    }
    input(
      '请求方式',
      w.source.method,
      (value) => {
        w.source.method = value;
        draw();
      },
      {
        options: { GET: 'GET · 读取', POST: 'POST · 查询' },
        hint: '只连接用于查询数据的接口；刷新会重复调用。',
      },
    );
    if (w.source.kind === 'api')
      input(
        '请求头',
        JSON.stringify(w.source.headers, null, 2),
        (value, control) => {
          try {
            w.source.headers = parseJsonField(value, 'headers');
          } catch (error) {
            control.setCustomValidity(error.message);
          }
        },
        {
          multiline: true,
          hint: '认证示例：{"Authorization":"Bearer ${WIDGET_API_TOKEN}"}。变量由服务器提供，不发送给访客。',
        },
      );
    if (w.source.method === 'POST')
      input(
        'JSON 请求正文',
        JSON.stringify(w.source.body ?? {}, null, 2),
        (value, control) => {
          try {
            w.source.body = parseJsonField(value);
          } catch (error) {
            control.setCustomValidity(error.message);
          }
        },
        { multiline: true },
      );

    if (w.source.kind === 'api' && controls) {
      const section = node('details');
      section.dataset.editorAuxiliary = 'true';
      section.append(node('summary', '提取为共享连接'));
      let base = '';
      try {
        base = new URL(w.source.url).origin;
      } catch {}
      let name = w.title;
      const edit = createFieldEditor(section);
      edit('新连接名称', name, (value) => (name = value), {
        required: true,
        maxLength: 80,
        validate: (value) => (value.trim() ? '' : '名称不能为空'),
      });
      edit('连接基础地址', base, (value) => (base = value), {
        type: 'url',
        hint: '确认基础地址，剩余路径会留在磁块中；支持反向代理前缀。',
      });
      const message = node('p'),
        button = node('button', '确认提取连接');
      button.type = 'button';
      button.onclick = () => {
        if (!validateFields(controls)) return;
        try {
          if ((config.connections || []).length >= 40) throw new Error('共享连接最多 40 个');
          const connection = {
            id: 'connection-' + crypto.randomUUID().slice(0, 8),
            name,
            baseUrl: base,
            headers: structuredClone(w.source.headers || {}),
          };
          const source = extractConnectionSource(w.source, connection);
          (config.connections ||= []).push(connection);
          w.source = source;
          refreshConnections(document.querySelector('#connections-editor'));
          draw();
        } catch (error) {
          message.textContent = error.message;
        }
      };
      section.append(button, message);
      controls.append(section);
    }
  }
}
