const defaults = { include: [], exclude: [], match: 'any', sort: 'source', deduplicate: false };
export function normalizeFeedFilters(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('订阅筛选格式无效');
  const keywords = (key) => {
    const values = value[key] ?? [];
    if (
      !Array.isArray(values) ||
      values.length > 20 ||
      values.some(
        (word) =>
          typeof word !== 'string' ||
          word.length > 80 ||
          !word.trim() ||
          /[\u0000-\u001f\u007f]/.test(word),
      )
    )
      throw new Error('筛选关键词最多 20 个，每个 1–80 字符');
    const seen = new Set();
    const normalized = values.map((word) => word.trim().normalize('NFKC'));
    if (normalized.some((word) => word.length > 80))
      throw new Error('规范化后的关键词最多 80 字符');
    return normalized.filter((word) => {
      const key = word.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  const result = {
    ...defaults,
    ...value,
    include: keywords('include'),
    exclude: keywords('exclude'),
  };
  if (
    !['any', 'all'].includes(result.match) ||
    !['source', 'newest'].includes(result.sort) ||
    typeof result.deduplicate !== 'boolean'
  )
    throw new Error('订阅匹配方式、排序或去重设置无效');
  return {
    include: result.include,
    exclude: result.exclude,
    match: result.match,
    sort: result.sort,
    deduplicate: result.deduplicate,
  };
}
export function parseFeedKeywords(text) {
  return text
    .split(/[\n,，]/)
    .map((word) => word.trim())
    .filter(Boolean);
}
