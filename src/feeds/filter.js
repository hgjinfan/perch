import { normalizeFeedFilters } from '../../shared/feed-filters.js';

export function selectFeedEntries(entries, limit, filters) {
  const options = normalizeFeedFilters(filters);
  const words = (key) => options[key].map((word) => word.toLowerCase());
  const include = words('include'),
    exclude = words('exclude');
  const seen = new Set();
  const selected = entries.filter((entry) => {
    const title = entry.title.normalize('NFKC').toLowerCase();
    if (exclude.some((word) => title.includes(word))) return false;
    if (
      include.length &&
      !(options.match === 'all'
        ? include.every((word) => title.includes(word))
        : include.some((word) => title.includes(word)))
    )
      return false;
    return true;
  });
  if (options.sort === 'newest')
    selected.sort((a, b) => {
      const left = a.date ? Date.parse(a.date) : -Infinity,
        right = b.date ? Date.parse(b.date) : -Infinity;
      return left === right ? 0 : left > right ? -1 : 1;
    });
  const unique = options.deduplicate
    ? selected.filter((entry) => {
        const url = new URL(entry.url);
        url.hash = '';
        if (seen.has(url.href)) return false;
        seen.add(url.href);
        return true;
      })
    : selected;
  return unique.slice(0, Math.max(1, Math.min(20, Number(limit) || 5)));
}
