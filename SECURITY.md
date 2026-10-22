# Security policy

## Reporting

请勿在公开 Issue、截图或日志中提交凭据、完整配置、私人域名、IP 或访问令牌。
如仓库启用了 GitHub Private Vulnerability Reporting，请优先使用该私密渠道；否则先创建不含敏感细节的 Issue，商议安全的复现信息提交方式。

## Deployment

- 通过 HTTPS 反向代理访问管理页；不要直接公开应用管理端口。
- 默认不启用管理员；设置自己的 ADMIN_PASSWORD 后再启用。
- .env、data/、备份及个人截图不得提交到仓库。备份可能包含直接写入配置的密钥。
- TRUST_PROXY_HOPS 只适用于应用端口受可信反向代理保护的部署。
- 首页公开内容不是私有仪表盘；字段映射决定哪些上游信息会公开。
- 自定义 API 由管理员配置，可用于内网服务；仅向可信管理员开放此能力。
- 依赖许可证分别由对应包管理，本项目源码采用 MIT。
