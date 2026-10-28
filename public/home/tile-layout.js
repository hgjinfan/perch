// Compact row tracks retain reading order and allow tiles to span columns.
// Keep this function self-contained: the server also embeds it before the first paint.
export function arrangeTileGrids(grids) {
  for (const grid of grids) {
    grid.style.gridAutoRows = '4px';
    const gap = parseFloat(getComputedStyle(grid).rowGap) || 0;
    for (const tile of grid.children) {
      const rows = Math.max(1, Math.ceil((tile.getBoundingClientRect().height + gap) / (4 + gap)));
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
