# 代码结构与扩展约定

这是一个无构建步骤的原生 ES Modules 项目。Node.js 提供 HTTP 服务，浏览器通过模块加载页面代码。保留这个部署方式；新增能力优先放入所属领域，而不是继续增加入口文件的分支。

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
- 数据服务按修订号丢弃旧缓存，路由不负责缓存管理。
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

PWA 只缓存静态资源与通用 `/offline.html`。动态首页与 `/fragments/` 不写入 Cache Storage，避免保存个性化位置与业务数据；测试同时覆盖旧缓存清理及离线导航回退。

服务状态是顶部 `.service-region` 的动态部分，不在内容区模块描述中重复创建卡片。通用加载器对该片段只替换 `[data-service-state-slot]`，保留服务链接 DOM；状态错误提示使用独立反馈区。

## Review 修复后的约束

- `asset-version.js` 解析并改写完整 ES module 依赖图；`assets.js` 启动快照提供发布哈希、ETag 与权限分类，`pwa.js` 生成同版离线资源清单。版本片段仅接受当前发布版本。
- `store.save(value, expectedVersion)` 使用配置内容 ETag 阻止过期覆盖；前端保存冲突保留表单，预览以编辑快照及请求序号失效。
- `services/weather-data.js` 校验并规范化天气数据；`request-budget.js` 管理访客窗口、上游并发、有限排队及供应商冷却。登录和公开天气预算共用可信代理地址规则。

## 分组与磁贴布局

`shared/layout.js` 定义稳定磁块身份、布局校验及编辑时引用清理；它不包含源配置，HTTP 资源仅管理员可读。`src/render/groups.js` 根据布局生成有序分组与宽度标识，可见性仍由模块领域处理。`public/admin/layout-editor.js` 负责拖放、按钮排序、跨组移动和分组管理，变化沿用配置 ETag 保存流程。

公开页 CSS Grid 使用列跨度及自然内容高度；`public/home/tile-layout.js` 通过 ResizeObserver 计算细行占位，响应异步内容、字体和屏幕宽度变化。不使用 dense 重排，以保持 DOM、阅读和焦点顺序一致。无 ResizeObserver 时退回自然高度网格。布局值通过 data 属性和静态样式表映射，不放宽 CSP 来允许内联样式。

## 备份与恢复

`src/config/backups.js` 提供版本化备份封装、兼容原始配置的校验及有限历史仓库；快照文件模式 0600、目录 0700，只通过管理员路由读取，不进入静态资源索引或 PWA 缓存。`store.save(value, version, { recovery: true })` 在同一保存互斥期间先写恢复点，再原子写入新配置；前者失败阻止后者，后者失败不替换内存配置。

管理接口包含 GET `/api/admin/backup`（下载已保存配置）、GET `/api/admin/backups`、GET `/api/admin/backups/<id>`、POST `/api/admin/backup/preview`、POST `/api/admin/backup/restore`。预检查复用 schema、不调用上游，返回内容概况及当前 ETag；恢复要求 If-Match。仓库严格限制快照 ID，不接受任意路径。现有配置持久化与版本检查仍按单 store、单进程设计。

`public/admin/backups.js` 独立管理文件大小限制、异步预检查失效、确认步骤及历史记录；未勾选确认不能发起恢复，成功后重载表单。客户端不独立实现配置 schema，服务端始终重新校验恢复内容。新增备份能力不改变普通保存行为。

## 数据源预设

`public/admin/preset-definitions.js` 是带官方接口出处的配方注册表，`preset-picker.js` 生成最少的填写项，再创建普通 widget；两者位于管理专用目录，需要认证且不进入 PWA 缓存。新增配方不应在公共加载器或服务端添加按服务名称分支，除非确实需要新的数据源协议。

预设生成阶段只校验填写项，实际测试/保存继续使用 `validateWidget`、`loadWidget` 与正式服务端渲染器。认证只生成 WIDGET_ 环境变量引用。`shared/widget-types.js` 统一处理数值倍率，`widgets/schema.js` 校验并保留它；不存在任意表达式执行。旧配置默认倍率 1，预设生成后不自动联动改写已保存磁块。

## 管理编辑会话

`public/admin/edit-session.js` 比较配置模型与原始字段值的内存快照，统一处理输入、按钮操作、拖放后的脏状态及 beforeunload；忽略预设与备份区域的临时输入，不使用 localStorage 保存敏感草稿。`admin.js` 捕获完整提交快照，保存时禁用 editor fieldset，成功后重绘并更新基准；失败保留草稿与旧 ETag。备份恢复成功通过 onRestored 明确允许重载，避免额外离开提示。

`validation.js` 负责就近错误与首个错误定位，`json-fields.js` 在写入模型前校验 JSON 结构；服务端校验仍是最终边界。`fields.js` 为字段建立按磁块和上下文区分的草稿键，重绘保留无效原文及错误消息。`widget-copy.js` 只做深拷贝及布局引用插入，不触发网络或保存。

宽度预览沿用 `shared/layout.js` 的 effectiveColumns/effectiveSpan 计算，与公开样式的桌面、平板和手机列数规则对应。`span: "full"` 经过布局 schema 白名单校验，公开 HTML 使用 `data-span="full"`，CSS 以 `grid-column: 1 / -1` 铺满分组。管理预览是无数据源请求的示意，不写入配置；现有 ResizeObserver 继续处理实际磁块自然高度。

## 公开配置版本检测

`src/config/page-version.js` 在单服务实例中为配置快照维护随机公共标记，同内容的新对象保留原标记；它与资源发布版本组合后注入首页 data-page-version。管理员使用的配置内容 ETag 保持独立，不暴露给公开检测接口。

公开路由 `/page-version` 仅支持 GET/HEAD，返回无正文的 204，If-None-Match 命中返回 304，两者均 no-store。`public/home/config-updates.js` 独立处理 30 秒检查、前后台及联网条件、5 秒超时、请求合并和一次性提示，失败不干扰内容加载器。`core/config-events.js` 仅广播无配置内容的 changed 信号，由首页重新核对服务端版本；广播不能直接触发页面重载。管理保存及备份恢复均在成功后广播。点击刷新仍遵循现有网络首页与版本化资源机制。
