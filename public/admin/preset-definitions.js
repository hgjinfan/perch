import { safeUrl } from '../../shared/url.js';
const GiB = 1 / 1073741824;
const repoFields = (stars, issues = 'Issues / PR') => [
  { label: 'Stars', path: stars, unit: '' },
  { label: 'Forks', path: 'forks_count', unit: '' },
  { label: issues, path: 'open_issues_count', unit: '' },
];
const field = (key, label, placeholder = '', options = {}) => ({
  key,
  label,
  placeholder,
  ...options,
});
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
export const additionalSourcePresets = {
  'home-assistant-sensor': {
    category: '家庭自动化',
    label: 'Home Assistant · 传感器',
    icon: 'house',
    type: 'metric',
    refresh: 60,
    docs: 'https://developers.home-assistant.io/docs/api/rest/',
    note: '读取一个数值型实体的当前状态。长期访问令牌只通过服务器环境变量提供；请只选择适合公开展示的实体。',
    fields: [
      field('base', '站点地址', 'https://home.example.com'),
      field('entity', '实体 ID', 'sensor.temperature'),
      field('unit', '单位（可选）', '°C', { required: false }),
    ],
    env: 'WIDGET_HOME_ASSISTANT_TOKEN',
    build: (v) => {
      if (!/^[a-z0-9_]+\.[a-z0-9_]+$/i.test(v.entity || ''))
        throw new Error('实体 ID 格式应为 domain.object_id');
      return {
        url: endpoint(v.base, `/api/states/${segment(v.entity)}`),
        mapping: { value: 'state' },
        unit: v.unit || '',
      };
    },
  },
  'proxmox-node': {
    category: '服务器与虚拟化',
    label: 'Proxmox VE · 节点资源',
    icon: 'server',
    type: 'metrics',
    refresh: 60,
    docs: 'https://pve.proxmox.com/pve-docs/api-viewer/',
    note: '读取单个节点的 CPU、内存和根分区已用量。创建只读 API Token，并在权限中授予该节点的 Sys.Audit；Token Secret 放在 WIDGET_ 环境变量中。',
    fields: [
      field('base', '站点地址', 'https://pve.example.com:8006'),
      field('user', 'API 用户', 'monitoring@pve'),
      field('tokenId', 'Token ID', 'perch'),
      field('node', '节点名称', 'pve1'),
    ],
    env: 'WIDGET_PROXMOX_TOKEN',
    authHeader: 'Authorization',
    authPrefix: (v) => `PVEAPIToken=${v.user}!${v.tokenId}=`,
    build: (v) => {
      if (!/^[\w.-]+@[\w.-]+$/.test(v.user || '') || !/^[\w.-]+$/.test(v.tokenId || ''))
        throw new Error('请检查 API 用户和 Token ID 格式');
      return {
        url: endpoint(v.base, `/api2/json/nodes/${segment(v.node)}/status`),
        fields: [
          { label: 'CPU', path: 'data.cpu', unit: '%', scale: 100 },
          { label: '内存已用', path: 'data.memory.used', unit: 'GiB', scale: GiB },
          { label: '根分区已用', path: 'data.rootfs.used', unit: 'GiB', scale: GiB },
        ],
      };
    },
  },
  prometheus: {
    category: '监控与指标',
    label: 'Prometheus · PromQL 指标',
    icon: 'activity',
    type: 'metric',
    refresh: 60,
    docs: 'https://prometheus.io/docs/prometheus/latest/querying/api/',
    note: '执行即时 PromQL 查询并读取第一条结果。建议使用返回单个序列的表达式，如 sum(up)；单位按查询结果设置。不要查询不适合公开展示的指标。',
    fields: [
      field('base', '站点地址', 'https://prometheus.example.com'),
      field('query', 'PromQL 查询', 'sum(up)'),
      field('unit', '单位（可选）', '', { required: false }),
    ],
    optionalAuth: true,
    env: 'WIDGET_PROMETHEUS_TOKEN',
    build: (v) => {
      if (!v.query || v.query.length > 500) throw new Error('PromQL 查询不能为空且最多 500 字符');
      const url = new URL(endpoint(v.base, '/api/v1/query'));
      url.searchParams.set('query', v.query);
      return {
        url: url.toString(),
        mapping: { value: 'data.result.0.value.1' },
        unit: v.unit || '',
      };
    },
  },
  'jellyfin-version': {
    category: '媒体服务',
    label: 'Jellyfin · 服务器版本',
    icon: 'clapperboard',
    type: 'text',
    refresh: 3600,
    docs: 'https://api.jellyfin.org/',
    note: '读取 Jellyfin 公开系统信息中的版本号，不需要 API Key。此预设只展示版本，不读取媒体库或用户数据。',
    fields: [field('base', '站点地址', 'https://media.example.com')],
    build: (v) => ({
      url: endpoint(v.base, '/System/Info/Public'),
      mapping: { text: 'Version' },
    }),
  },
};
export const catalogPresets = { ...sourcePresets, ...additionalSourcePresets };
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
  const preset = Object.hasOwn(catalogPresets, key) ? catalogPresets[key] : null;
  if (!preset) throw new Error('请选择数据源预设');
  const v = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      typeof value === 'string' ? value.trim() : '',
    ]),
  );
  for (const f of preset.fields)
    if (f.required !== false && !v[f.key]) throw new Error(`请填写${f.label}`);
  const built = preset.build(v),
    headers = { ...built.headers };
  if (preset.env && (!preset.optionalAuth || v.auth === 'env')) {
    if (!/^WIDGET_[A-Z0-9_]+$/.test(v.env || ''))
      throw new Error('密钥变量名须以 WIDGET_ 开头，仅包含大写字母、数字和下划线');
    const prefix =
      typeof preset.authPrefix === 'function'
        ? preset.authPrefix(v)
        : (preset.authPrefix ?? 'Bearer ');
    headers[preset.authHeader || 'Authorization'] = prefix + '${' + v.env + '}';
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
