import { parseJsonField } from './json-fields.js';
import { widgetDefinitions } from '../../shared/widget-types.js';
const examples = Object.fromEntries(
  Object.entries(widgetDefinitions).map(([key, d]) => [key, d.example]),
);
export function editWidgetSource(w, input, draw) {
  input(
    '数据来源',
    w.source.kind,
    (value) => {
      w.source =
        value === 'static'
          ? { kind: 'static', data: structuredClone(examples[w.type]) }
          : { kind: 'api', url: '', method: 'GET', headers: {} };
      draw();
    },
    { options: { static: '手动填写', api: 'JSON API' } },
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
    input('接口地址', w.source.url, (value) => (w.source.url = value), {
      type: 'url',
      required: true,
      maxLength: 2048,
    });
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
  }
}
