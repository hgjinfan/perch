import { normalizeFeedFilters, parseFeedKeywords } from '../../shared/feed-filters.js';
import { createFieldEditor } from './fields.js';
import { node } from '../core/dom.js';

export function mountFeedFilters(row, feed, drafts) {
  feed.filters ||= normalizeFeedFilters();
  const section = node('details');
  section.className = 'feed-filters';
  section.append(node('summary', '筛选与排序'));
  section.append(
    node(
      'p',
      '只匹配文章标题，不区分大小写；多个关键词用换行或逗号分隔，排除规则优先。筛选、去重后再取显示条数。',
    ),
  );
  const input = createFieldEditor(section, { drafts, prefix: 'feed:' + feed.id });
  for (const [key, label] of [
    ['include', '包含关键词'],
    ['exclude', '排除关键词'],
  ])
    input(
      label,
      feed.filters[key].join('\n'),
      (text, control) => {
        try {
          const filters = normalizeFeedFilters({ ...feed.filters, [key]: parseFeedKeywords(text) });
          feed.filters = filters;
        } catch (error) {
          control.setCustomValidity(error.message);
        }
      },
      { multiline: true, hint: '最多 20 个，每个最多 80 字符；按普通文本匹配，不使用正则表达式。' },
    );
  input('包含条件', feed.filters.match, (value) => (feed.filters.match = value), {
    options: { any: '匹配任一关键词', all: '匹配全部关键词' },
  });
  input('文章排序', feed.filters.sort, (value) => (feed.filters.sort = value), {
    options: { source: '保留来源顺序', newest: '最新文章优先（无日期排最后）' },
  });
  input(
    '重复文章',
    String(feed.filters.deduplicate),
    (value) => (feed.filters.deduplicate = value === 'true'),
    { options: { false: '保留重复（默认）', true: '相同链接去重（忽略 # 片段）' } },
  );
  section.querySelector('p').className = 'field-help';
  row.append(section);
}
