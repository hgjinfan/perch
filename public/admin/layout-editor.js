import {
  layoutEntries,
  reconcileGroups,
  effectiveColumns,
  effectiveSpan,
} from '../../shared/layout.js';
import { node } from '../core/dom.js';

export function mountLayoutEditor(target, config) {
  const groups = reconcileGroups(config),
    names = new Map(layoutEntries(config).map((e) => [e.id, e.title]));
  let dragging;
  let previewMode = target.dataset.previewMode || 'desktop';
  const previews = [];
  const modeButtons = [];
  const button = (label, action, disabled = false) => {
    const b = node('button', label);
    b.type = 'button';
    b.disabled = disabled;
    b.onclick = action;
    return b;
  };
  const select = (label, choices, value, change) => {
    const wrap = node('label', label),
      control = node('select');
    for (const [key, title] of choices) {
      const option = node('option', title);
      option.value = key;
      control.append(option);
    }
    control.value = String(value);
    control.onchange = () => change(control.value);
    wrap.append(control);
    return wrap;
  };
  function redraw(focusId) {
    mountLayoutEditor(target, config);
    if (focusId)
      [...target.querySelectorAll('button[data-move]')]
        .find((b) => b.dataset.move === focusId)
        ?.focus();
  }
  function move(group, item, to, before) {
    group.items.splice(group.items.indexOf(item), 1);
    const index = before ? to.items.indexOf(before) : to.items.length;
    to.items.splice(index < 0 ? to.items.length : index, 0, item);
    redraw(item.id);
  }
  target.replaceChildren();
  const toolbar = node('div');
  toolbar.className = 'layout-preview-toolbar';
  toolbar.append(node('span', '宽度预览'));
  for (const [mode, label] of [
    ['desktop', '桌面'],
    ['tablet', '平板'],
    ['phone', '手机'],
  ]) {
    const b = button(label, () => {
      previewMode = mode;
      target.dataset.previewMode = mode;
      for (const entry of modeButtons)
        entry.button.setAttribute('aria-pressed', String(entry.mode === mode));
      for (const draw of previews) draw();
    });
    b.setAttribute('aria-pressed', String(mode === previewMode));
    modeButtons.push({ mode, button: b });
    toolbar.append(b);
  }
  target.append(toolbar);
  groups.forEach((group, index) => {
    const section = node('section');
    section.className = 'layout-group-editor';
    section.dataset.groupEditor = group.id;
    const header = node('div');
    header.className = 'layout-group-tools';
    const label = node('label', '分组名称'),
      title = node('input');
    title.value = group.title;
    title.maxLength = 80;
    title.placeholder = '留空不显示标题';
    title.oninput = () => (group.title = title.value);
    label.append(title);
    header.append(label);
    header.append(
      select(
        '列数',
        [1, 2, 3, 4].map((n) => [n, `${n} 列`]),
        group.columns,
        (value) => {
          group.columns = Number(value);
          redraw();
        },
      ),
    );
    for (const [offset, caption] of [
      [-1, '分组上移'],
      [1, '分组下移'],
    ])
      header.append(
        button(
          caption,
          () => {
            [groups[index], groups[index + offset]] = [groups[index + offset], groups[index]];
            redraw();
          },
          !groups[index + offset],
        ),
      );
    header.append(
      button(
        '移除分组',
        () => {
          const destination = groups[index === 0 ? 1 : 0];
          destination.items.push(...group.items);
          groups.splice(index, 1);
          redraw();
        },
        groups.length === 1,
      ),
    );
    section.append(header);
    const preview = node('div');
    preview.className = 'layout-width-preview';
    preview.setAttribute('aria-label', '磁块宽度示意');
    const caption = node('p');
    caption.className = 'field-help';
    section.append(caption, preview);
    function drawPreview() {
      const columns = effectiveColumns(group.columns, previewMode);
      preview.dataset.columns = columns;
      preview.replaceChildren();
      caption.textContent = `${{ desktop: '桌面', tablet: '平板', phone: '手机' }[previewMode]} · ${columns} 列。仅示意宽度，实际高度随内容变化；点击磁块可定位宽度设置。`;
      for (const item of group.items) {
        if (config.layout.hidden.includes(item.id)) continue;
        const width = effectiveSpan(item.span, columns);
        const tile = button('', () => {
          const row = [...list.querySelectorAll('[data-layout-item]')].find(
            (n) => n.dataset.layoutItem === item.id,
          );
          const control = row?.querySelector('[data-tile-width]');
          control?.scrollIntoView({ block: 'center' });
          control?.focus({ preventScroll: true });
        });
        tile.className = 'layout-preview-tile';
        tile.dataset.span = item.span;
        tile.dataset.previewItem = item.id;
        tile.append(
          node('span', names.get(item.id)),
          node(
            'small',
            `${item.span === 'full' ? '整行' : `${item.span} 列`} · 当前 ${width}/${columns}`,
          ),
        );
        preview.append(tile);
      }
      if (!preview.children.length) preview.append(node('p', '本组没有可见磁块。'));
    }
    previews.push(drawPreview);
    const list = node('div');
    list.className = 'layout-tile-list';
    list.ondragover = (event) => {
      if (dragging) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      }
    };
    list.ondrop = (event) => {
      if (!dragging) return;
      event.preventDefault();
      const beforeId = event.target.closest('[data-layout-item]')?.dataset.layoutItem;
      const before = group.items.find((i) => i.id === beforeId);
      if (before === dragging.item) return;
      move(dragging.group, dragging.item, group, before);
    };
    group.items.forEach((item, position) => {
      const row = node('div');
      row.className = 'layout-tile';
      row.dataset.layoutItem = item.id;
      const handle = button('⠿', () => {});
      handle.className = 'tile-drag-handle';
      handle.draggable = true;
      handle.setAttribute('aria-label', `拖动 ${names.get(item.id)}`);
      handle.title = '拖动到目标磁块前，或分组底部';
      handle.ondragstart = (event) => {
        dragging = { group, item };
        event.dataTransfer.setData('text/plain', item.id);
        event.dataTransfer.effectAllowed = 'move';
        row.classList.add('dragging');
      };
      handle.ondragend = () => {
        dragging = null;
        row.classList.remove('dragging');
      };
      row.append(handle);
      const name = node('span', names.get(item.id));
      name.className = 'layout-tile-name';
      row.append(name);
      row.append(
        select(
          '分组',
          groups.map((g) => [g.id, g.title || '未命名分组']),
          group.id,
          (id) => {
            if (id !== group.id)
              move(
                group,
                item,
                groups.find((g) => g.id === id),
              );
          },
        ),
      );
      row.append(
        select(
          '宽度',
          [
            [1, '1 列'],
            [2, '2 列'],
            [3, '3 列'],
            [4, '4 列'],
            ['full', '整行 · 随分组宽度'],
          ],
          item.span,
          (value) => {
            item.span = value === 'full' ? 'full' : Number(value);
            drawPreview();
          },
        ),
      );
      const widthControl = row.querySelectorAll('select')[1];
      widthControl.dataset.tileWidth = item.id;
      widthControl.setAttribute('aria-label', `${names.get(item.id)}宽度`);
      for (const [offset, caption] of [
        [-1, '上移'],
        [1, '下移'],
      ]) {
        const b = button(
          caption,
          () => {
            [group.items[position], group.items[position + offset]] = [
              group.items[position + offset],
              group.items[position],
            ];
            redraw(item.id);
          },
          !group.items[position + offset],
        );
        b.setAttribute('aria-label', `${caption} ${names.get(item.id)}`);
        if (offset === -1) b.dataset.move = item.id;
        row.append(b);
      }
      const label = node('label', '显示'),
        visible = node('input');
      visible.type = 'checkbox';
      visible.checked = !config.layout.hidden.includes(item.id);
      visible.onchange = () => {
        config.layout.hidden = visible.checked
          ? config.layout.hidden.filter((id) => id !== item.id)
          : [...new Set([...config.layout.hidden, item.id])];
        drawPreview();
      };
      label.append(visible);
      row.append(label);
      list.append(row);
    });
    const hint = node(
      'p',
      group.items.length
        ? '拖到这里可放在本组末尾'
        : '此分组为空，可拖入磁块或通过“分组”选择移入。',
    );
    hint.className = 'layout-drop-hint';
    list.append(hint);
    section.append(list);
    drawPreview();
    target.append(section);
  });
  target.append(
    button(
      '＋ 添加分组',
      () => {
        groups.push({
          id: `group-${crypto.randomUUID().slice(0, 8)}`,
          title: '新分组',
          columns: 3,
          items: [],
        });
        redraw();
      },
      groups.length >= 12,
    ),
  );
}
