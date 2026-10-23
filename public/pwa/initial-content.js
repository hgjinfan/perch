import { parseFragment, applyFragment } from '../home/fragment-content.js';
import { weatherFragmentUrl } from '../home/weather.js';

// Keep the single launch skeleton visible for a short bounded prefetch window.
export async function hydrateInitialContent(
  parsed,
  { fetcher = fetch, waitMs = 900, concurrency = 4 } = {},
) {
  const nodes = [...parsed.querySelectorAll('[data-module][data-fragment]')];
  if (!nodes.length) return;
  const tiles = new Map(
    [...parsed.querySelectorAll('[data-service]')].map((tile) => [tile.dataset.service, tile]),
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), waitMs);
  let index = 0,
    changed = false;
  try {
    await Promise.all(
      Array.from({ length: Math.min(concurrency, nodes.length) }, async () => {
        while (index < nodes.length && !controller.signal.aborted) {
          const node = nodes[index++],
            content = node.querySelector('.module-content');
          const module = { node, content };
          try {
            const path =
              node.dataset.module === 'weather'
                ? weatherFragmentUrl(node.dataset.fragment)
                : node.dataset.fragment;
            const response = await fetcher(path, {
              signal: controller.signal,
              credentials: 'omit',
            });
            if (response.status === 409 && response.headers.get('x-homepage-reload') === '1')
              changed = true;
            if (!response.ok || !response.headers.get('content-type')?.includes('text/html'))
              continue;
            const fragment = parseFragment(await response.text(), parsed);
            if (controller.signal.aborted) continue;
            applyFragment(module, fragment, tiles);
            node.dataset.initialHydrated = 'true';
            content.dataset.loadState = 'ready';
            content.setAttribute('aria-busy', 'false');
            const update = node.querySelector('.module-update');
            if (update) update.hidden = true;
          } catch {
            /* A slow or unavailable tile must not block the usable homepage. */
          }
        }
      }),
    );
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  if (changed) throw new Error('Configuration changed during startup');
  for (const node of nodes) {
    if (node.dataset.initialHydrated === 'true' || node.dataset.module === 'status') continue;
    const content = node.querySelector('.module-content');
    const pending = parsed.createElement('p');
    pending.className = 'initial-module-loading';
    pending.textContent = '加载中…';
    pending.setAttribute('role', 'status');
    content.replaceChildren(pending);
    content.dataset.initialPending = 'true';
  }
}
