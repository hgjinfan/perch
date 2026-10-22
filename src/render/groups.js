import { describeModules, renderModule } from './modules.js';
import { validateGroups } from '../../shared/layout.js';
import { text } from './html.js';
export function renderGroups(config) {
  const modules = new Map(describeModules(config).map((m) => [m.id, m]));
  return validateGroups(config.layout.groups, config)
    .map((group) => {
      const items = group.items.filter((item) => modules.has(item.id));
      if (!items.length) return '';
      const body = items
        .map((item) =>
          renderModule(modules.get(item.id)).replace(
            'class="tile module',
            `data-span="${item.span}" class="tile module`,
          ),
        )
        .join('');
      return `<section class="board-group" data-group="${text(group.id)}"${group.title.trim() ? ` aria-label="${text(group.title)}"` : ''}>${group.title.trim() ? `<h2 class="group-title">${text(group.title)}</h2>` : ''}<div class="content-board" data-columns="${group.columns}">${body}</div></section>`;
    })
    .join('');
}
