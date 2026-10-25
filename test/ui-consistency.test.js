import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { createFieldEditor } from '../public/admin/fields.js';
import { renderConfigHealth } from '../public/admin/config-health.js';
function fixture(t, markup) {
  const { document } = parseHTML('<html><body>' + markup + '</body></html>');
  const previous = { document: globalThis.document, fetch: globalThis.fetch };
  globalThis.document = document;
  t.after(() => Object.assign(globalThis, previous));
  return document;
}
test('field hints and errors are linked to their own controls with unique identifiers', (t) => {
  const document = fixture(t, '<div id="fields"></div>');
  for (const proto of [document.defaultView.HTMLElement.prototype])
    proto.setCustomValidity = function () {};
  const edit = createFieldEditor(document.querySelector('#fields'));
  const first = edit('Path', '', () => {}, { hint: 'First help' }),
    second = edit('Name', '', () => {}, { hint: 'Second help' });
  for (const [control, hint] of [
    [first, 'First help'],
    [second, 'Second help'],
  ]) {
    const refs = control.getAttribute('aria-describedby').split(' ');
    assert.equal(refs.length, 2);
    assert.ok(refs.every((id) => document.getElementById(id)));
    assert.equal(document.getElementById(refs[1]).textContent, hint);
  }
  assert.notEqual(first.getAttribute('aria-describedby'), second.getAttribute('aria-describedby'));
});
test('health findings prioritize actionable errors and show text severity without interpreting names as HTML', async (t) => {
  const document = fixture(
    t,
    '<div id="health"><p id="health-message"></p><div id="health-findings"></div></div>',
  );
  globalThis.fetch = async () =>
    Response.json({
      summary: { errors: 1, warnings: 1, information: 1, unchecked: 0 },
      findings: [
        { severity: 'info', name: 'Info', title: 'Information', advice: 'Keep' },
        { severity: 'error', name: '<img src=x>', title: 'Error', advice: 'Fix' },
        { severity: 'warning', name: 'Warning', title: 'Warning', advice: 'Check' },
      ],
    });
  await renderConfigHealth(document.querySelector('#health'));
  const cards = [...document.querySelectorAll('.diagnostic-card')];
  assert.deepEqual(
    cards.map((card) => card.querySelector('.health-severity').textContent),
    ['错误', '建议', '提示'],
  );
  assert.equal(cards[0].querySelector('img'), null);
  assert.match(cards[0].textContent, /<img src=x>/);
  assert.equal(cards[0].querySelector('.health-advice').textContent, 'Fix');
});
