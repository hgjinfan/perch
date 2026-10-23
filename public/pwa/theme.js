// Run before the stylesheet, without inline script or relaxed CSP.
(() => {
  let theme = 'system';
  try {
    theme = JSON.parse(localStorage.getItem('kyrie-home-preferences'))?.theme || 'system';
  } catch {}
  if (!['light', 'dark', 'system'].includes(theme)) theme = 'system';
  document.documentElement.dataset.theme = theme;
  const dark =
    theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', dark ? '#191c20' : '#eef0f3');
})();
