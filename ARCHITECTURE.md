# 代码结构与扩展约定

这是一个原生 ES Modules 项目。Node.js 提供 HTTP 服务与 HTML 渲染，esbuild 负责生产客户端压缩、拆包和内容哈希；开发模式直接加载原生模块。新增能力优先放入所属领域，而不是继续增加入口文件的分支。

## 模块边界

```text
src/
  server.js                 环境与启动，不包含路由或业务逻辑
  application.js            依赖组装、HTTP 服务工厂与统一错误处理
  http.js                   响应、请求体限制、请求方法与同源校验
  security.js               管理员认证与登录限流
  assets.js                 静态资源索引及管理资源权限分类
  routes/
    admin.js                管理接口与预览入口
    public.js               公开接口分发
  config/
    schema.js               配置校验及旧配置默认值
    store.js                加载、原子保存、并发保护和修订号
    visibility.js           可见模块的服务端访问规则
  render/
    html.js                 文本/属性转义、安全链接、HTML 响应
    page.js                 初次首页 HTML 与服务入口
    modules.js              模块描述、框架与数据片段模板
    skeleton.js             各模板的服务端骨架
    widgets.js              自定义磁块模板，正式展示与管理预览共用
    services.js             服务入口与状态槽位模板
  services/dashboard.js     RSS、天气、服务与磁块的数据获取及缓存
  widgets/
    schema.js               磁块配置与数据源校验
    source.js               API 请求、密钥变量、限制与结果映射
  widgets.js                磁块领域的稳定导出入口
  data.js                   订阅解析、远程读取、缓存与可用性检测
  admin.js                  原有认证/校验导出的兼容入口
shared/
  url.js                    前后端共同的 URL 规则
  widget-types.js            类型元数据、编辑能力、默认映射及纯数据转换
public/
  app.js                    首页装配与生命周期
  home/board.js             挂载服务端 DOM，建立模块/服务节点索引
  home/loaders.js           通用 HTML 片段加载、局部替换与错误状态
  core/api.js               HTML 片段请求与管理员 JSON 请求
  core/dom.js               文本节点、安全链接、图标、空态
  core/preferences.js       个人主题与服务器布局偏好
  core/scheduler.js         独立的刷新调度、并发去重
  admin.js                  管理页配置编辑与保存流程
  admin/fields.js           表单控件创建
  admin/widget-source.js    手动/API 数据源编辑
  admin/widget-preview.js   未保存配置的测试与预览
  widget-editor.js          按类型定义组装磁块编辑表单
```

`shared` 仅包含不依赖 DOM、Node.js 或服务器密钥的纯逻辑。类型定义供服务端与管理编辑器使用，HTTP 读取需要管理员认证。公开首页不再加载类型定义或配置。认证信息、上游 API 请求和持久化只放在服务端。

## 新增一种磁块

1. 在 `shared/widget-types.js` 注册类型：名称、示例数据、默认映射、编辑能力和 `map()`。`map()` 只返回展示需要的字段；不要把整个上游响应直接转发。
2. 在 `src/render/widgets.js` 的 `widgetRenderers` 注册服务端模板。通过 `text()` 转义文本/属性，通过 `link()` 校验链接；只有经过模板组合的 HTML 可以作为片段返回。
3. 增加类型的映射测试。注册表契约测试会检查每个类型都具有渲染器，且示例能通过校验与映射。
4. 若需要全新的配置字段而不是现有单位/条数等能力，同时扩展 `widgets/schema.js` 和编辑器。新增类型不应修改认证、路由或定时器。

现有类型共用 HTTP JSON 和手动数据源。新增数据源协议应扩展服务端 `widgets/source.js` 及对应编辑表单，不应把认证逻辑移入浏览器。

## 新增内置模块

在数据服务中实现数据获取及缓存，在 `src/render/modules.js` 增加模块描述、初始框架和片段模板，在片段路由中接入数据。通用前端按服务端 DOM 的 `data-fragment` 和 `data-refresh` 自动挂载，不需要新增客户端渲染器。模块隐藏标识仍需在配置校验与管理页登记。

## 配置与安全

- `store.save()` 校验并持久化后才替换内存配置和增加修订号；失败保留旧配置。
- 数据服务按来源配置指纹保留 RSS/磁块缓存；地址、认证、映射、条数或刷新间隔变化仅淘汰受影响来源，标题与布局调整不延长有效期。隐藏或删除来源会移除其缓存。服务聚合状态和管理员天气诊断仍按修订号重建；路由不负责缓存管理。
- 公开页面只接收服务端渲染结果，不返回配置 JSON。模块描述和数据映射只在服务端参与渲染；仅更新地址、标识和间隔进入 DOM。
- `/admin/*` 内的前端模块与管理页面同样需要认证。新增前端管理专用文件放在 `public/admin/`。
- 资源路由只服务启动时索引到的 HTML/CSS/JS/SVG，不拼接请求路径访问任意文件。
- 配置文件和环境变量保持兼容；旧的公开 JSON 接口已移除，更新由 `/fragments/` HTML 接口承接。容器包含 `shared/`，生产安装不需要 Prettier。

## 验证与格式

```sh
npm run format        # 统一 JS、CSS、HTML、JSON 与文档格式
npm run format:check  # 检查格式
npm run check         # 自动遍历源码和测试进行语法检查
npm test
```

`createApplication()` 不启动监听，接受配置存储、上游 fetch 和环境变量；测试可使用临时端口和模拟上游，不请求真实服务。配置存储可注入持久化实现以验证失败恢复，调度器和认证限流可注入时钟。现有子进程测试继续验证完整启动流程。

前端视觉和交互还需要浏览器检查；语法检查及后端集成测试不能替代页面验证。目前仍使用 JavaScript，尚未加入 TypeScript 类型检查。

## 首屏、片段与离线边界

首个 HTML 请求不抓取上游数据，直接输出静态入口、模块标题、骨架及更新钩子。每个动态模块之后独立请求 HTML 片段。外层模块、标题旁的状态和天气选城控件不随内容一起替换。服务器配置在上游等待期间变化时，不返回旧配置生成的片段。

HTML 与 JSON 采用同一认证/同源检查框架。HTML 片段由服务端模板转义，客户端仅接受 `text/html` 和约定的结果根节点。管理员预览直接使用同一磁块渲染器，不保留第二套前端渲染实现。

PWA 只缓存静态资源与通用 `/launch.html`、`/offline.html`。动态首页与 `/fragments/` 不写入 Cache Storage，避免保存个性化位置与业务数据；测试同时覆盖旧缓存清理及离线导航回退。

服务状态是顶部 `.service-region` 的动态部分，不在内容区模块描述中重复创建卡片。通用加载器对该片段只替换 `[data-service-state-slot]`，保留服务链接 DOM；状态错误提示使用独立反馈区。

## Review 修复后的约束

- `scripts/build.mjs` 分别构建公开与管理资源，防止私有模块进入公开分块；`built-assets.js` 仅服务构建清单中的文件。公开内容哈希资源长期缓存，管理资源认证且 no-store。开发模式由 `asset-version.js` 改写原生依赖图。两种模式都由 `pwa.js` 生成同版离线清单，版本片段仅接受当前发布版本。
- PWA 区分允许缓存的静态清单与安装预缓存清单；图标为服务端内联 SVG，不进入客户端资源清单。备份、诊断工具通过动态 import 加载；管理分块不进入任何离线清单。构建只读取客户端源码和模板，不读取运行配置或数据目录。
- `store.save(value, expectedVersion)` 使用配置内容 ETag 阻止过期覆盖；前端保存冲突保留表单，预览以编辑快照及请求序号失效。
- `services/weather-data.js` 校验并规范化天气数据；`request-budget.js` 管理访客窗口、上游并发、有限排队及供应商冷却。登录和公开天气预算共用可信代理地址规则。

## 分组与磁贴布局

`shared/layout.js` 定义稳定磁块身份、布局校验及编辑时引用清理；它不包含源配置，HTTP 资源仅管理员可读。`src/render/groups.js` 根据布局生成有序分组与宽度标识，可见性仍由模块领域处理。`public/admin/layout-editor.js` 负责拖放、按钮排序、跨组移动和分组管理，变化沿用配置 ETag 保存流程。

公开页 CSS Grid 使用列跨度及自然内容高度；`public/home/tile-layout.js` 通过 ResizeObserver 计算细行占位，响应异步内容、字体和屏幕宽度变化。不使用 dense 重排，以保持 DOM、阅读和焦点顺序一致。无 ResizeObserver 时退回自然高度网格。布局值通过 data 属性和静态样式表映射，不放宽 CSP 来允许内联样式。

## 备份与恢复

`src/config/backups.js` 提供版本化备份封装、兼容原始配置的校验及有限历史仓库；快照文件模式 0600、目录 0700，只通过管理员路由读取，不进入静态资源索引或 PWA 缓存。`store.save()` 在普通保存和恢复时均在同一保存互斥期间先写上一版快照；规范化内容相同则直接返回，不写文件或增加修订号。快照标记 save/restore，旧快照按 restore 兼容。随后再原子写入新配置；前者失败阻止后者，后者失败不替换内存配置。

管理接口包含 GET `/api/admin/backup`（下载已保存配置）、GET `/api/admin/backups`、GET `/api/admin/backups/<id>`、POST `/api/admin/backup/preview`、POST `/api/admin/backup/restore`。预检查复用 schema、不调用上游，返回内容概况及当前 ETag；恢复要求 If-Match。仓库严格限制快照 ID，不接受任意路径。现有配置持久化与版本检查仍按单 store、单进程设计。

`public/admin/backups.js` 独立管理文件大小限制、异步预检查失效、确认步骤及历史记录；未勾选确认不能发起恢复，成功后重载表单。客户端不独立实现配置 schema，服务端始终重新校验恢复内容。普通保存和恢复共用最近 10 份历史，保存前快照同样不包含环境变量或运行缓存。

## 数据源预设

`public/admin/preset-definitions.js` 是带官方接口出处的配方目录；`preset-picker.js` 按类别生成填写项，再创建普通 widget。所有预设都复用普通 JSON GET、字段映射、环境变量密钥和服务端预览，不为服务名称增加公共渲染或请求分支。依赖 Cookie 会话、WebSocket 或非 JSON 协议的服务需要单独评估专用连接器，不能用通用 REST 配方伪装支持。

预设生成阶段只校验填写项，实际测试/保存继续使用 `validateWidget`、`loadWidget` 与正式服务端渲染器。认证只生成 WIDGET_ 环境变量引用。`shared/widget-types.js` 统一处理数值倍率，`widgets/schema.js` 校验并保留它；不存在任意表达式执行。旧配置默认倍率 1，预设生成后不自动联动改写已保存磁块。

## 管理编辑会话

`public/admin/edit-session.js` 比较配置模型与原始字段值的内存快照，统一处理输入、按钮操作、拖放后的脏状态及 beforeunload；忽略预设与备份区域的临时输入，不使用 localStorage 保存敏感草稿。`admin.js` 捕获完整提交快照，保存时禁用 editor fieldset，成功后重绘并更新基准；失败保留草稿与旧 ETag。备份恢复成功通过 onRestored 明确允许重载，避免额外离开提示。

`validation.js` 负责就近错误与首个错误定位，`json-fields.js` 在写入模型前校验 JSON 结构；服务端校验仍是最终边界。`fields.js` 为字段建立按磁块和上下文区分的草稿键，重绘保留无效原文及错误消息。`widget-copy.js` 只做深拷贝及布局引用插入，不触发网络或保存。

宽度预览沿用 `shared/layout.js` 的 effectiveColumns/effectiveSpan 计算，与公开样式的桌面、平板和手机列数规则对应。`span: "full"` 经过布局 schema 白名单校验，公开 HTML 使用 `data-span="full"`，CSS 以 `grid-column: 1 / -1` 铺满分组。管理预览是无数据源请求的示意，不写入配置；现有 ResizeObserver 继续处理实际磁块自然高度。

## 公开配置版本检测

`src/config/page-version.js` 在单服务实例中为配置快照维护随机公共标记，同内容的新对象保留原标记；它与资源发布版本组合后注入首页 data-page-version。管理员使用的配置内容 ETag 保持独立，不暴露给公开检测接口。

公开路由 `/page-version` 仅支持 GET/HEAD，返回无正文的 204，If-None-Match 命中返回 304，两者均 no-store。`public/home/config-updates.js` 独立处理 10 秒检查、前后台及联网条件、5 秒超时、请求合并及配置同步，失败不干扰内容加载器。`core/config-events.js` 仅广播无配置内容的 changed 信号，由首页重新核对服务端版本；广播仅触发版本校验，成功后同步服务端文档而非直接重载。管理保存及备份恢复均在成功后广播。点击刷新使用带版本文档地址，避免旧入口缓存。

## 数据源诊断

`src/diagnostics.js` 只保留固定分类的错误、状态、时间和计数；不保存 Error、源 URL、响应数据或 headers。`createCache` 可选 onEvent 输出内部生命周期事件，不改变公开 result 结构，观察回调失败不会影响内容加载。`dashboard` 组合来源元数据、缓存事件及逐服务检测结果；revision 改变后清理记录，旧事件有 epoch 保护。诊断检查按 revision+source 合并，跨 revision 的在途请求仍计入全局并发限制，避免取消共享缓存任务影响读者。

默认城市天气使用独立 admin-only weather service，onForecastEvent 仅记录固定 weather 键，强制 fixed 模式，访客天气、定位和搜索不进入诊断。缓存命中事件只更新到期信息，不伪造请求或成功时间。

管理员 GET `/api/admin/diagnostics` 只读内存；POST `/api/admin/diagnostics/check` 仅接受已保存来源 ID，校验认证、同源、可见性、请求预算和配置一致性。公开 HTML/片段没有诊断详情。`public/admin/diagnostics.js` 展开时读取，单源显式检查，刷新记录与进行中检查协调；面板位于编辑 form 外，不影响编辑脏状态。

管理配置与恢复操作同时返回独立 `X-Config-Version`（完整配置摘要）及兼容 ETag。`readConfigVersion()` 优先读取独立版本，回退时只接受完整强/弱摘要，不接受任意代理实体标签。store 仅移除弱标记后进行完整摘要比较，保留缺失版本 428 和过期版本 409；此兼容不跳过认证、同源检查或冲突保护。代理 gzip/弱 ETag 回归测试覆盖固定城市切换 IP、再次保存、旧标签拒绝及备份恢复。

## 统一上游请求预算

`application.js` 创建唯一 `createBudgetedFetcher`，注入 dashboard、默认城市诊断与管理员未保存预览。所有上游 HTTP 请求共用并发 8、排队 24、等待 2 秒和默认 8 秒截止时间，原有调用方更短的超时仍生效。截止时间包含排队，正文读取完成才释放名额，正文限制 1 MiB。缓存命中不进入预算；不自动重试 POST。天气供应商局部预算继续作为额外限制，访客速率限制独立保留。

按 origin 隔离 429/503 或连续失败的 30 秒冷却，失败记录最多 512 项；不记录完整 URL、headers 或正文。队满或等待到期拒绝，新请求不会绕过正在执行的任务。401/403 保留响应状态用于服务可达性判断。配置通过 UPSTREAM_CONCURRENCY、UPSTREAM_MAX_QUEUE、UPSTREAM_QUEUE_WAIT_MS、UPSTREAM_TIMEOUT_MS 设置，并限制合法范围。

## 管理差异、运行概览与映射助手

`config/diff.js` 在服务端对规范化配置生成有界差异，只输出路径、动作及非敏感基础值；source、headers、body、data、URL、mapping、fields 整体遮蔽。深度、遍历工作量与输出数量均有限制。备份预览返回差异并绑定当前配置版本，恢复继续使用 If-Match，不引入自动合并。磁盘备份读取同样限制 1 MiB，损坏或超限项不进入历史列表。

`request-budget.js` 维护按 origin 并发与有界队列，前台任务优先，后台任务最多占 concurrency-1（最低 1）个名额。诊断和未保存预览共用 background fetcher。旧成功任务不能抹掉较新冷却；排队取消会移除任务，调用方取消不记为供应商失败。snapshot 仅返回计数，不返回 origin。管理员 `/api/admin/runtime` 读取该快照及 RSS/磁块/状态缓存统计，不请求上游。运行概览与诊断共用响应 epoch，旧响应不覆盖新检查状态。

`widgets/source.js` 拆出 readWidgetSource 供映射和结构检查复用。POST `/api/admin/widget-inspect` 与预览共享管理员认证、同源校验、每分钟 20 次和全局预算，返回有界字段路径/类型，不返回原始响应值。字段名只接受 validPath 可表达的段，过滤常见敏感字段，数组仅遍历首项；结构检查不要求映射执行成功。关闭客户端请求会取消该次独立预览上游，不能取消公开缓存共享请求。

`admin/field-inspector.js` 的临时选择控件用 data-editor-auxiliary 排除脏状态比较；真正填入路径通过原字段 input 事件更新模型、校验及编辑状态。多值指标沿用 JSON 字段更新路径，列表条目字段转换为相对路径。数值目标排除对象、数组等类型，字符串仍需正式预览判定数值有效性。

## 配置版本与 HTTP 共享缓存

片段 namespace 同时验证 20 位构建版本和 32 位公开随机配置标记。标记复用 createPageVersion，不公开管理配置摘要；旧 token 回源返回 409/no-store/X-Homepage-Reload。请求等待期间配置改变同样拒绝，不能用旧地址封装新配置数据。没有历史配置/数据快照仓库，所以配置版本不能作为数据 immutable 标识。

首页与 `/page/<build>/<token>` 均 no-store；`/page/latest` 和旧文档地址以 no-store 临时重定向到当前版本。ready 的公开片段有限 s-maxage（RSS/磁块 60 秒以内，状态 15 秒），浏览器 max-age=0；天气/搜索、stale/error 及管理响应不共享缓存。html() 对可缓存正文生成内容 ETag，支持 HEAD 和强弱/多值条件请求；错误不会继承可缓存头。

page-sync.js 通过新版本文档地址取同版 DOM，只在响应版本相符且磁块内无焦点时替换 board。app.mountBoard 取消旧片段加载、断开旧 ResizeObserver，重建模块和调度器；旧调度批次不能写入新页面状态。成功同步后 watcher 更新 baseline 并继续检查；失败或焦点保护会重试，构建版本变化仅提示更新脚本。访客主题属性和本地选城不变，不执行响应内脚本。SW 对首页/版本文档导航优先返回通用启动壳，不保存动态文档或片段；启动脚本再以非导航 no-store 请求读取最新页面。

## 服务端图标

`render/icons.js` 从服务端 Lucide 依赖中按名称读取可信 SVG 定义，转义属性后直接渲染 HTML。所有动态片段与首页共用同一 icon()；首页模板中安装/主题按钮的固定占位符在 renderHome 返回前转换。非法或不存在的名称回退 box，缓存以实际定义名为键，空间受库内图标数量限制。

客户端无图标渲染器、Lucide import 或完整库回退；开发模式也不提供 icons.js。构建检查 public/admin 的 metafile，拒绝任何 Lucide 输入进入浏览器包，避免未来误引入。动态天气无需保留客户端图标集合。SVG 增加的字节随实际使用的 HTML 发送，不计入 JS/CSS 体积报告。依赖保留在生产 dependencies，版权许可见 THIRD_PARTY_NOTICES.md。

## PWA 通用启动壳

`launch.html` 及 pwa/launch.js/startup.js 是无配置的公共预缓存资源，manifest start_url 指向 launch.html、id/scope 保持根路径。SW 对根首页和版本文档的导航立即返回已缓存启动壳，不等网络失败；启动脚本的 fetch 不是 navigate，且动态文档不在静态 allowlist，避免递归和内容离线落盘。direct 查询参数提供正常网络导航的逃生入口，管理路径不受影响。

startup 校验文档版本、入口模块和样式的同源哈希路径；先准备当前资源，再替换 body 并导入当前 app。激活失败恢复启动 DOM 与元信息，提供重试和直接导航；成功后解除 online 启动监听，避免后续联网重复挂载应用。pwa/theme.js 是无 import/export 的固定主题代码，由资源工厂内联到 HTML，并用精确 SHA-256 CSP 哈希授权；不使用 unsafe-inline，在样式前从本地偏好应用主题。缓存安装失败或首次未受控访问仍走原来的网络首页。

## 单次启动加载过渡

pwa/initial-content.js 在脱离可见 DOM 的服务端文档上预取首批片段，最多 4 个并发、900ms 等待窗口；与样式/模块资源准备并行。所有结果经 home/fragment-content.js 与常规加载器共用解析/应用逻辑，保留服务入口 DOM 与天气标题约定。遇到版本失效拒绝挂载；普通错误仅影响对应磁块。

准备完毕再整体显示首页：成功磁块标记 initialHydrated，首次调度只消费该标记，避免重复请求；尚未完成的模块用轻量加载文本替换数据骨架，并标记 initialPending。createModuleState 不为该次初始请求恢复骨架，成功或失败后清除标记，之后的重试沿用正常加载机制。动态内容只在内存中准备，不写入启动缓存。

## 结构化启动布局缓存

`pwa/layout-cache.js` 从成功挂载的 #board 提取白名单结构，`app.mountBoard` 在首次进入和配置同步后更新 localStorage。服务端 `renderModule` 只额外输出 placeholder kind/rows，避免从业务内容推断或序列化 DOM。缓存含 schema version、30 天有效期、公开版本和几何枚举；限制 16KB 读取、12 组、64 块、40 服务和每块 1–8 行，未知字段重建时丢弃，存储/JSON 异常回退通用骨架。density 使用 schema 的 comfortable/compact。

启动脚本在网络读取前 restoreLayout，以 createElement 和校验后的枚举构造无标题/ID/URL/数据的占位；复用 content-board、data-columns、data-span 和 ResizeObserver，自适应宽度。成功进入真实页面后断开启动骨架的 observer；失败保留同一骨架供重试。缓存不覆盖服务端当前版本，也不参与请求缓存或模块访问规则。

## 首屏依赖链预算

public 入口使用 bundle=true/splitting=false，避免几 KB 的公共 chunk 增加一个发现阶段；admin 仍 splitting=true，保留工具动态加载和权限隔离。构建回归测试解析公开 JS，禁止静态 import 瀑布，并继续检查管理延迟分块存在。

theme-bootstrap.js 对实际主题源码进行 HTML closing-tag 转义，针对最终 script body 计算 CSP hash。source/built 两个资源工厂在 URL 改写前内联固定代码并暴露 scriptHashes，application 交给 securityHeaders 严格格式校验后拼入 CSP。配置和用户内容不参与此脚本生成，style-src 等策略保持原边界。

配置 watcher 的 deferInitial 只对 freshly mounted 首页启用，首次常规轮询约 10 秒后开始；force 检查仍保留 2 秒节流。移除 app 首屏立即 check，避免无配置正文的检查挤入内容请求阶段。
