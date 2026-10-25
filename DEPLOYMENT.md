# 川衡网站：Supabase + Cloudflare 上线

网站部署目标已改为 Cloudflare Workers。Supabase 数据库、私有图片存储与初始示例内容继续使用。本仓库仅维护协会网站。

## 目前状态

- Supabase 已初始化，初始管理员用户名为 `admin`；初始密码保存在本机私有配置，首次登录需要修改。
- 网站已添加 Workers 入口和 `wrangler.jsonc`，本地构建、功能测试及发布包预检通过。
- Cloudflare 官方部署工具已获用户授权。
- 尚未创建 Hyperdrive、上传生产密钥或发布网站。创建 Hyperdrive 需要把数据库连接凭据交给 Cloudflare；该操作等待用户明确批准。
- 本地 Workers 网页可访问；直接连接 Supabase 的 TLS 兼容性检查失败，生产连接改用 Hyperdrive。Hyperdrive 与线上接口仍待真实验收。

## 云端安排

| 部分                 | 服务                                                              |
| -------------------- | ----------------------------------------------------------------- |
| 网页与接口           | 同一个 Cloudflare Workers 应用，名称 `chuanheng-website`          |
| 账号、报名、后台内容 | Supabase PostgreSQL 私有 `chuanheng` schema                       |
| 数据库连接           | Cloudflare Hyperdrive；关闭查询缓存，校验 Supabase 根证书和主机名 |
| 后台图片             | Supabase 私有 `chuanheng-uploads` 存储桶                          |
| 内置图片与合作手册   | Workers ASSETS；每次经接口检查暂停状态后提供                      |

浏览器只调用本站接口，不接触数据库密码和 Supabase 后端密钥。继续沿用现有账号体系，无需配置 Supabase Auth。

## 1. 本机配置

`.env.local` 被 Git 忽略，用于数据库初始化和云端连接检查。

| 变量                      | 用途                                                              |
| ------------------------- | ----------------------------------------------------------------- |
| `DATABASE_URL`            | 本机检查用的 Supabase Transaction pooler 连接串；包含数据库密码   |
| `DATABASE_CA_CERT`        | Supabase 根证书 PEM；支持字面量 `\n` 换行                         |
| `SUPABASE_URL`            | Supabase 项目 HTTPS URL                                           |
| `SUPABASE_SECRET_KEY`     | 后端 Secret key 或旧版 service_role；不可使用 `VITE_` 前缀        |
| `SUPABASE_STORAGE_BUCKET` | `chuanheng-uploads`                                               |
| `SITE_ORIGIN`             | 发布后的网站 HTTPS 地址，不含结尾斜杠                             |
| `INITIAL_ADMIN_PASSWORD`  | 仅初始化使用，不上传至 Cloudflare                                 |
| `PRESIDENT_USERNAME`      | 用户自选的社长登录账号，供一次性创建命令使用                      |
| `PRESIDENT_PASSWORD`      | 用户填写的社长初始密码，创建后从本机配置清除，不上传至 Cloudflare |
| `PRESIDENT_DISPLAY_NAME`  | 可选的社长显示名称                                                |

数据库已经初始化，不要重新运行初始化或删除已有数据。可以运行 `npm run cloud:check` 检查连接和私有存储；该命令会上传并删除一张微小测试图片。

社长账号与密码由用户自行填写。已有管理员可在「账号与权限 → 新建社长账号」使用空白表单创建；或填好上述 `PRESIDENT_*` 变量后运行 `npm run president:setup -- --cloud` 向已有 Supabase 数据库添加社长。本地 SQLite 使用 `npm run president:setup`。命令不覆盖已有同名账号，不重置已有社长密码，也不重新初始化数据库；新账号首次登录须修改初始密码。社长与所有管理员都能查看完整账号及权限，社员可经「设为管理员 → 保存账号修改」授权后重新登录。

`.dev.vars` 是被 Git 忽略的 Workers 本地测试配置，与生产密钥分别保存。不要上传整个项目文件夹或 `.env.local`。

## 2. Cloudflare 授权与数据库连接

Cloudflare 控制台登录和部署工具授权是两个步骤。工具尚未登录时运行 `npx wrangler login`，由用户在官方页面点击 Allow。

获得用户对凭据传输的明确授权后，运行：

```powershell
node scripts/configure-hyperdrive.mjs
```

这个脚本从本机配置读取数据库密码，上传 Supabase 根证书，使用 Supabase Direct connection 创建 `chuanheng-supabase` Hyperdrive。它开启 `verify-full`、关闭查询缓存，并把返回的真实绑定编号写入 `wrangler.jsonc`；不会输出密码或后端密钥。连接失败时保留原有 Supabase 数据。

Hyperdrive 的生产连接由 Cloudflare 管理。Worker 使用运行时 `HYPERDRIVE` 绑定，每个请求拥有独立连接，结束后关闭，避免跨请求共享连接。

官方参考：[Supabase 与 Hyperdrive](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/supabase/)、[Hyperdrive 证书校验](https://developers.cloudflare.com/hyperdrive/configuration/tls-ssl-certificates-for-hyperdrive/)。

## 3. 发布

先确定本账号的 workers.dev 子域名，并将实际网站地址保存到生产 `SITE_ORIGIN`。

Cloudflare 后端需要保存 `SUPABASE_URL`、`SUPABASE_SECRET_KEY`、`SUPABASE_STORAGE_BUCKET` 与 `SITE_ORIGIN`。数据库密码保存到 Hyperdrive；无需作为普通 Worker 变量再次保存，也不上传初始管理员密码。`NODEJS_HELPERS` 只适用于旧 Vercel 方案，Cloudflare 不使用它。

```powershell
npm run check:cloudflare
npm run deploy:cloudflare
```

检查命令只构建并预检，部署命令会发布应用及 `dist` 静态资源。不要用旧 `build:cloud` 命令发布 Cloudflare；该旧命令会移除图片和手册。Cloudflare 使用 `build:cloudflare`，通过 `run_worker_first: true` 保证图片和文档先经过暂停检查。

本次可以直接从本机发布，不必先推送 GitHub。以后若启用 Git 自动部署，只提交网站相关修改；构建命令为 `npm run build:cloudflare`，部署命令为 `npx wrangler deploy`。密钥配置在 Cloudflare，不能提交到仓库。

## 4. 上线验收

- 首页与详情页可以直接打开、刷新；`/api/site-status` 返回 JSON。
- `/login` 使用初始管理员登录并修改密码；后台保存的内容刷新后仍然存在。
- 图片上传、读取与合作手册下载正常；上传限制保持 3 MB。
- 社员可对已发布、未来日期、非示例、明确开放报名的活动报名和取消。
- 社长暂停网站时，访客不能读取公开内容、图片与手册；管理员可以维护并恢复网站。
- 重新部署后，数据库和已上传图片仍保留。

登录保留原有 scrypt 密码保护。上线需检查 Cloudflare 的实际 CPU 用量；如果免费额度无法承载登录计算，应先与用户确认方案，不自动开通付费套餐。平台限制见 [Workers Limits](https://developers.cloudflare.com/workers/platform/limits/)。

## 本机开发

`npm run dev` 继续使用本机 SQLite。`npm test` 验证账号、权限、报名、暂停状态、PostgreSQL 适配及 Workers 请求桥接；测试不修改真实云端数据库。Cloudflare 发布包仅包含 Worker 的依赖和 `dist`，不包含本机账号数据、私有环境文件或制作预览。
