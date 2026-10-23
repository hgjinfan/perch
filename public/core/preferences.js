let theme = 'system';
try {
  theme = JSON.parse(localStorage.getItem('kyrie-home-preferences'))?.theme || 'system';
} catch {}
if (!['system', 'light', 'dark'].includes(theme)) theme = 'system';
export function applyPreferences() {
  document.documentElement.dataset.theme = theme;
  const dark =
    theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', dark ? '#191c20' : '#eef0f3');
}
export function toggleTheme() {
  const current =
    theme === 'system'
      ? matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : theme;
  theme = current === 'dark' ? 'light' : 'dark';
  applyPreferences();
  try {
    localStorage.setItem('kyrie-home-preferences', JSON.stringify({ theme }));
  } catch {}
}
