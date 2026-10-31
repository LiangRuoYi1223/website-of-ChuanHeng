# 更新记录

## V1.0.0 — 2026-10-31

- React + Vite 川衡深色官网：前台、后台、登录、官方徽章与新版摄影素材。
- 本地后端 GPX/KML 转换：多段同图展示，各段独立海拔剖面、里程、爬升与下降。
- 离线省市自动识别，活动派生路线及足迹地图。
- Debug 重名路线比较、选择保留、归档、关联修复及审计。
- 移除独立足迹管理和协会设置入口，保留旧路径跳转。
- 本地 IndexedDB 轨迹存储、草稿恢复、引用删除保护及多标签页冲突防护。
- Cloudflare Worker 与静态资源已成功部署，版本 `9c159570-c589-4813-9dfb-6f819479d40e`，100% 流量；启动 16 ms，gzip 752.27 KiB。公网页面、资源与 API HTTP 验收通过。
- 新增 `build:production` 和可重复发布的 `npm run deploy`；正式构建读取 Wrangler 中的项目地址与公钥，固定 live 模式。SPA 回退交给 Worker assets，移除通配 rewrite 引起的 Cloudflare 100324 循环。
- Supabase 生产迁移 `20261031074956_chuanheng_v1_content_and_tracks` 已成功应用。新 `public` 内容/报名表保持空表，RLS/FORCE RLS 与受限原子 RPC 已核验；原 `chuanheng` 表及示例数据原样保留。
- 实际隔离数据库验证发现并修复路线 SQL 的 IF CASE 语法及归档活动公开/报名策略缺口；PostgreSQL 17.5、18.6 分别 13/13 通过。

已记录验收：278/278 项自动测试、正式生产构建、Worker 无 Node 外部依赖打包及 localhost GPX/KML 上传通过；npm audit 总计和生产依赖均 0 漏洞。生产匿名内容 REST 为 200 空列表、报名表为 401；advisors 无新对象告警，仅报告旧 `chuanheng` 表 RLS 无 policy 的 INFO。公网 status 为正式配置，匿名转换返回 401，未知 API 返回 JSON 404。HTTP/JSDOM 不代替实机视觉验收。

代码以 main 分支提交记录为准。待交接：邮件确认回跳核对、用户注册后首位 Auth 管理员赋权及真实账户端到端验收。详见 [生产交接与回滚](docs/PRODUCTION-HANDOFF.md)。

详见 [轨迹导入与活动足迹](docs/轨迹导入与活动足迹.md)。
