// Compact row tracks retain reading order and allow tiles to span columns.
// Keep this function self-contained: the server also embeds it before the first paint.
export function arrangeTileGrids(grids) {
  for (const grid of grids) {
    const style = getComputedStyle(grid);
    const singleColumn = style.gridTemplateColumns.trim().split(/\s+/).length <= 1;
    if (singleColumn || !grid.children.length) {
      grid.style.gridAutoRows = '';
      grid.style.rowGap = '';
      grid.style.marginBottom = '';
      for (const tile of grid.children) tile.style.gridRowEnd = '';
      continue;
    }
    // Count pixels, not (row + gap) tracks: keep quantization below one pixel.
    const gap = parseFloat(style.columnGap) || 0;
    grid.style.gridAutoRows = '1px';
    grid.style.rowGap = '0px';
    // Each span includes its trailing gap; the last row must not add it twice.
    grid.style.marginBottom = `${-gap}px`;
    for (const tile of grid.children) {
      const rows = Math.max(1, Math.ceil(tile.getBoundingClientRect().height + gap));
      tile.style.gridRowEnd = `span ${rows}`;
    }
  }
}

export function setupTileLayout(root) {
  if (!globalThis.ResizeObserver) return;
  const grids = [...root.querySelectorAll('.content-board')];
  let frame,
    disposed = false;
  function arrange() {
    if (disposed) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      arrangeTileGrids(grids);
    });
  }
  const observer = new ResizeObserver(arrange);
  for (const grid of grids) {
    observer.observe(grid);
    for (const tile of grid.children) observer.observe(tile);
  }
  arrangeTileGrids(grids);
  document.fonts?.ready.then(arrange);
  return () => {
    disposed = true;
    observer.disconnect();
    cancelAnimationFrame(frame);
  };
}
