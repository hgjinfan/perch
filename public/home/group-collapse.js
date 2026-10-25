function key(root) {
  return (
    'perch-group-collapse-v1:' +
    ((root.ownerDocument || root).documentElement.dataset.basePath || '')
  );
}
export function restoreGroupCollapse(root, storage) {
  let saved = {};
  try {
    storage ||= globalThis.localStorage;
    const raw = storage?.getItem(key(root));
    if (raw && raw.length < 4000) saved = JSON.parse(raw);
  } catch {}
  for (const group of root.querySelectorAll('details.board-group[data-group]'))
    if (typeof saved?.[group.dataset.group] === 'boolean') group.open = !saved[group.dataset.group];
}
export function setupGroupCollapse(root, onChange = () => {}) {
  restoreGroupCollapse(root);
  const handlers = [];
  for (const group of root.querySelectorAll('details.board-group[data-group]')) {
    let lastOpen = group.open;
    const changed = () => {
      if (group.open === lastOpen) return;
      lastOpen = group.open;
      const state = Object.create(null);
      for (const current of root.querySelectorAll('details.board-group[data-group]'))
        state[current.dataset.group] = !current.open;
      try {
        localStorage.setItem(key(root), JSON.stringify(state));
      } catch {}
      onChange(group.open);
    };
    group.addEventListener('toggle', changed);
    handlers.push(() => group.removeEventListener('toggle', changed));
  }
  return () => handlers.forEach((stop) => stop());
}
