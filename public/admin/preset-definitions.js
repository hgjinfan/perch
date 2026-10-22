import { safeUrl } from '../../shared/url.js';
const GiB = 1 / 1073741824;
const repoFields = (stars, issues = 'Issues / PR') => [
  { label: 'Stars', path: stars, unit: '' },
  { label: 'Forks', path: 'forks_count', unit: '' },
  { label: issues, path: 'open_issues_count', unit: '' },
];
const field = (key, label, placeholder = '') => ({ key, label, placeholder });
export const sourcePresets = {
  github: {
    label: 'GitHub · 仓库统计',
    icon: 'github',
    type: 'metrics',
    refresh: 900,
    docs: 'https://docs.github.com/en/rest/repos/repos#get-a-repository',
    note: '公开仓库可免认证；私有仓库或提高限额可使用只读 Token。Issues / PR 为接口返回的合计数量。',
    fields: [field('owner', '仓库所有者', 'glanceapp'), field('repo', '仓库名', 'glance')],
    optionalAuth: true,
    env: 'WIDGET_GITHUB_TOKEN',
    build: (v) => ({
      url: `https://api.github.com/repos/${segment(v.owner)}/${segment(v.repo)}`,
      fields: repoFields('stargazers_count'),
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Perch-Homepage' },
    }),
  },
  gitea: {
    label: 'Gitea · 仓库统计',
    icon: 'git-branch',
    type: 'metrics',
    refresh: 900,
    docs: 'https://docs.gitea.com/api/operations/repo-get/',
    note: '填写 Gitea 站点地址，不含 /api/v1。公开仓库可免认证，私有仓库使用具备仓库读取权限的 Token。',
    fields: [
      field('base', '站点地址', 'https://git.example.com'),
      field('owner', '仓库所有者'),
      field('repo', '仓库名'),
    ],
    optionalAuth: true,
    env: 'WIDGET_GITEA_TOKEN',
    authPrefix: 'token ',
    build: (v) => ({
      url: endpoint(v.base, `/api/v1/repos/${segment(v.owner)}/${segment(v.repo)}`),
      fields: repoFields('stars_count', 'Issues'),
    }),
  },
  immich: {
    label: 'Immich · 媒体统计',
    icon: 'images',
    type: 'metrics',
    refresh: 900,
    docs: 'https://api.immich.app/endpoints/server/getServerStatistics',
    note: '使用管理员创建且拥有 server.statistics 权限的 API Key；统计为整个实例的照片、视频和占用空间。站点地址不含 /api。',
    fields: [field('base', '站点地址', 'https://photos.example.com')],
    env: 'WIDGET_IMMICH_TOKEN',
    authHeader: 'x-api-key',
    authPrefix: '',
    build: (v) => ({
      url: endpoint(v.base, '/api/server/statistics'),
      fields: [
        { label: '照片', path: 'photos', unit: '张' },
        { label: '视频', path: 'videos', unit: '个' },
        { label: '占用', path: 'usage', unit: 'GiB', scale: GiB },
      ],
    }),
  },
  kuma: {
    label: 'Uptime Kuma · 24 小时可用率',
    icon: 'activity',
    type: 'metric',
    refresh: 60,
    docs: 'https://github.com/louislam/uptime-kuma/wiki/API-Documentation',
    note: '需要已发布的公开状态页 slug 和其中的监控 ID。使用状态页 JSON 接口，不需要管理密码；内部接口可能随 Kuma 版本变化。',
    fields: [
      field('base', '站点地址', 'https://status.example.com'),
      field('slug', '状态页 slug', 'default'),
      field('monitor', '监控 ID', '1'),
    ],
    build: (v) => {
      if (!/^\d{1,12}$/.test(v.monitor || '')) throw new Error('监控 ID 必须是数字');
      return {
        url: endpoint(v.base, `/api/status-page/heartbeat/${segment(v.slug)}`),
        mapping: { value: `uptimeList.${v.monitor}_24` },
        scale: 100,
        unit: '%',
      };
    },
  },
  nezha: {
    label: 'Nezha · 新版服务器列表',
    icon: 'server',
    type: 'list',
    refresh: 300,
    docs: 'https://nezha.wiki/en_US/guide/api',
    note: '适用于 GET /api/v1/server 返回 success/data 的新版面板。使用 Bearer Token（PAT 需 inventory:read 权限）；只显示名称和 ID，不展示 IP。此接口为清单，不是实时资源状态。',
    fields: [field('base', '站点地址', 'https://nezha.example.com')],
    env: 'WIDGET_NEZHA_TOKEN',
    build: (v) => ({
      url: endpoint(v.base, '/api/v1/server'),
      mapping: { items: 'data', label: 'name', detail: 'id' },
    }),
  },
  'nezha-legacy': {
    label: 'Nezha · 旧版服务器指标',
    icon: 'server',
    type: 'metrics',
    refresh: 60,
    docs: 'https://nezha-v0.mereith.dev/guide/api',
    note: '仅适用于旧版 /api/v1/server/details 返回 result 数组、status.CPU 等字段的面板。填写固定服务器 ID，Token 直接放入 Authorization，不带 Bearer。',
    fields: [
      field('base', '站点地址', 'https://nezha.example.com'),
      field('server', '服务器 ID', '1'),
    ],
    env: 'WIDGET_NEZHA_LEGACY_TOKEN',
    authPrefix: '',
    build: (v) => {
      if (!/^\d{1,12}$/.test(v.server || '')) throw new Error('服务器 ID 必须是数字');
      return {
        url: endpoint(v.base, `/api/v1/server/details?id=${v.server}`),
        fields: [
          { label: 'CPU', path: 'result.0.status.CPU', unit: '%' },
          { label: '内存使用', path: 'result.0.status.MemUsed', unit: 'GiB', scale: GiB },
          { label: '磁盘使用', path: 'result.0.status.DiskUsed', unit: 'GiB', scale: GiB },
        ],
      };
    },
  },
};
function segment(value) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 100 ||
    /[\s/\\?#]/.test(value) ||
    ['.', '..'].includes(value)
  )
    throw new Error('请填写有效的名称或标识，不包含路径或查询参数');
  return encodeURIComponent(value);
}
function endpoint(base, path) {
  const safe = safeUrl(base);
  if (!safe) throw new Error('请填写有效的 HTTP(S) 站点地址，不包含账号密码');
  const url = new URL(safe);
  if (url.search || url.hash) throw new Error('站点地址不能包含查询参数或锚点');
  return safe.replace(/\/+$/, '') + path;
}
export function buildPreset(key, values, id) {
  const preset = Object.hasOwn(sourcePresets, key) ? sourcePresets[key] : null;
  if (!preset) throw new Error('请选择数据源预设');
  const v = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      typeof value === 'string' ? value.trim() : '',
    ]),
  );
  for (const f of preset.fields) if (!v[f.key]) throw new Error(`请填写${f.label}`);
  const built = preset.build(v),
    headers = { ...built.headers };
  if (preset.env && (!preset.optionalAuth || v.auth === 'env')) {
    if (!/^WIDGET_[A-Z0-9_]+$/.test(v.env || ''))
      throw new Error('密钥变量名须以 WIDGET_ 开头，仅包含大写字母、数字和下划线');
    headers[preset.authHeader || 'Authorization'] =
      (preset.authPrefix ?? 'Bearer ') + '${' + v.env + '}';
  }
  return {
    id,
    title: v.title || preset.label,
    icon: preset.icon,
    description: '',
    type: preset.type,
    refresh: preset.refresh,
    limit: 5,
    decimals: built.scale === 100 ? 2 : preset.type === 'list' ? 0 : 1,
    threshold: null,
    unit: built.unit || '',
    scale: built.scale || 1,
    fields: built.fields || [],
    mapping: built.mapping || {},
    source: { kind: 'api', method: 'GET', url: built.url, headers },
  };
}
