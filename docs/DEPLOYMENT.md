# 川衡网站部署与服务连接

此版本已准备静态网站与 Supabase 连接代码。未创建或修改任何云端项目，未执行数据库 SQL，未部署至 Cloudflare。示例活动、路线及 AI 影像不代表协会真实活动。没有真实内容时，切勿将示例当作正式招募发布。

**当前阶段：先在 localhost 完成本地验收，尚未连接正式云端服务。** Supabase 数据库应用与 Cloudflare 发布留待本地验收通过后再处理；下文仅为后续配置说明，不代表已上线。

## 本地运行与构建

建议使用 Node.js 22.12 或更高的受支持版本。在项目根目录运行：

```sh
npm ci
npm run dev
```

浏览器访问终端提供的本地地址。制作静态发布包：

```sh
npm run build
npm run preview
```

生成目录为 `dist`。前台页面、`/login` 和 `/admin` 使用同一个单页应用。正式部署前分别测试直接访问子路径及刷新页面。

## Cloudflare Pages（仅前端）

当前新增了轨迹转换后端。只上传 dist 的静态 Pages 站点不会提供 /api/tracks/convert；需使用下述 Worker 方案，或另行实现 Pages Functions。

在 Cloudflare Pages 连接代码仓库，构建命令填写 `npm run build`，输出目录填写 `dist`。环境变量在构建时注入。也可将本地完成构建的 `dist` 作为静态目录上传。

`public/_redirects` 将随构建复制到输出目录，其中的 `/* /index.html 200` 为前端路由提供回退。不要把敏感信息放在 `public` 或 `VITE_` 环境变量中。

参考：[Pages React 部署](https://developers.cloudflare.com/pages/framework-guides/deploy-a-react-site/)、[Pages 重定向配置](https://developers.cloudflare.com/pages/configuration/redirects/)。

## Cloudflare Workers

仓库的 `wrangler.jsonc` 已配置 `server/worker.mjs`、ASSETS 静态资源绑定及 `/api/*` 优先进入 Worker。轨迹转换与地理定位在 Worker 执行，其他请求交给 `dist` 单页应用。配置与未执行的原子 RPC 见 [轨迹导入与活动足迹](轨迹导入与活动足迹.md)。选择此方式时仍需先执行 `npm run build`，再用已登录且具备项目权限的 Wrangler 发布。应在目标 Cloudflare 账号、站点名和域名得到确认后执行发布；本次未执行。

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

在 Supabase Auth 启用邮箱登录，配置正式 Site URL 和邮件验证回跳 URL（网站的 `/login`）。注册调用 `signUp`，如项目要求邮件验证，界面提示用户查看邮件，不假定已经登录。登录调用 `signInWithPassword`。

后台先读取会话，再向 Auth 服务器调用 `getUser` 核实用户。只有服务器返回的 `user.app_metadata.role === 'admin'` 才能进入云端管理。注册表单不会也不能授予管理员角色。管理员应由受信任的后台管理流程赋予 `app_metadata.role`；不能使用用户可编辑的 `user_metadata` 作为权限依据。

`onAuthStateChange` 回调只安排后续验证，不在同步回调中等待其他 Auth 方法，避免 Auth 锁死。离开页面会退订。密码修改调用真实的 `updateUser({ password })`，无云端配置时不能修改账号密码。

`app_metadata` 的 JWT 声明可能滞后于后台角色变更。赋权、撤权后刷新/撤销相应会话；生产环境需按组织要求设计即时撤权机制。界面权限仅用于展示，数据权限始终由数据库 RLS 判定。

参考：[signInWithPassword](https://supabase.com/docs/reference/javascript/auth-signinwithpassword)、[signUp](https://supabase.com/docs/reference/javascript/auth-signup)、[getSession](https://supabase.com/docs/reference/javascript/auth-getsession)、[getUser](https://supabase.com/docs/reference/javascript/auth-getuser)、[onAuthStateChange](https://supabase.com/docs/reference/javascript/auth-onauthstatechange)、[updateUser](https://supabase.com/docs/reference/javascript/auth-updateuser)。

## 数据库审核草案

`docs/supabase-schema.sql` 是供**新项目审核**的 SQL 草案，尚未在任何数据库执行。已有同名表时会失败以避免覆盖现有结构。上线前先检查实际表结构、Data API 暴露设置、授权和组织的数据保留要求，再通过正式迁移流程应用。

- `content_items` 保存活动、路线、影像和文章。普通访问者只能读取 `published = true` 且 `payload.isDemo` 不为 true 的记录。默认不发布。
- 管理员可通过 RLS 创建、读取、更新、删除内容。UPDATE 同时具有 USING 与 WITH CHECK；账号角色来自受信任的 app_metadata。
- `applications` 使用外键关联内容和登录用户，用户只能为自己、针对已发布的非示例活动提交一次申请；还必须开启报名、活动未结束且报名截止时间仍在未来。用户只能查看自己的申请。管理员仅增加读取权限。未授予前端更新、删除申请的权限。
- 两表均显式开启 RLS 并配置最小表级授权；申请表无匿名授权。数据库不含 service key 或绕过 RLS 的函数。

后台活动/路线/影像/资讯编辑器在云端管理员模式使用 `content_items`，保存/删除成功以数据库响应为准。前台正式内容读取、报名表单写入、文件上传、成员账号管理、网站设置同步和项目/足迹数据模型仍需按实际业务完成接入；当前未实现的功能均标明待接入。云端启用不代表整个业务流程已上线。

上线前在隔离测试项目验证以下矩阵：

| 身份 | 必须允许 | 必须拒绝 |
| --- | --- | --- |
| 未登录 | 读取已发布非示例内容 | 读取草稿/示例、写内容、读取/写入申请 |
| 普通用户 A | 读取公开内容、提交/读取本人有效活动申请 | 管理内容、读取用户 B 申请、以 B 身份报名、为路线/未发布/示例内容报名 |
| 管理员 | 管理全部内容、读取全部申请 | 通过前端获得 service key 或未经设计的申请改写权限 |

应测试重复报名唯一约束、外键约束和 Auth 错误；用 Supabase 的数据库安全检查器复核策略。此交付没有真实项目凭据，因此未能执行在线认证、RLS 或 SQL 集成测试。

参考：[Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)。

## 本地设计预览

未提供有效云端配置时，后台明确显示“本地设计预览”。提供配置后，也可以显式访问 `/admin?preview=1` 进入同一纯本地预览，导航会保留该模式，无法借此读写云端管理数据或修改账号密码。初始没有真实内容；示例切换只读，且不计入统计。创建、编辑、删除仅修改当前浏览器 `chuanheng-drafts`，没有云端提交或正式发布。

协会名称、标语和 Logo 地址保存在 `chuanheng-settings`，只用于本浏览器预览。数据可能因清理浏览器而丢失，不是备份，不适合保存报名资料、密码或其他敏感个人信息。接入云端后不会自动将本地草稿上传。账号和服务配置页不伪造账号清单或连接状态。

## 交付前检查

运行测试与生产构建；检查移动端菜单、登录密码显隐、搜索筛选、CRUD 表单以及深色背景上的文字对比。手动验证页面刷新仍能访问 `/activities`、`/login` 与 `/admin/routes`。正式发布前替换协会介绍、联系方式及授权素材，并补齐尚未接入的业务流程。
