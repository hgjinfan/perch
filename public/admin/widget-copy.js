export function duplicateWidget(config, widget) {
  if (config.widgets.length >= 20) throw new Error('自定义磁块最多 20 个');
  const clone = structuredClone(widget);
  clone.id = `copy-${crypto.randomUUID().slice(0, 8)}`;
  clone.title = (widget.title.slice(0, 75) + ' · 副本').slice(0, 80);
  config.widgets.splice(config.widgets.indexOf(widget) + 1, 0, clone);
  const sourceId = `widget-${widget.id}`,
    cloneId = `widget-${clone.id}`;
  for (const group of config.layout.groups || []) {
    const position = group.items.findIndex((item) => item.id === sourceId);
    if (position >= 0)
      group.items.splice(position + 1, 0, { ...group.items[position], id: cloneId });
  }
  if (config.layout.hidden.includes(sourceId)) config.layout.hidden.push(cloneId);
  return clone;
}
