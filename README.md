# 川衡 CHUANHENG

React + Vite 官网，依据用户提供的六张深色网站设计示意图从零创建，包含前台、后台及 GPX/KML 转换服务。

2026-10-31：封面 3 MiB 上限与后端自动压缩、路线缺失参数补充及 Debug 提醒已发布；保留活动四时间、路线历史快照和独立封面。Worker 版本为 `bc4bdf05-7663-471e-ba69-a0ab6b06d1a4`，100% 流量运行此版本；代码以 main 分支提交记录为准。访问 [川衡网站](https://chuanheng-website.vulhusky.workers.dev)，交接及回滚见 [生产交接](docs/PRODUCTION-HANDOFF.md)。

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

新站正式模型初始化为空；现有管理员内容保持原样，未迁入旧站示例活动。样例保持示例标识，AI 图像不作实拍使用。轨迹只在路线管理上传，活动选择路线并保存历史版本；活动可独立上传封面、设置报名与活动起止时间。足迹地图可缩放、拖动和复位；没有真实活动地点时不显示活动标记。GPX/KML 支持同图分段线路、独立海拔图及省市识别；符合条件的已结束活动派生足迹。详情见 [轨迹导入与活动足迹](docs/轨迹导入与活动足迹.md)。素材与地理数据来源记录保留在对应 SOURCE 文件。

正式封面原图支持 JPEG、PNG、WebP，最大 3 MiB；服务器验证管理员身份后按比例转为最长边不超过 1920 像素的 WebP，移除图片元数据，再以新文件名上传。处理失败保留原封面。路线里程和爬升优先读取轨迹统计；无法识别时可在路线上传弹窗补充，也可跳过。跳过后显示“暂不提供数据”，Debug 提醒管理员。活动编辑器只读展示所选路线快照的指标，不另设输入。

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
| server/covers、src/media | 封面服务端压缩、上传与公开展示 |
| src/tracks/metrics.js | 自动统计与有来源的管理员补充指标 |
| public/images、public/fonts | 摄影示意、本地品牌字体与来源许可 |
| tests | 页面渲染、资源、配置检查 |
| docs/DEPLOYMENT.md、docs/PRODUCTION-HANDOFF.md | 部署配置、生产状态、管理员交接与回滚 |
| docs/supabase-schema.sql、docs/route-deduplication.sql | 已迁移 SQL 的可读来源；不得对现有表重复执行 CREATE |

新版从零实现，未复制旧代码或账号。旧 `chuanheng` 私有 schema 及数据完整保留，新站使用独立 `public` 内容模型，旧示例没有迁入新站。字体保留来源说明；摄影按“徒步新设计”样板重新生成，官方圆形徽章使用用户提供的原图。

## 素材待补充

官方圆形徽章已收到并接入。仍需补充：协会真实照片；活动与路线详情、GPS轨迹；已核验协会介绍、组织架构、成员和历史；正式联系方式。

## 验证边界

最近一次全套自动测试 **363/363 通过**，正式生产构建及 Worker 无 Node 外部依赖打包成功；此前 `npm audit` 总计与生产依赖均为 0 漏洞。真实 workerd 回归覆盖生产入口管理员认证上传和 Auth 跳转拒绝，原生 Images binding 回归覆盖真实图片转换。实际迁移链在 PostgreSQL 17、18 隔离环境分别 **27/27 通过**，覆盖时间/RLS、历史快照、编辑冲突、引用保护、补充指标校验及封面存储策略。详情见 [SQL 验证](docs/supabase-sql-validation.md)。

生产迁移 `20261031074956`、`20261031131635`、`20261031142417` 已应用。首位测试管理员已完成邮件确认、受信赋权和真实登录；GPX/KML 授权转换此前均 HTTP 200。新活动 RPC、封面目录读取及现有活动保存回滚通过；本次迁移与检查前后现有内容、报名哈希一致。云端真实压缩接口已将合成 PNG 从 2400×1200、41,045 字节转为 1920×960、3,364 字节的 WebP，并移除 EXIF；仅转换，未保存为正式图片。真实照片 Storage 上传、邮件回跳管理配置、上传负载及实机视觉尚待验收。
