# 川衡 V1 生产交接与回滚

记录日期：2026-10-31。Supabase 生产迁移、Cloudflare 部署和公网 HTTP 验收已完成。邮件回跳、首位管理员及真实账户流程见下方待办。

## 当前交接状态

| 项目 | 已确认状态 |
| --- | --- |
| Supabase 项目 | `gftecgpbhiubrkmazlcu` |
| 生产迁移 | `20261031074956`，名称 `chuanheng_v1_content_and_tracks`，已成功应用 |
| 本地迁移记录 | 与上述远端版本保持一致；不重复应用同一迁移 |
| 新内容/报名 | `public.content_items=0`、`public.applications=0`；未导入示例 |
| 新表权限 | 两表 RLS/FORCE RLS=true；四函数 SECURITY INVOKER；匿名 EXECUTE=false |
| 真实 REST | 匿名内容读取 HTTP 200、空列表；匿名报名表 HTTP 401 |
| Advisors | 无新对象告警；旧 `chuanheng` 八表 RLS 无 policy 为 INFO，保持原状 |
| Auth | 允许注册；email confirmation=true；邮件回跳管理面尚需核对 |
| Cloudflare 目标 | Worker `chuanheng-website` |
| 目标地址 | [chuanheng-website.vulhusky.workers.dev](https://chuanheng-website.vulhusky.workers.dev) |
| 本次新版发布 | **已部署，公网 HTTP 验收通过** |
| 当前 Worker version | `9c159570-c589-4813-9dfb-6f819479d40e` |
| 流量 | 100% 当前版本 |
| Deployment ID | `84f324c5-d9e6-4296-806c-f48bd1611eb4` |
| Worker 发布指标 | 启动 16 ms；gzip 752.27 KiB |
| 发布前回退版本 | `e4aef405-b146-493c-aa33-7088f0551c58` |

原私有 `chuanheng` 数据原样保留。已记录的旧表行数为：users 1（旧初始管理员）、activities 7（全部 isDemo=true）、projects 3、settings 1、registrations 0、sessions 0。旧表不作为新站正式内容，也不作为新 Auth 管理员身份来源。

## 发布记录与验收进度

已完成的发布与验收结果：

| 记录项 | 结果 |
| --- | --- |
| 代码版本 | 以 main 分支提交记录为准 |
| 最终构建/测试 | 278/278 自动测试；正式生产构建成功；双引擎 SQL 各 13/13 |
| 依赖审计 | npm audit 总计与生产依赖均 0 漏洞 |
| 新 Worker version ID | `9c159570-c589-4813-9dfb-6f819479d40e` |
| 部署时间（UTC） | `2026-10-31T08:07:13.340683Z` |
| 页面与子路径 | `/`、`/activities`、`/routes/import`、`/about`、`/footprints`、`/login`、`/admin/debug` 均 HTTP 200，text/html |
| 前端脚本 | 首页引用 `/assets/index-DaJsPJbF.js`，精确匹配本地正式构建，HTTP 200，text/javascript |
| 官方徽章 | HTTP 200，image/jpeg |
| `/api/tracks/status` | HTTP 200，`{localPreview:false,configured:true}` |
| 匿名 POST `/api/tracks/convert` | HTTP 401，`AUTH_REQUIRED` |
| 未知 `/api/*` | HTTP 404，JSON 响应 |
| 真实授权上传与活动/路线 CRUD | 待 Auth 用户注册、确认、赋权后验收 |

页面资源与 API 已通过公网 HTTP 检查。实机视觉、邮件送达/回跳及真实账户上传不包含在本次 HTTP 验收中；启动耗时与压缩包体积不代表上传负载验收结果。

正式构建使用 `npm run build:production`，只读取 Wrangler 中的 Supabase URL 和 publishable 公钥并固定 live 模式。授权重复发布可用 `npm run deploy`。Worker SPA 回退由 assets 配置负责；`public/_redirects` 原通配 rewrite 导致 Cloudflare 100324 循环，已移除并成功部署。

## 首位站点管理员

身份分为三层：Supabase/Cloudflare 的平台管理账户；新站 Supabase Auth 的邮箱用户；旧 `chuanheng.users` 中的会员记录。三者不自动互认。用户选择“先上线自行注册，再赋管理员”，不预置密码、不复制旧账号密码、不自动升级第一个注册者。

1. 在 Supabase Auth 管理面核对 Site URL 为正式站点 origin；允许回跳包含完整 `https://chuanheng-website.vulhusky.workers.dev/login`。当前注册代码使用 `${window.location.origin}/login`。只有确实需要本地调试时才单独加入对应 localhost 地址。生产使用精确回跳路径。[Supabase Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
2. 用户在已发布站点 `/login?mode=register` 自行注册并完成确认邮件。email confirmation=true，注册响应不等于已确认或已登录。邮件送达与回跳成功需实际检查。
3. 用户告知已经注册；受信管理方核对对应 Auth user ID 和确认状态，不把平台登录邮箱或旧会员 ID 当作 Auth UUID。
4. 通过受信后台为该 Auth 用户设置 `app_metadata.role=admin`，保留其他既有 app_metadata。不得使用 `user_metadata.role`、前端表单、旧 users 表角色或本地草稿授权。密钥与个人资料不进入仓库/日志。
5. 用户刷新令牌或退出后重新登录，确认后台由 Auth `getUser` 核实为 admin，再验收读写。普通会员仍应被管理 RPC/RLS 拒绝。领队仅有轨迹转换资格，不自动拥有内容管理权限。

## 剩余待办

页面、静态资源、API 配置状态与匿名拒绝已通过。新站空内容是预期结果，不用示例填充上线。接下来核对 Auth 邮件 URL 配置，完成用户注册、邮件确认、首位管理员赋权，并分别验收普通会员与管理员的真实权限。

真实活动发布前核实内容与轨迹来源。管理员写入、授权上传及文件上限、Worker CPU/内存、多连接锁竞争和实机视觉仍需实际验收。自动测试与隔离 SQL 的范围见 README 和 [SQL 验证](supabase-sql-validation.md)。

## Worker 回滚

新版上线出现阻断访问、登录或核心 API 问题时，先记录当前部署 version ID 和故障时间，然后将同一 Worker 回退至已记录版本。执行前确认目标版本仍在 Cloudflare 可回退列表，相关绑定资源仍存在。

需要回退时使用已记录版本：

```sh
npx wrangler rollback e4aef405-b146-493c-aa33-7088f0551c58 --name chuanheng-website --message "Rollback V1 deployment"
```

也可在 Workers & Pages → `chuanheng-website` → Deployments 中选择记录版本回滚。完成后记录实际回滚部署、访问目标地址，并按旧版能力核验；旧版不一定有新版轨迹 API。[Cloudflare Worker Rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)

Worker 回滚不撤销 Supabase 数据、更改记录或连接资源。默认保留已安装的新 `public` 对象、已注册 Auth 用户及后续真实内容。不要用 DROP 表/schema、重跑初始化 SQL、删除迁移记录或把远端标记为未执行来代替应用回滚。数据库确需补救时，先保留数据和审计，再准备单独的针对性迁移；旧 `chuanheng` 数据保持不动。

## 运维材料

- 已应用 SQL 的可读来源：`docs/supabase-schema.sql`、`docs/route-deduplication.sql`；生产历史以远端迁移版本为准，不重复 CREATE。
- 隔离复现：`scripts/validate-supabase-sql.mjs`；固定依赖、原始 TAP 和哈希报告位于被忽略的 `artifacts/sql-validation`。
- 配置与账号操作：[部署说明](DEPLOYMENT.md)。不要提交 `.env`、密钥、令牌、个人报名资料或运行日志。
