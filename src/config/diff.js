// Summarize changes without returning credentials, raw API data or sensitive values.
export function compareConfigs(current, incoming) {
  const changes = [];
  let truncated = false;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  let work = 0;
  function walk(a, b, path = '', depth = 0) {
    if (++work > 1000 || depth > 10) {
      truncated = true;
      return;
    }
    if (same(a, b)) return;
    if (changes.length >= 100) {
      truncated = true;
      return;
    }
    const sensitive =
      /(?:^|\.)(source|headers|body|data|url|healthUrl|mapping|fields)(?:\.|$)/.test(path);
    if (
      !sensitive &&
      a &&
      b &&
      typeof a === 'object' &&
      typeof b === 'object' &&
      !Array.isArray(a) &&
      !Array.isArray(b)
    ) {
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)]))
        walk(a[key], b[key], path ? `${path}.${key}` : key, depth + 1);
      return;
    }
    if (
      !sensitive &&
      Array.isArray(a) &&
      Array.isArray(b) &&
      [...a, ...b].every((item) => item && typeof item.id === 'string')
    ) {
      const left = new Map(a.map((item) => [item.id, item])),
        right = new Map(b.map((item) => [item.id, item]));
      if (
        !same(
          a.map((item) => item.id),
          b.map((item) => item.id),
        )
      )
        changes.push({
          path: `${path}.顺序`,
          action: 'changed',
          before: '原顺序',
          after: '新顺序',
        });
      for (const key of new Set([...left.keys(), ...right.keys()]))
        walk(left.get(key), right.get(key), `${path}[${key}]`, depth + 1);
      return;
    }
    if (!sensitive && Array.isArray(a) && Array.isArray(b)) {
      for (let index = 0; index < Math.max(a.length, b.length); index++)
        walk(a[index], b[index], `${path}[${index + 1}]`, depth + 1);
      return;
    }
    const display = (value) => {
      if (value === undefined) return '—';
      if (sensitive) return '内容已隐藏';
      if (value && typeof value === 'object')
        return String(value.title || value.name || '内容已隐藏').slice(0, 160);
      if (value === null) return '空';
      return String(value).slice(0, 160);
    };
    changes.push({
      path,
      action: a === undefined ? 'added' : b === undefined ? 'removed' : 'changed',
      before: display(a),
      after: display(b),
    });
  }
  walk(current, incoming);
  return { changes: changes.slice(0, 100), truncated };
}
