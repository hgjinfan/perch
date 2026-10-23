export function pageDocumentUrl(version) {
  if (!/^[a-f0-9]{20}-[a-f0-9]{32}$/.test(version || '')) throw new Error('Invalid page version');
  return `/page/${version.slice(0, 20)}/${version.slice(21)}`;
}
export async function synchronizePage(version, { fetcher = fetch, mount, host = document } = {}) {
  const response = await fetcher(pageDocumentUrl(version), {
    cache: 'no-store',
    credentials: 'omit',
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) return false;
  const parsed = new DOMParser().parseFromString(await response.text(), 'text/html');
  if (parsed.documentElement.dataset.pageVersion !== version) return false;
  const next = parsed.querySelector('#board'),
    board = host.querySelector('#board');
  if (!next || !board) return false;
  const focus = host.activeElement;
  // Do not interrupt city entry or keyboard interaction inside a tile.
  if (focus && board.contains(focus) && focus !== host.body) return false;
  board.replaceChildren(...next.childNodes);
  for (const selector of ['.brand', '#date']) {
    const source = parsed.querySelector(selector),
      target = host.querySelector(selector);
    if (source && target) {
      target.innerHTML = source.innerHTML;
      if (source.dataset.timezone) target.dataset.timezone = source.dataset.timezone;
    }
  }
  host.title = parsed.title;
  host.documentElement.dataset.density = parsed.documentElement.dataset.density;
  host.documentElement.dataset.pageVersion = version;
  mount();
  return true;
}
