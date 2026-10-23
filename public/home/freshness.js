function relativeTime(date, now = Date.now()) {
  const age = Math.max(0, now - date.getTime());
  if (age < 60_000) return '刚刚';
  if (age < 3_600_000) return `${Math.floor(age / 60_000)} 分钟前`;
  if (age < 86_400_000) return `${Math.floor(age / 3_600_000)} 小时前`;
  return `${Math.floor(age / 86_400_000)} 天前`;
}

export function updateFreshness(root = document, now = Date.now()) {
  for (const element of root.querySelectorAll('[data-freshness][datetime]')) {
    const date = new Date(element.dateTime);
    if (!Number.isFinite(date.getTime())) continue;
    const stale = element.classList.contains('stale');
    const exact = date.toLocaleString('zh-CN', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    element.textContent = `${stale ? '数据较旧 · 上次成功' : '状态正常 · 更新于'} ${relativeTime(date, now)}`;
    element.title = `最后成功更新时间：${exact}`;
  }
}
