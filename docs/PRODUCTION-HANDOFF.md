# 川衡 V1 生产交接与回滚

记录日期：2026-10-31。封面 3 MiB 上限、后端自动压缩、路线缺失指标补充及 Debug 提醒已部署。此前活动四时间、路线快照、独立封面和首页卡片修复继续保留。首位测试管理员已完成邮件验证、赋权和真实登录；验收边界见下方记录。

## 当前交接状态

| 项目 | 已确认状态 |
| --- | --- |
| Supabase 项目 | `gftecgpbhiubrkmazlcu` |
| 生产迁移 | `20261031074956_chuanheng_v1_content_and_tracks`、`20261031131635_activity_route_scheduling`、`20261031142417_route_manual_metrics_and_cover_limit` 均已应用 |
| 活动时间/路线选择 | 四时间与服务端报名窗口；活动选择路线并保留历史快照；旧轨迹保存 RPC 已撤销站点调用权 |
| 活动封面 | 原图 JPEG/PNG/WebP 最大 3 MiB；后端转 WebP 后上传；public bucket `activity-covers` 上限 3 MiB，保留允许的 MIME 和管理员本人目录 INSERT/SELECT 策略，禁止覆盖/删除 |
| 路线指标 | 自动统计优先；缺失时可补充或跳过，补充值独立记录来源与时间；未知显示“暂不提供数据”，Debug 提醒并链接路线编辑；活动指标只读且随快照冻结 |
| 本地迁移记录 | 与上述远端版本保持一致；不重复应用同一迁移 |
| 新内容/报名 | 迁移前后 content_items=2、applications=0，完整行聚合哈希一致；未导入示例或改写现有内容 |
| 新表权限 | 两表 RLS/FORCE RLS=true；管理 RPC 保持 SECURITY INVOKER、受信管理员检查和匿名禁执行 |
| 真实 REST | 此前匿名内容读取 HTTP 200、匿名报名表 HTTP 401；不以早期空表结果推断当前内容 |
| Advisors | 无新增对象告警；旧 `chuanheng` 八表 INFO 及原 Auth 泄露密码保护未启用 WARN 保持原状 |
| Auth | 允许注册；email confirmation=true；测试管理员已验证、赋权并通过真实登录；邮件回跳管理面尚需核对 |
| Cloudflare 目标 | Worker `chuanheng-website` |
| 目标地址 | [chuanheng-website.vulhusky.workers.dev](https://chuanheng-website.vulhusky.workers.dev) |
| 本次新版发布 | **已部署，公网 HTTP 验收通过** |
| 当前 Worker version | `bc4bdf05-7663-471e-ba69-a0ab6b06d1a4` |
| 流量 | 100% 当前版本 |
| Deployment ID | `af1da1f5-4d03-456a-89bd-00aeea4cc97a` |
| 图片运行资源 | Worker 绑定 `IMAGES`；生产压缩由原生 Images binding 执行，Node 图片库只用于本地适配与测试 |
| 发布前回退版本 | `f9084d3c-26b4-4466-a31c-7fc3f29535b0`；回退时暂停管理上传，见回滚边界 |

原私有 `chuanheng` 数据原样保留。已记录的旧表行数为：users 1（旧初始管理员）、activities 7（全部 isDemo=true）、projects 3、settings 1、registrations 0、sessions 0。旧表不作为新站正式内容，也不作为新 Auth 管理员身份来源。

## 发布记录与验收进度

已完成的发布与验收结果：

| 记录项 | 结果 |
| --- | --- |
| 代码版本 | 以 main 分支提交记录为准 |
| 最终构建/测试 | 363/363 自动测试；实际迁移链 PG17/18 各 27/27；正式构建及 Worker 无 Node 外部依赖打包通过 |
| 依赖审计 | npm audit 总计与生产依赖均 0 漏洞 |
| 新 Worker version ID | `bc4bdf05-7663-471e-ba69-a0ab6b06d1a4` |
| 部署时间（UTC） | `2026-10-31T14:46:25.845024Z` |
| 页面与子路径 | `/`、`/activities`、`/routes/import`、`/about`、`/footprints`、`/login`、`/admin/debug` 均 HTTP 200，text/html |
| 前端脚本 | `/assets/index-Ck4gmd_V.js`；5 项入口资源 HTTP 200，SHA-256 与本地正式构建完全一致 |
| 登录/注册布局修复 | 背景和遮罩固定到视口，左侧文案独立于表单高度定位；`/login` 和 `/login?mode=register` 均引用最新 `/assets/index-BK6v6EWB.css`；实机视觉待验收 |
| 官方徽章 | HTTP 200，image/jpeg |
| `/api/tracks/status` | HTTP 200，`{localPreview:false,configured:true}` |
| 匿名 POST `/api/tracks/convert` | HTTP 401，`AUTH_REQUIRED` |
| 未知 `/api/*` | HTTP 404，JSON 响应 |
| 真实管理员登录/读取 | 密码登录、Auth getUser 的 admin 角色及 content_items 读取 HTTP 200 通过；未写入示例 |
| 真实授权轨迹转换 | 测试管理员 GPX/KML 均 HTTP 200；各 2 点、累计爬升 10 m；匿名/无效会话 HTTP 401，跨站 HTTP 403；合成轨迹仅转换、不保存 |
| 封面真实云端压缩 | 正式站点、不带版本覆盖：合成 PNG 2400×1200、41,045 字节 → WebP 1920×960、3,364 字节；HTTP 200、EXIF 已移除；仅转换，不写 Storage |
| 封面拒绝路径 | 正式站点匿名 401、跨站 403、超过 3 MiB 413；处理失败不上传原图 |
| 活动/路线 CRUD 与上传负载 | 现有活动保存事务已验证并回滚；真实内容持久化、用户照片 Storage 上传、上传负载及多连接竞争仍待验收 |

页面、子路径与 API 已通过公网 HTTP 检查；5 项入口资源 SHA-256 与正式构建相同。邮件确认由用户操作及 Auth 记录核实，管理员密码登录、读取、GPX/KML 转换及封面压缩单独通过真实请求验证。合成轨迹和图片仅转换、不保存；最新迁移前后 content_items=2、applications=0，完整行哈希不变，封面对象数仍为 0。实机视觉、邮件回跳管理配置、真实用户图片 Storage 持久化和上传负载未验收。

正式构建使用 `npm run build:production`，只读取 Wrangler 中的 Supabase URL 和 publishable 公钥并固定 live 模式。授权重复发布可用 `npm run deploy`。Worker SPA 回退由 assets 配置负责；`public/_redirects` 原通配 rewrite 导致 Cloudflare 100324 循环，已移除并成功部署。

轨迹身份校验兼容性修复：旧请求使用 `redirect: 'error'`，Cloudflare Workers 在构造请求时立即抛出 TypeError，导致有效管理员也收到 `503 AUTH_UNAVAILABLE`。现改为 Workers 支持的 `manual`，沿用非 2xx 拒绝逻辑，不跟随 Auth 跳转、不向其他目标转发凭据。5 秒验证时限、64 KiB 响应上限及可信 `app_metadata.role` 校验保持有效；新增真实 workerd 生产入口回归验证该链路。[Cloudflare Request](https://developers.cloudflare.com/workers/runtime-apis/request/)

## 封面压缩与路线指标发布验收（本次）

2026-10-31 22:46（北京时间）发布封面处理和路线指标流程。正式封面原图最大 3 MiB；同源接口先向 Supabase Auth 核实真实管理员身份，再限制请求大小、文件格式、总像素和处理时间，通过 `IMAGES` 按比例缩小至最长边 1920 像素、质量 80 的 WebP，移除图片元数据。客户端只把成功结果以新 UUID 文件名上传；失败保留原封面，不覆盖或删除历史文件。

里程和爬升优先读取轨迹自动统计。路线导入缺失指标时弹窗允许补充、跳过或取消；补充值仅兜底并保留管理员来源及确认时间，不改原始统计或海拔剖面。跳过后显示“暂不提供数据”，Debug 提醒管理员并提供路线编辑入口。活动不再单独输入指标，所选路线指标与来源存入历史快照。

新迁移 `20261031142417` 已应用，本地文件名与远端真实版本对齐。生产调用确认自动里程与合法人工爬升分别保留来源；现有内容/报名完整行哈希不变。没有改写历史活动快照或 Storage 对象。

## 活动时间与独立封面的前次发布记录

2026-10-31 21:17（北京时间）发布活动时间、路线选择快照、独立封面上传及首页卡片修复。当时首页、活动/路线后台及旧导入地址均 HTTP 200，引用该次构建；默认封面资源 HTTP 200、image/webp。管理员真实登录后，新 RPC 对无效输入返回预期 `22023 INVALID_ACTIVITY`，封面目录列表读取成功。

云端以受信管理员身份对现有活动运行保存并回滚，返回成功；前后内容及报名完整行哈希一致。测试未保存合成活动、路线或图片，封面桶对象数为 0。客户端上传与图片失败降级已通过自动测试；真实用户图片上传、浏览器实机布局及多连接竞争仍需验收。

迁移由 CLI 先生成，再通过受信迁移工具执行；远端生成版本 `20261031131635`，本地文件已按远端真实版本对齐。新对象无 advisors 告警；Auth 存在弱泄露密码保护未启用的全局配置提醒，保持原配置，旧 chuanheng 八表 INFO 保持原状。

## 首位站点管理员

身份分为三层：Supabase/Cloudflare 的平台管理账户；新站 Supabase Auth 的邮箱用户；旧 `chuanheng.users` 中的会员记录。三者不自动互认。不复制旧账号密码，不自动升级第一个注册者。

2026-10-31 按用户授权创建独立测试账号；用户完成确认邮件后，受信后台仅对该已确认 Auth UUID 赋予 `app_metadata.role=admin`，保留其他 app_metadata。已重新进行密码登录并调用 Auth `getUser` 确认 admin 角色，当时正式 `content_items` 读取 HTTP 200、0 行。随后完成 GPX/KML 授权转换、封面压缩与现有活动保存回滚；不保存合成正式内容。账号邮箱、UUID、密码及会话令牌不写入仓库。

1. 在 Supabase Auth 管理面核对 Site URL 为正式站点 origin；允许回跳包含完整 `https://chuanheng-website.vulhusky.workers.dev/login`。当前注册代码使用 `${window.location.origin}/login`。只有确实需要本地调试时才单独加入对应 localhost 地址。生产使用精确回跳路径。[Supabase Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
2. 用户在已发布站点 `/login?mode=register` 自行注册并完成确认邮件。email confirmation=true，注册响应不等于已确认或已登录。邮件送达与回跳成功需实际检查。
3. 用户告知已经注册；受信管理方核对对应 Auth user ID 和确认状态，不把平台登录邮箱或旧会员 ID 当作 Auth UUID。
4. 通过受信后台为该 Auth 用户设置 `app_metadata.role=admin`，保留其他既有 app_metadata。不得使用 `user_metadata.role`、前端表单、旧 users 表角色或本地草稿授权。密钥与个人资料不进入仓库/日志。
5. 用户刷新令牌或退出后重新登录，确认后台由 Auth `getUser` 核实为 admin，再验收读写。普通会员仍应被管理 RPC/RLS 拒绝。领队仅有轨迹转换资格，不自动拥有内容管理权限。

## 剩余待办

页面、静态资源、API 配置状态、匿名拒绝及真实云端图片压缩已通过。现有管理员内容原样保留，不用示例填充。测试管理员真实登录及新保存流程回滚验证通过；接下来核对 Auth 邮件 URL 配置，实际用户照片 Storage 上传、实机布局与持久化业务写入由真实内容验收。

真实活动发布前核实内容与轨迹来源。真实内容持久化、Storage 上传完整链路、上传负载、Worker CPU/内存、多连接锁竞争和实机视觉仍需实际验收。自动测试与隔离 SQL 的范围见 README 和 [SQL 验证](supabase-sql-validation.md)。

## Worker 回滚

新版上线出现阻断访问、登录或核心 API 问题时，先记录当前部署 version ID 和故障时间，然后将同一 Worker 回退至已记录版本。执行前确认目标版本仍在 Cloudflare 可回退列表，相关绑定资源仍存在。

需要回退时使用已记录版本：

```sh
npx wrangler rollback f9084d3c-26b4-4466-a31c-7fc3f29535b0 --name chuanheng-website --message "Emergency rollback; pause admin uploads until compatible release"
```

也可在 Workers & Pages → `chuanheng-website` → Deployments 中选择记录版本回滚。完成后记录实际回滚部署，并重新核验页面、认证及轨迹 API。[Cloudflare Worker Rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)

上述前一版本认识活动路线快照，但不含当前后端压缩、补充指标和 3 MiB 客户端限制。回退后暂停管理上传与指标编辑，优先发布兼容当前模型的前向修复。更早的 `33919f27-9e67-4350-8f64-6ee1cac5315e` 不认识路线快照，且其旧轨迹 RPC 已撤销站点调用权，不作为当前管理流程的常规回退版本。不能通过恢复旧 RPC 或删除新数据盲目回滚。

Worker 回滚不撤销 Supabase 数据、更改记录或连接资源。默认保留已安装的新 `public` 对象、已注册 Auth 用户及后续真实内容。不要用 DROP 表/schema、重跑初始化 SQL、删除迁移记录或把远端标记为未执行来代替应用回滚。数据库确需补救时，先保留数据和审计，再准备单独的针对性迁移；旧 `chuanheng` 数据保持不动。

## 运维材料

- 已应用 SQL：`supabase/migrations` 三份实际迁移；早期可读来源为 `docs/supabase-schema.sql`、`docs/route-deduplication.sql`。生产历史以远端迁移版本为准，不重复 CREATE。
- 隔离复现：实际迁移链使用 `scripts/validate-activity-route-sql.mjs`；早期来源使用 `scripts/validate-supabase-sql.mjs`。固定依赖、原始 TAP 和报告位于被忽略的 `artifacts/sql-validation`。
- 配置与账号操作：[部署说明](DEPLOYMENT.md)。不要提交 `.env`、密钥、令牌、个人报名资料或运行日志。
