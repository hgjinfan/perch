import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { mountFieldInspector } from '../public/admin/field-inspector.js';
import { mountBackups } from '../public/admin/backups.js';
import { createEditSession } from '../public/admin/edit-session.js';
function dom(t, markup) {
  const { document, window } = parseHTML(`<html><body>${markup}</body></html>`);
  const previous = {
    document: globalThis.document,
    window: globalThis.window,
    Event: globalThis.Event,
    fetch: globalThis.fetch,
  };
  Object.assign(globalThis, { document, window, Event: window.Event });
  window.HTMLElement.prototype.checkValidity = () => true;
  t.after(() => Object.assign(globalThis, previous));
  return { document, window };
}

test('field helper filters incompatible paths, keeps transient state clean, applies model changes', async (t) => {
  const { document } = dom(t, '<form><div id="controls"><input value="old"></div></form>');
  const controls = document.querySelector('#controls'),
    input = controls.querySelector('input');
  const widget = { mapping: { value: 'old' }, source: { kind: 'static', data: { used: 42 } } };
  input.addEventListener('input', () => {
    widget.mapping.value = input.value;
  });
  globalThis.fetch = async () =>
    Response.json({
      fields: [
        { path: 'data', type: 'object' },
        { path: 'data.used', type: 'number' },
      ],
      truncated: false,
    });
  mountFieldInspector(controls, widget, [{ key: 'value', label: '数值字段', control: input }]);
  const session = createEditSession({
    form: document.querySelector('form'),
    capture: () => widget,
    onState: () => {},
    window: { addEventListener() {} },
  });
  session.saved();
  await controls.querySelector('.field-inspector > button').onclick();
  assert.equal(session.dirty, false);
  const paths = controls.querySelector('.field-paths');
  assert.equal(paths.querySelectorAll('button').length, 1);
  assert.match(paths.textContent, /data.used/);
  paths.querySelector('button').onclick();
  assert.equal(widget.mapping.value, 'data.used');
  assert.equal(session.dirty, true);
});

test('history comparison is read-only and restore conflicts preserve the current page', async (t) => {
  const { document } = dom(
    t,
    `<div id="root"><input id="backup-file"><div id="backup-history"></div><p id="backup-message"></p><p id="backup-summary"></p><ul id="backup-diff"></ul><input id="backup-confirm" type="checkbox"><button id="backup-restore"></button><button id="backup-refresh"></button></div>`,
  );
  const root = document.querySelector('#root');
  let restored = false;
  globalThis.fetch = async (path) => {
    if (path === '/api/admin/backups')
      return Response.json([
        { id: 'snapshot', title: 'Before', createdAt: '2026-10-23T00:00:00Z', reason: 'save' },
      ]);
    if (path === '/api/admin/backups/snapshot')
      return Response.json({ config: { title: 'Before' } });
    if (path.endsWith('/preview'))
      return Response.json(
        {
          title: 'Before',
          changes: [{ path: 'title', action: 'changed', before: 'Current', after: 'Before' }],
        },
        { headers: { 'X-Config-Version': 'a'.repeat(64) } },
      );
    return Response.json({ error: '配置已变化' }, { status: 409 });
  };
  mountBackups(root, {
    onRestored: () => {
      restored = true;
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  await root.querySelector('#backup-history button').onclick();
  assert.match(root.querySelector('#backup-diff').textContent, /Current → Before/);
  assert.equal(restored, false);
  const confirm = root.querySelector('#backup-confirm');
  confirm.checked = true;
  confirm.onchange();
  await root.querySelector('#backup-restore').onclick();
  assert.match(root.querySelector('#backup-message').textContent, /其他页面修改/);
  assert.equal(restored, false);
  assert.equal(confirm.checked, false);
  assert.equal(root.querySelector('#backup-diff').hidden, true);
});
