let theme = 'system';
try {
  theme = JSON.parse(localStorage.getItem('kyrie-home-preferences'))?.theme || 'system';
} catch {}
export function applyPreferences() {
  document.documentElement.dataset.theme = theme;
}
export function toggleTheme() {
  const current =
    theme === 'system'
      ? matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : theme;
  theme = current === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem('kyrie-home-preferences', JSON.stringify({ theme }));
  } catch {}
}
