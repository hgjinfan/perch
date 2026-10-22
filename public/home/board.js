import { createModuleState } from './loading.js';

// Mount server-owned markup; the browser never interprets the site's configuration.
export function mountModules(board) {
  const modules = new Map(),
    serviceTiles = new Map();
  for (const node of board.querySelectorAll('[data-module]')) {
    const module = { node, content: node.querySelector('.module-content') };
    if (node.dataset.fragment) module.loading = createModuleState(module);
    modules.set(node.dataset.module, module);
  }
  for (const tile of board.querySelectorAll('[data-service]'))
    serviceTiles.set(tile.dataset.service, tile);
  return { modules, serviceTiles };
}
