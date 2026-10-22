// Compact row tracks retain reading order and allow tiles to span columns.
export function setupTileLayout(root) {
  if (!globalThis.ResizeObserver) return;
  const grids = [...root.querySelectorAll('.content-board')];
  let frame;
  function arrange() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      for (const grid of grids) {
        grid.style.gridAutoRows = '4px';
        const gap = parseFloat(getComputedStyle(grid).rowGap) || 0;
        for (const tile of grid.children) {
          const rows = Math.max(
            1,
            Math.ceil((tile.getBoundingClientRect().height + gap) / (4 + gap)),
          );
          tile.style.gridRowEnd = `span ${rows}`;
        }
      }
    });
  }
  const observer = new ResizeObserver(arrange);
  for (const grid of grids) {
    observer.observe(grid);
    for (const tile of grid.children) observer.observe(tile);
  }
  arrange();
  document.fonts?.ready.then(arrange);
}
