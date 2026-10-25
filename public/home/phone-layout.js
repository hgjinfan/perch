export const PHONE_QUERY = '(max-width: 520px)';
export function isPhone() {
  return globalThis.matchMedia?.(PHONE_QUERY).matches || false;
}
export function applyPhoneLimit(node, phone = isPhone()) {
  const limit = Number(node.dataset.phoneLimit);
  const rows = node.querySelectorAll(
    '.module-content > .news, .module-content .widget-list-row, .module-content .chips > a',
  );
  rows.forEach((row, index) => {
    if (phone && Number.isInteger(limit) && limit > 0 && limit <= 40 && index >= limit) {
      row.hidden = true;
      row.dataset.phoneTrimmed = 'true';
    } else if (row.dataset.phoneTrimmed === 'true') {
      row.hidden = false;
      delete row.dataset.phoneTrimmed;
    }
  });
}
// Move existing nodes rather than cloning tiles or changing only visual order.
export function setupPhoneLayout(root, onChange = () => {}) {
  const tiles = [...root.querySelectorAll('.board-group [data-phone-order]')];
  if (!tiles.length || !globalThis.matchMedia) return;
  const query = matchMedia(PHONE_QUERY),
    doc = root.ownerDocument;
  const originals = tiles.map((node) => {
    const anchor = doc.createComment('tile position');
    node.before(anchor);
    return { node, anchor, initiallyHidden: node.hidden === true };
  });
  const groups = [...root.querySelectorAll('.board-group')];
  const section = doc.createElement('section');
  section.className = 'board-group phone-group';
  section.setAttribute('aria-label', '手机内容');
  const grid = doc.createElement('div');
  grid.className = 'content-board';
  grid.dataset.columns = '1';
  section.append(grid);
  section.hidden = true;
  root.append(section);
  function restore() {
    for (const { node, anchor, initiallyHidden } of originals) {
      if (anchor.parentNode) anchor.parentNode.insertBefore(node, anchor.nextSibling);
      node.hidden = initiallyHidden || node.dataset.moduleUnavailable === 'true';
      applyPhoneLimit(node, false);
    }
    for (const group of groups) group.hidden = false;
    section.hidden = true;
  }
  function apply(notify = true) {
    const focused = doc.activeElement;
    if (query.matches) {
      for (const node of [...tiles].sort(
        (a, b) => Number(a.dataset.phoneOrder) - Number(b.dataset.phoneOrder),
      )) {
        grid.append(node);
        node.hidden =
          originals.find((item) => item.node === node).initiallyHidden ||
          node.dataset.moduleUnavailable === 'true' ||
          node.dataset.phoneHidden === 'true';
        applyPhoneLimit(node, true);
      }
      for (const group of groups) group.hidden = true;
      section.hidden = false;
    } else restore();
    if (focused?.isConnected && focused !== doc.body) focused.focus?.({ preventScroll: true });
    if (notify) onChange();
  }
  const changed = () => apply();
  query.addEventListener('change', changed);
  apply(false);
  return () => {
    query.removeEventListener('change', changed);
    restore();
    for (const { anchor } of originals) anchor.remove();
    section.remove();
  };
}
