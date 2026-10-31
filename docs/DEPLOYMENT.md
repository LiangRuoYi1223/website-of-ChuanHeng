# 川衡网站部署与服务连接

Supabase 生产迁移与 Cloudflare 新版部署已成功，公网 HTTP 验收通过。Worker 版本为 `9c159570-c589-4813-9dfb-6f819479d40e`，100% 流量；代码以 main 分支提交记录为准。示例活动、路线及 AI 影像不代表协会真实活动，未迁入新站正式内容。

当前状态、生产检查证据、账号交接与回滚步骤统一记录于 [生产交接与回滚](PRODUCTION-HANDOFF.md)。已部署不等于邮件确认、真实账户写入和实机视觉均已验收。

## 本地运行与构建

项目使用 Node.js 24。在项目根目录运行：

```sh
npm ci
npm run dev
```

浏览器访问终端提供的本地地址。本地预览构建：

```sh
npm run build
npm run preview
```

生成目录为 `dist`。前台页面、`/login` 和 `/admin` 使用同一个单页应用。正式部署前分别测试直接访问子路径及刷新页面。

正式构建和授权重复发布使用：

```sh
npm run build:production
npm run deploy
```

`build:production` 从 `wrangler.jsonc` 读取 Supabase URL 与 publishable 公钥，校验格式并固定 `VITE_CONTENT_MODE=live`；不读取数据库密码或 service key。`deploy` 会先重新正式构建，再以 `--keep-vars` 发布 Worker，不必先手动运行一次构建。

## Cloudflare Pages（仅前端）

当前新增了轨迹转换后端。只上传 dist 的静态 Pages 站点不会提供 /api/tracks/convert；需使用下述 Worker 方案，或另行实现 Pages Functions。

本项目当前使用 Workers，不以 Pages 作为正式发布目标。纯静态替代方案必须另行提供轨迹后端和相应路由处理。

Worker 通过 `assets.not_found_handling = "single-page-application"` 为前端路由提供回退。`public/_redirects` 仅保留说明，不包含通配 `/index.html` rewrite；原通配 rewrite 引发 Cloudflare 100324 循环，已修复，不要恢复。不要把敏感信息放在 `public` 或 `VITE_` 环境变量中。

参考：[Pages React 部署](https://developers.cloudflare.com/pages/framework-guides/deploy-a-react-site/)、[Pages 重定向配置](https://developers.cloudflare.com/pages/configuration/redirects/)。

## Cloudflare Workers

正式目标 Worker 为 `chuanheng-website`，地址为 [chuanheng-website.vulhusky.workers.dev](https://chuanheng-website.vulhusky.workers.dev)。仓库 `wrangler.jsonc` 配置 `server/worker.mjs`、ASSETS 静态资源和 `/api/*` 优先进入 Worker；轨迹转换与地理定位在 Worker 执行，其他请求交给 `dist` 单页应用。

正式构建使前端 `VITE_SUPABASE_URL/VITE_SUPABASE_PUBLISHABLE_KEY` 与 Worker `SUPABASE_URL/SUPABASE_PUBLISHABLE_KEY` 指向同一项目。Worker 端使用 publishable key 向 Auth 核实用户，不使用 service key 绕过权限。部署版本 `9c159570-c589-4813-9dfb-6f819479d40e`，启动 16 ms，gzip 752.27 KiB；公网页面、资源、status、匿名拒绝及 JSON 404 均已核验。发布前回退版本为 `e4aef405-b146-493c-aa33-7088f0551c58`。

参考：[Workers 静态资源配置](https://developers.cloudflare.com/workers/static-assets/configuration/)。

## Supabase 前端环境变量

将 `.env.example` 复制为 `.env.local`，填写自己的项目地址与前端公钥：

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_PUBLIC_KEY
```

只允许 publishable key，或兼容旧项目的 `anon` JWT。绝不能填写 secret key、`service_role` JWT、数据库密码、管理 API token。所有 `VITE_` 值都会进入浏览器发布包。修改环境变量后重新构建。代码会拒绝非公钥配置，但检查公钥格式并不替代服务端认证或 RLS。

参考：[Supabase API keys](https://supabase.com/docs/guides/api/api-keys)。

## 登录与权限

已检查到 Supabase Auth 允许注册，且 email confirmation 为 true。Site URL 与邮件回跳允许列表仍需在管理面核对，尚未宣称已配置。目标 Site URL 为 `https://chuanheng-website.vulhusky.workers.dev`，注册代码传入的回跳为同源 `/login`；生产允许列表应包含完整 `https://chuanheng-website.vulhusky.workers.dev/login`，不以开发通配地址代替正式路径。注册调用 `signUp` 后应完成邮件确认，登录调用 `signInWithPassword`。[Supabase 回跳配置](https://supabase.com/docs/guides/auth/redirect-urls)

Supabase/Cloudflare 平台账户不是网站会员账户；旧 `chuanheng.users` 记录也不是新站 Auth 身份。用户选择先上线自行注册，再由受信后台给确认后的 Auth UUID 赋管理员角色；不复制旧密码，不因旧表存在“admin”就自动授权。

后台先读取会话，再向 Auth 服务器调用 `getUser` 核实用户。只有服务器返回的 `user.app_metadata.role === 'admin'` 才能进入云端管理。注册表单不会也不能授予管理员角色。管理员应由受信任的后台管理流程赋予 `app_metadata.role`；不能使用用户可编辑的 `user_metadata` 作为权限依据。

`onAuthStateChange` 回调只安排后续验证，不在同步回调中等待其他 Auth 方法，避免 Auth 锁死。离开页面会退订。密码修改调用真实的 `updateUser({ password })`，无云端配置时不能修改账号密码。

`app_metadata` 的 JWT 声明可能滞后于后台角色变更。赋权、撤权后刷新/撤销相应会话；生产环境需按组织要求设计即时撤权机制。界面权限仅用于展示，数据权限始终由数据库 RLS 判定。

参考：[signInWithPassword](https://supabase.com/docs/reference/javascript/auth-signinwithpassword)、[signUp](https://supabase.com/docs/reference/javascript/auth-signup)、[getSession](https://supabase.com/docs/reference/javascript/auth-getsession)、[getUser](https://supabase.com/docs/reference/javascript/auth-getuser)、[onAuthStateChange](https://supabase.com/docs/reference/javascript/auth-onauthstatechange)、[updateUser](https://supabase.com/docs/reference/javascript/auth-updateuser)。

## 已应用的生产数据库迁移

Supabase 项目 `gftecgpbhiubrkmazlcu` 已成功应用迁移 `20261031074956_chuanheng_v1_content_and_tracks`，本地迁移版本与远端记录对齐。两份 docs SQL 是可读来源，不是可对现有对象重复执行的初始化命令；后续变化必须使用针对性迁移。

- `content_items` 保存活动、路线、影像和文章。普通访问者只能读取已发布、非示例、非归档记录。当前 0 行，默认不发布。
- 管理员可通过 RLS 创建、读取、更新、删除内容。UPDATE 同时具有 USING 与 WITH CHECK；账号角色来自受信任的 app_metadata。
- `applications` 使用外键关联内容和登录用户。用户只能为自己、针对已发布、非示例、非归档、开放报名且未结束、截止时间仍在未来的活动提交一次申请。用户只读自己的申请，管理员可读全部申请；没有前端更新/删除权限。当前 0 行。
- 两表 RLS 与 FORCE RLS 已核验为 true；四个函数均为 SECURITY INVOKER，匿名 EXECUTE 为 false。三个管理 RPC 额外要求可信管理员身份；没有 service key 或绕过 RLS 的函数。

旧私有 `chuanheng` schema、旧用户与业务数据完整保留，没有把旧示例活动迁入新站。生产 REST 已验证匿名内容返回 200 空列表、匿名报名表返回 401。advisors 无新对象告警；仅有旧 `chuanheng` 八表启用 RLS 但无 policy 的 INFO，未为消除提示而开放旧表。

隔离 PostgreSQL 17.5、18.6 测试分别 13/13 通过，覆盖以下矩阵及事务回滚；生产真实账号流程在用户注册和管理员赋权后继续验收：

| 身份 | 必须允许 | 必须拒绝 |
| --- | --- | --- |
| 未登录 | 读取已发布非示例非归档内容 | 读取草稿/示例/归档、写内容、读取/写入申请 |
| 普通用户 A | 读取公开内容、提交/读取本人有效活动申请 | 管理内容、读取用户 B 申请、以 B 身份报名、为路线/未发布/示例/归档内容报名 |
| 管理员 | 管理全部内容、读取全部申请 | 通过前端获得 service key 或未经设计的申请改写权限 |

重复报名、外键拒删、晚期写入失败回滚已在隔离引擎实际执行。真实邮件送达/回跳、会员登录、首位管理员赋权后的写入、Worker 在线上传及多连接锁竞争仍待交接验收，不以匿名 REST 成功代替这些结果。

参考：[Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)。

## 本地设计预览

未提供有效云端配置时，后台明确显示“本地设计预览”。提供配置后，也可以显式访问 `/admin?preview=1` 进入同一纯本地预览，导航会保留该模式，无法借此读写云端管理数据或修改账号密码。初始没有真实内容；示例切换只读，且不计入统计。创建、编辑、删除仅修改当前浏览器 `chuanheng-drafts`，没有云端提交或正式发布。

协会设置与独立足迹管理入口已移除；旧路径会跳转。历史浏览器设置不作为新站云端配置。本地草稿不会自动上传，重要结果应导出；不要在预览草稿中存放密码或报名个人资料。

## 交付前检查

运行测试与生产构建；检查移动端菜单、登录密码显隐、搜索筛选、CRUD 表单以及深色背景上的文字对比。手动验证页面刷新仍能访问 `/activities`、`/login` 与 `/admin/routes`。未提供的协会资料与真实内容保留空态；注册、邮件确认及管理员赋权按交接分步验收，不把待完成步骤标为成功。
