# 川衡 V1.0.0 工作区

React + Vite 川衡官网，使用 Cloudflare Workers 和 Supabase。发布基线以 main 分支提交记录为准。旧系统私有数据保留，不迁入旧示例。

- 使用简体中文沟通。保留黑白、品牌橙及官方原色圆形徽章，AI 图像与示例数据不得充当真实协会记录。
- Node.js 24；`npm ci`、`npm run dev`（127.0.0.1:5178）、`npm test`。本地构建为 `npm run build`，正式构建为 `npm run build:production`；授权重复发布可用 `npm run deploy`。正式脚本只从 Wrangler 配置读取项目地址及 publishable 公钥，固定 live 模式。Windows 目录是联接时优先使用实际目录，Vite 已使用 realpath。
- 轨迹后端位于 `server/tracks`，生产入口 `server/worker.mjs`；本地 Vite 适配和生产 Worker 使用同一解析器。生产上传必须由服务端验证可信领队/管理员身份。
- GPX/KML 统一由路线管理上传；活动选择路线并保存当时的轨迹快照，后续路线修改不改写历史活动。多段同图、海拔分段，不补造缺失海拔或省市归属。
- 自动路线去重须明确选择，归档保留原数据和审计；更新、删除与跨标签页编辑须保护活动关联。
- Supabase 项目 `gftecgpbhiubrkmazlcu` 已应用 `20261031074956_chuanheng_v1_content_and_tracks` 与 `20261031131635_activity_route_scheduling`；`public.content_items/applications` 为新模型，初始均 0 行。旧 `chuanheng` 全部表与数据原样保留。不得重复执行两份 docs SQL 的 CREATE 或把示例迁为正式内容；后续变更使用针对性迁移。
- 活动具有报名开启/截止、活动开始/结束四时间；数据库按服务器时间校验报名窗口。旧记录时间缺失不自动补造。封面独立上传至 `activity-covers`，仅管理员本人目录可上传 JPEG/PNG/WebP，最大 5 MiB；换图不覆盖或删除历史文件。
- Cloudflare 目标为 `chuanheng-website`，部署与验收记录见 `docs/PRODUCTION-HANDOFF.md`。SPA 回退由 Worker assets 配置处理，禁止恢复 `_redirects` 通配 `/index.html` rewrite，以免触发 Cloudflare 100324 循环。
- Supabase/Cloudflare 平台账户、站点 Auth 用户及旧会员表记录是不同身份。站点用户注册并确认邮件后，由受信后台为对应 Auth UUID 赋 `app_metadata.role=admin`；注册和 `user_metadata` 不授予管理权。
- 密钥、用户数据、运行日志、node_modules、dist、artifacts 不提交。`VITE_` 变量不得包含服务端密钥。
- 地图、字体、图片保留来源记录；边界数据授权限制见 `server/geography/SOURCE.md`。本地可用不等于公开发布已获授权。
- 修改后运行对应测试；提交前运行全套测试与生产构建。Worker 修改需额外验证无 Node 依赖打包。诚实区分自动测试、实机检查和云端联调。

入口说明：README.md、docs/轨迹导入与活动足迹.md、docs/activity-route-workflow.md、docs/DEPLOYMENT.md、docs/PRODUCTION-HANDOFF.md。
