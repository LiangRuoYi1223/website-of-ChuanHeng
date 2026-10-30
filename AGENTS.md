# 川衡 V1.0.0 本地新设计分支

用户明确要求从零创建 React + Vite 新版，先本地验收，再接 Supabase / Cloudflare。本分支是新版工作区快照；原 main 历史与旧系统不在本次云端迁移范围内。

- 使用简体中文沟通。保留黑白、品牌橙及官方原色圆形徽章，AI 图像与示例数据不得充当真实协会记录。
- Node.js 24；`npm ci`、`npm run dev`（127.0.0.1:5178）、`npm test`、`npm run build`。Windows 目录是联接时，优先使用实际目录，Vite 已使用 realpath。
- 轨迹后端位于 `server/tracks`，生产入口 `server/worker.mjs`；本地 Vite 适配和生产 Worker 使用同一解析器。生产上传必须由服务端验证可信领队/管理员身份。
- 活动上传轨迹后派生路线及足迹；多段同图、海拔分段，不补造缺失海拔或省市归属。
- 自动路线去重须明确选择，归档保留原数据和审计；更新、删除与跨标签页编辑须保护活动关联。
- `docs/route-deduplication.sql`、`docs/supabase-schema.sql` 是未执行草案。不得在普通检查中调用真实数据库写入、部署或上传用户文件。
- 密钥、用户数据、运行日志、node_modules、dist、artifacts 不提交。`VITE_` 变量不得包含服务端密钥。
- 地图、字体、图片保留来源记录；边界数据授权限制见 `server/geography/SOURCE.md`。本地可用不等于公开发布已获授权。
- 修改后运行对应测试；提交前运行全套测试与生产构建。Worker 修改需额外验证无 Node 依赖打包。诚实区分自动测试、实机检查和云端联调。

入口说明：README.md、docs/轨迹导入与活动足迹.md、docs/activity-route-workflow.md、docs/DEPLOYMENT.md。
