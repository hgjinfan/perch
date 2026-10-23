import { hydrateInitialContent } from './initial-content.js';
import { appPath } from '../core/base-path.js';
// The cached launch shell never contains site config, fetched content or visitor location.
export async function launchHomepage({
  fetcher = fetch,
  host = document,
  load = (url) => import(url),
  prepare = prepareResources,
  hydrate = hydrateInitialContent,
  pathname = location.pathname,
} = {}) {
  const basePath = host.documentElement.dataset.basePath || '';
  const route = pathname.startsWith(`${basePath}/page/`) ? pathname.slice(basePath.length) : '/';
  const path = /^\/page\/(?:latest|[a-f0-9]{20}\/[a-f0-9]{32})$/.test(route) ? route : '/';
  const response = await fetcher(appPath(path, host), {
    cache: 'no-store',
    credentials: 'omit',
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok || !response.headers.get('content-type')?.includes('text/html'))
    throw new Error('Homepage unavailable');
  const parsed = new DOMParser().parseFromString(await response.text(), 'text/html');
  const board = parsed.querySelector('#board'),
    script = parsed.querySelector('script[type="module"][src]');
  const src = script?.getAttribute('src');
  if (
    !board ||
    !/^[a-f0-9]{20}-[a-f0-9]{32}$/.test(parsed.documentElement.dataset.pageVersion || '') ||
    !/^\/(?:client\/public\/app-[A-Z0-9]+\.js|assets\/[a-f0-9]{20}\/app\.js)$/.test(
      src?.slice(basePath.length) || '',
    )
  )
    throw new Error('Invalid homepage');
  const theme = host.documentElement.dataset.theme;
  await Promise.all([prepare(parsed, host, src), hydrate(parsed, { fetcher })]);
  const previousBody = [...host.body.childNodes],
    previousTitle = host.title;
  const previousDataset = { ...host.documentElement.dataset };
  host.body.replaceChildren(...parsed.body.childNodes);
  host.title = parsed.title;
  for (const key of ['pageVersion', 'assetVersion', 'density'])
    host.documentElement.dataset[key] = parsed.documentElement.dataset[key] || '';
  if (theme) host.documentElement.dataset.theme = theme;
  try {
    await load(src);
  } catch (error) {
    host.body.replaceChildren(...previousBody);
    host.title = previousTitle;
    for (const key of ['pageVersion', 'assetVersion', 'density']) {
      if (previousDataset[key] === undefined) delete host.documentElement.dataset[key];
      else host.documentElement.dataset[key] = previousDataset[key];
    }
    throw error;
  }
}
async function prepareResources(parsed, host, src) {
  // Wait for the actual release stylesheet before replacing the visible startup shell.
  for (const link of parsed.querySelectorAll('link[rel="stylesheet"]')) {
    const href = link.getAttribute('href');
    const path = href?.slice(host.documentElement.dataset.basePath?.length || 0) || '';
    if (
      !/^\/(?:client\/public\/styles-[A-Z0-9]+\.css|assets\/[a-f0-9]{20}\/styles\.css)$/.test(path)
    )
      throw new Error('Invalid stylesheet');
    if (
      [...host.querySelectorAll('link[rel="stylesheet"]')].some(
        (item) => item.getAttribute('href') === href,
      )
    )
      continue;
    await new Promise((resolve, reject) => {
      const style = host.createElement('link');
      style.rel = 'stylesheet';
      style.href = href;
      const timer = setTimeout(() => {
        style.remove();
        reject(new Error('Stylesheet timeout'));
      }, 8000);
      style.onload = () => {
        clearTimeout(timer);
        resolve();
      };
      style.onerror = () => {
        clearTimeout(timer);
        style.remove();
        reject(new Error('Stylesheet unavailable'));
      };
      host.head.append(style);
    });
  }
  // Fetch the module graph before swapping the shell. modulepreload does not execute the app.
  await new Promise((resolve, reject) => {
    const preload = host.createElement('link');
    preload.rel = 'modulepreload';
    if (!preload.relList?.supports?.('modulepreload')) {
      resolve();
      return;
    }
    preload.href = src;
    const timer = setTimeout(() => {
      preload.remove();
      reject(new Error('Script timeout'));
    }, 8000);
    preload.onload = () => {
      clearTimeout(timer);
      resolve();
    };
    preload.onerror = () => {
      clearTimeout(timer);
      preload.remove();
      reject(new Error('Script unavailable'));
    };
    host.head.append(preload);
  });
}
