import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { createEditSession } from '../public/admin/edit-session.js';
import { duplicateWidget } from '../public/admin/widget-copy.js';
import { parseJsonField } from '../public/admin/json-fields.js';
import { readFile } from 'node:fs/promises';
import { validateConfig } from '../src/config/schema.js';
import { validateWidget } from '../src/widgets.js';
test('edit session detects raw invalid drafts and model actions, ignores backup/preset inputs, and guards only dirty navigation', () => {
  const { document } = parseHTML(
    '<form><input name="title" value="original"><textarea>{}</textarea><div id="preset-picker"><input></div><div id="backup-settings"><input></div></form>',
  );
  const form = document.querySelector('form'),
    model = { order: ['a', 'b'] },
    listeners = {},
    states = [];
  const session = createEditSession({
    form,
    capture: () => model,
    onState: (s) => states.push(s),
    window: { addEventListener: (name, handler) => (listeners[name] = handler) },
  });
  session.saved();
  assert.equal(session.dirty, false);
  form.querySelector('#preset-picker input').value = 'transient';
  form.querySelector('#backup-settings input').value = 'temporary';
  assert.equal(session.dirty, false);
  form.querySelector('textarea').value = '{';
  assert.equal(session.dirty, true);
  let blocked = false;
  listeners.beforeunload({ preventDefault: () => (blocked = true) });
  assert.equal(blocked, true);
  form.querySelector('textarea').value = '{}';
  assert.equal(session.dirty, false);
  model.order.reverse();
  assert.equal(session.dirty, true);
  session.saved();
  assert.equal(session.dirty, false);
  session.setBusy(true);
  blocked = false;
  listeners.beforeunload({ preventDefault: () => (blocked = true) });
  assert.equal(blocked, true);
  session.allowLeave();
  blocked = false;
  listeners.beforeunload({ preventDefault: () => (blocked = true) });
  assert.equal(blocked, false);
});
test('duplicate widget deep copies data and immediately follows original group placement and hidden state', async () => {
  const raw = JSON.parse(await readFile(new URL('../config.json', import.meta.url)));
  const widget = validateWidget({
    id: 'original',
    title: '指标',
    type: 'metric',
    source: { kind: 'static', data: { value: 42 } },
    mapping: { value: 'value' },
  });
  const config = validateConfig({ ...raw, widgets: [widget] });
  const group = config.layout.groups[0],
    original = group.items.find((i) => i.id === 'widget-original');
  original.span = 2;
  config.layout.hidden.push(original.id);
  const clone = duplicateWidget(config, widget);
  assert.notEqual(clone.id, widget.id);
  assert.match(clone.title, /副本/);
  assert.equal(group.items[group.items.indexOf(original) + 1].id, `widget-${clone.id}`);
  assert.equal(group.items[group.items.indexOf(original) + 1].span, 2);
  assert.ok(config.layout.hidden.includes(`widget-${clone.id}`));
  clone.source.data.value = 99;
  assert.equal(widget.source.data.value, 42);
  assert.doesNotThrow(() => validateConfig(config));
});
test('JSON field parsing catches incorrect shapes and unsafe header/path values before save', () => {
  for (const [text, kind] of [
    ['{', 'data'],
    ['[]', 'headers'],
    ['{"Cookie":"secret"}', 'headers'],
    ['{"Authorization":"${HOME}"}', 'headers'],
    ['{}', 'fields'],
    ['[{"label":"x","path":"__proto__"}]', 'fields'],
  ])
    assert.throws(() => parseJsonField(text, kind));
  assert.deepEqual(parseJsonField('{"Authorization":"Bearer ${WIDGET_TEST_TOKEN}"}', 'headers'), {
    Authorization: 'Bearer ${WIDGET_TEST_TOKEN}',
  });
  assert.equal(parseJsonField('[{"label":"x","path":"cpu","scale":100}]', 'fields')[0].scale, 100);
});
