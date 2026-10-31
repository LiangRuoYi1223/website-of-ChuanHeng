# 川衡 CHUANHENG

React + Vite 官网，依据用户提供的六张深色网站设计示意图从零创建，包含前台、后台及 GPX/KML 转换服务。

2026-10-31：Supabase 生产迁移与 Cloudflare 新版部署均已成功；登录/注册背景定位修复已发布，公网 HTTP 验收通过。Worker 版本为 `6fee123c-8347-42d0-b558-6884f96448ff`，100% 流量运行此版本；代码以 main 分支提交记录为准。访问 [川衡网站](https://chuanheng-website.vulhusky.workers.dev)，交接及回滚见 [生产交接](docs/PRODUCTION-HANDOFF.md)。

## 本地查看

安装 Node.js 24，首次运行 `npm install`，之后运行 `npm run dev`。

地址：http://127.0.0.1:5178/

- 后台预览：http://127.0.0.1:5178/admin?preview=1
- 轨迹导入：http://127.0.0.1:5178/routes/import
- Debug：http://127.0.0.1:5178/admin/debug?preview=1
- 登录：http://127.0.0.1:5178/login
- 注册：http://127.0.0.1:5178/login?mode=register

也可双击根目录的「启动网站.cmd」。

`npm run build` 用于本地构建。正式构建运行 `npm run build:production`：从 `wrangler.jsonc` 读取项目地址和 publishable 公钥，固定使用 live 内容模式。`npm run deploy` 会重新正式构建并发布同一 Worker；只有在授权发布时执行。`npm test` 运行自动测试。

## 本地验收

依次检查首页、活动与详情、路线库与详情、影像、资讯与详情、关于、足迹、加入、后台、登录注册。

重点试用活动/路线/资讯筛选，影像灯箱与键盘切换，FAQ折叠，以及后台的本地草稿新建、编辑、删除。显式 `preview=1` 模式只保存当前浏览器草稿，不提交云端；清除浏览器存储会丢失这些草稿。正式管理员模式的内容管理使用 Supabase，保存成功以数据库响应为准。

新站正式 `public.content_items` 与 `public.applications` 当前均为 0 行；未迁入旧站示例活动。样例保持示例标识，AI 图像不作实拍使用。足迹地图可缩放、拖动和复位；没有真实活动地点时不显示活动标记。GPX/KML 支持同图分段线路、独立海拔图及省市识别；符合条件的已结束活动派生足迹。详情见 [轨迹导入与活动足迹](docs/轨迹导入与活动足迹.md)。素材与地理数据来源记录保留在对应 SOURCE 文件。

## 文件与页面

| 文件 | 内容 |
| --- | --- |
| src/App.jsx | 路由、导航、首页、页脚、全站搜索 |
| src/styles.css | 设计tokens、本地字体、公共组件与响应式布局 |
| src/ui.jsx | 共享按钮、标题、Hero、状态与空态 |
| src/data.js | 明确标识的示例内容 |
| src/catalog.jsx | 预览/正式数据模式与内容读取 |
| src/pages/Explore.jsx、explore.css | 活动、路线、影像、资讯列表与详情 |
| src/pages/Community.jsx、community.css | 关于、足迹、加入 |
| src/pages/Admin.jsx、admin.css | 后台、登录注册、本地草稿管理 |
| src/backend.js | Supabase Auth 公钥连接与配置检查 |
| public/images、public/fonts | 摄影示意、本地品牌字体与来源许可 |
| tests | 页面渲染、资源、配置检查 |
| docs/DEPLOYMENT.md、docs/PRODUCTION-HANDOFF.md | 部署配置、生产状态、管理员交接与回滚 |
| docs/supabase-schema.sql、docs/route-deduplication.sql | 已迁移 SQL 的可读来源；不得对现有表重复执行 CREATE |

新版从零实现，未复制旧代码或账号。旧 `chuanheng` 私有 schema 及数据完整保留，新站使用独立 `public` 内容模型，旧示例没有迁入新站。字体保留来源说明；摄影按“徒步新设计”样板重新生成，官方圆形徽章使用用户提供的原图。

## 素材待补充

官方圆形徽章已收到并接入。仍需补充：协会真实照片；活动与路线详情、GPS轨迹；已核验协会介绍、组织架构、成员和历史；正式联系方式。

## 验证边界

最近一次全套自动测试 **278/278 通过**，正式生产构建成功；`npm audit` 总计与生产依赖均为 0 漏洞。Worker 无 Node 外部依赖打包及 localhost GPX/KML HTTP 上传已通过。PostgreSQL 17.5、18.6 的隔离 SQL 测试分别 13/13 通过，验证实际 RLS、管理 RPC 与回滚。详情见 [SQL 验证](docs/supabase-sql-validation.md)。

生产迁移 `20261031074956_chuanheng_v1_content_and_tracks` 已应用：新表 RLS 与 FORCE RLS 已开启；匿名内容 REST 返回 200 空列表，匿名报名表返回 401；新对象没有 advisors 告警。公网页面、构建资源、徽章、API 配置及匿名拒绝检查通过。首位测试管理员已完成邮件确认、受信后台赋权、真实密码登录及内容读取；未写入示例，凭据不进入仓库。待办为邮件回跳管理配置核对、真实账户写入及授权上传。HTTP/JSDOM 检查不代替实机视觉验收。
