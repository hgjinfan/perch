// Stable identities shared by the editor and server; no source configuration is rendered.
export function layoutEntries(config) {
  const entries = config.feeds.map((f) => ({ id: `feed-${f.id}`, title: f.name }));
  entries.splice(Math.min(2, entries.length), 0, {
    id: 'weather',
    title: config.titles?.weather || '天气',
  });
  entries.push(
    { id: 'bookmarks', title: config.titles?.bookmarks || '常用书签' },
    { id: 'projects', title: config.titles?.projects || '关注项目' },
  );
  entries.push(...(config.widgets || []).map((w) => ({ id: `widget-${w.id}`, title: w.title })));
  return entries;
}
export function reconcileGroups(config) {
  const entries = layoutEntries(config),
    allowed = new Set(entries.map((e) => e.id)),
    seen = new Set();
  const groups = (config.layout.groups ||= [{ id: 'default', title: '', columns: 3, items: [] }]);
  for (const group of groups)
    group.items = group.items.filter((item) => {
      if (!allowed.has(item.id) || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  for (const entry of entries)
    if (!seen.has(entry.id)) groups[0].items.push({ id: entry.id, span: 1 });
  return groups;
}
export function validateGroups(value, config) {
  if (value === undefined) return reconcileGroups({ ...config, layout: {} });
  if (!Array.isArray(value) || !value.length || value.length > 12)
    throw new Error('内容分组需要 1–12 个');
  const allowed = new Set(layoutEntries(config).map((e) => e.id)),
    ids = new Set(),
    items = new Set();
  const groups = value.map((group) => {
    if (
      !group ||
      !/^[a-z0-9_-]{1,50}$/.test(group.id) ||
      ids.has(group.id) ||
      typeof group.title !== 'string' ||
      group.title.length > 80 ||
      !Number.isInteger(group.columns) ||
      group.columns < 1 ||
      group.columns > 4 ||
      !Array.isArray(group.items) ||
      group.items.length > 64
    )
      throw new Error('分组名称、标识或列数无效');
    ids.add(group.id);
    return {
      id: group.id,
      title: group.title,
      columns: group.columns,
      items: group.items.map((item) => {
        if (
          !item ||
          !allowed.has(item.id) ||
          items.has(item.id) ||
          (item.span !== 'full' && (!Number.isInteger(item.span) || item.span < 1 || item.span > 4))
        )
          throw new Error('磁块位置重复、已失效或宽度无效');
        items.add(item.id);
        return { id: item.id, span: item.span };
      }),
    };
  });
  return reconcileGroups({ ...config, layout: { groups } });
}

export function effectiveColumns(columns, mode = 'desktop') {
  return Math.min(columns, mode === 'phone' ? 1 : mode === 'tablet' ? 2 : 4);
}
export function effectiveSpan(span, columns) {
  return span === 'full' ? columns : Math.min(span, columns);
}
