import { phoneOrder } from '../../shared/phone-layout.js';
import { describeModules, renderModule } from './modules.js';
import { validateGroups } from '../../shared/layout.js';
import { text } from './html.js';
export function renderGroups(config) {
  const phone = config.layout.phone;
  const order = phoneOrder(config);
  const modules = new Map(describeModules(config).map((m) => [m.id, m]));
  return validateGroups(config.layout.groups, config)
    .map((group) => {
      const items = group.items.filter((item) => modules.has(item.id));
      if (!items.length) return '';
      const body = items
        .map((item) =>
          renderModule(modules.get(item.id)).replace(
            'class="tile module',
            `data-span="${item.span}"${phone?.enabled ? ` data-phone-order="${order.indexOf(item.id)}" data-phone-hidden="${phone.hidden.includes(item.id)}"${phone.limits[item.id] ? ` data-phone-limit="${phone.limits[item.id]}"` : ''}` : ''} class="tile module`,
          ),
        )
        .join('');
      const named = Boolean(group.title.trim());
      return `<${named ? 'details' : 'section'} class="board-group" data-group="${text(group.id)}"${named ? ` open aria-label="${text(group.title)}"` : ''}>${named ? `<summary class="group-toggle"><h2 class="group-title">${text(group.title)}</h2></summary>` : ''}<div class="content-board" data-columns="${group.columns}">${body}</div></${named ? 'details' : 'section'}>`;
    })
    .join('');
}
