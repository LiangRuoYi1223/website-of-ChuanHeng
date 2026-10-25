# 川衡网站 · 协作指南

本文件适用于本项目根目录及其子目录。开始任务时先读本文件；子目录若有更具体的 AGENTS.md，同时遵循该目录的约定。用户在当前任务中的明确要求优先。

## 项目与工作方式

- 这是南方科技大学川衡登山协会网站，包含活动与足迹、认识川衡、登山队、合作页面，以及登录、账号管理、活动报名和内容后台。
- 默认用简体中文沟通，说明实际修改、验证结果和未完成事项。可直接完成已授权的本地修改，遇到影响范围或结果的缺失信息再询问。
- 开工先查看 `git status --short` 和相关文件。工作区可能已有大量未提交内容，保留用户及其他任务的修改，不擅自回滚、清理、覆盖或一并提交。
- 按任务控制改动范围，沿用现有结构和依赖，不附带重构、升级工具链或重新设计整站。
- 文档与代码不一致时，先核对实际实现和相关测试；在任务范围内同步修正过时说明，不照搬旧结论。

## 优先阅读

| 任务                         | 入口                                                                                                                          |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 本地运行、业务功能、内容维护 | `README.md`、`package.json`                                                                                                   |
| 界面与视觉                   | `DESIGN.md`、`DESIGN_TOKENS.md`、`src/design-tokens.css`                                                                      |
| 产品定位、示例内容边界       | `PRODUCT.md`，其中早期“纯演示／后台未接入”描述需结合当前代码判断                                                              |
| 云端运行与部署               | `DEPLOYMENT.md`、`wrangler.jsonc`、`worker/index.mjs`                                                                         |
| 图片、字体、地图来源         | `public/images/ASSETS.md`、`public/images/COOPERATION_ASSETS.md`、`public/fonts/SOURCE.md`、`src/features/map-data/SOURCE.md` |

当前网站已接入后端。README 的历史版本记录不是当前权限或视觉规范；当前视觉采用冷白与岩松绿，当前账号使用三级角色及独立社长标记。

## 技术与目录

- 使用 Node.js **24.x**、npm 和 `package-lock.json`。前端为 React 19、TypeScript、Vite 7、React Router；后端为 Node.js ESM（.mjs）。已有服务使用 `node:sqlite`，不要降级运行环境。
- TypeScript/TSX 沿用 ES 模块、函数组件和现有命名、缩进风格。服务端输入验证、权限和数据操作继续在服务端执行。

| 路径                                                                     | 职责                                                   |
| ------------------------------------------------------------------------ | ------------------------------------------------------ |
| `src/App.tsx`、`src/main.tsx`                                            | 路由、公开内容上下文、登录与网站状态入口               |
| `src/pages/`                                                             | 活动及详情、认识川衡、登山队及项目详情、合作页面       |
| `src/features/`                                                          | 章节阅读、日历、筛选、相册、足迹地图、出发准备等功能   |
| `src/auth/`、`src/admin/`                                                | 登录与账号、前端权限、后台内容及服务管理               |
| `src/api.ts`、`src/types.ts`                                             | 同站 /api 请求封装与共享数据类型                       |
| `src/demo-content.ts`、`src/cooperation-content.ts`                      | 作者演示内容、合作文案及手册内容来源                   |
| `src/design-tokens.css`、`src/styles.css`、`src/fonts.css`               | 设计变量、全局样式和本地字体；局部样式随功能文件组织   |
| `server/index.mjs`、`server/validation.mjs`、`server/permissions.mjs`    | HTTP 业务、验证、权限与本地 SQLite 初始化／迁移        |
| `server/cloud.mjs`、`server/postgres.mjs`、`server/supabase-storage.mjs` | 云端应用、PostgreSQL 适配与私有上传存储                |
| `worker/`、`server/fetch-adapter.mjs`、`server/cloudflare-sqlite.mjs`    | Workers 入口、请求桥接与运行时兼容适配                 |
| `supabase/migrations/`                                                   | 云端数据库 SQL 迁移                                    |
| `tests/`                                                                 | Node.js 内置测试；云端测试使用隔离的 PGlite 和模拟存储 |
| `scripts/`                                                               | 开发启动、手册、部署辅助与二维地图数据生成脚本         |
| `public/`                                                                | 随网站发布的图片、字体和手册等静态资源                 |
| `data/`、`uploads/`                                                      | 本地持久化账号、会话、报名和上传文件，受 Git 忽略保护  |
| `docs/`、`output/`、`artifacts/`                                         | 网站维护记录、合作手册 PDF、预览与检查输出             |

## 常用命令

在项目根目录执行；缺少依赖时用 `npm ci` 安装锁定版本。

| 命令                                                   | 用途与注意事项                                        |
| ------------------------------------------------------ | ----------------------------------------------------- |
| `npm run dev`                                          | 同时启动前端 127.0.0.1:5173 和本地 API 127.0.0.1:3001 |
| `npm run dev:web` / `npm run dev:api`                  | 分别启动前端或带监听的 API                            |
| `npm test`                                             | 运行 tests/*.test.mjs 全部自动测试                    |
| `node --test tests/section-reader-navigation.test.mjs` | 按文件运行相关测试的示例                              |
| `npm run build`                                        | 手册同步校验、TypeScript 构建检查和 Vite 打包         |
| `npm start`                                            | 在 5173 预览 dist/；接口功能仍需 `npm run start:api`  |
| `npm run start:api`                                    | 启动 API；已有 dist/ 时可直接通过 3001 访问完整网站   |
| `npm run handbook` / `npm run handbook:check`          | 重建合作手册及封面／校验内容与产物同步                |
| `npm run build:cloudflare`                             | Cloudflare 网站构建                                   |
| `npm run check:cloudflare`                             | 构建并执行 Wrangler 发布预检，不发布线上网站          |

前端开发和构建预览将 /api、/uploads、/images、/docs 代理到 3001，见 `vite.config.ts`。只开前端不足以验收登录、报名、暂停状态及受控图片和手册。端口被占用时先确认进程归属，复用合适的现有服务或只停止本任务启动的服务。

## 代码检查与格式

- ESLint 配置在 `eslint.config.mjs`，覆盖前端 TypeScript/React、Node.js 服务、脚本和测试，并区分浏览器、Node.js 与 Workers 全局变量。生成的地图目录、静态资源及本地数据不参与检查。
- Prettier 配置在 `.prettierrc.json`，忽略范围见 `.prettierignore`。统一使用两空格、单引号、分号、100 列参考宽度和 LF 换行；Markdown 保留原有段落换行。格式规则由 Prettier 负责，ESLint 通过 eslint-config-prettier 避免冲突。
- `npm run lint` 检查代码；`npm run lint:fix` 应用可自动修复项。不要为了消除报告而全局关闭正确性检查。
- `npm run format:check` 检查格式；`npm run format` 统一格式。日常仅格式化修改文件，可用 `npx prettier --write <文件路径>`，避免无关排版差异。
- `npm run typecheck` 单独检查 TypeScript；`npm run check` 顺序运行 lint、格式检查、构建和全部测试。
- React Hooks 调用规则作为错误，依赖检查作为警告；警告需要核实闭包和副作用意图，不机械补依赖导致重新触发业务操作。
- 生成文件应修改生成器后重建，不能为满足格式检查手动改写。新工具配置或目录变更时，同步更新两个工具的适用范围与本文件。
- .gitattributes 将文本统一为 LF，Windows 启动脚本保留 CRLF；不要通过本机 Git 换行设置反复改写格式。
- Windows 项目入口可能映射到其他盘符。构建若报告 HTML 输出含绝对路径，先用 node 的 fs.realpathSync 核对项目实际目录，并从实际目录运行；不要为环境路径问题改动业务逻辑。

## 内容与业务约定

- 演示内容、新库初始化内容与已保存数据分开维护。改 `src/demo-content.ts` 或种子文件不会覆盖用户在后台保存的内容；不能通过删除数据库来让新演示数据生效。
- 结构变更同时核对 `src/types.ts`、页面／后台表单、`server/validation.mjs`、种子数据和本地／云端持久化适配；需要升级存量数据时保留旧内容、账号、会话与报名。
- 示例活动、项目、人员资质和 AI 示意图片保持明确标记。不得编造真实攀登成果、证书、赞助品牌、联系方式或可扫描二维码。
- 当前角色为 admin、member、viewer；社长是管理员的 `isPresident` 标记，不是第四种角色。权限变更同时核对前后端，不能只隐藏按钮。
- 管理员可管理内容和账号；网站暂停／恢复需要社长身份与当前密码。保留最后一位有效管理员，以及暂停期间最后一位有效社长的保护逻辑。
- 报名条件由服务端校验：允许的账号身份、已发布、未来活动、非示例且 `registrationOpen` 明确开启。新活动默认关闭报名。
- 暂停状态须持久化，公开内容、上传图片、内置图片和手册均需经过相应检查；保留管理员维护与恢复入口，不能用演示内容回退绕过暂停状态。
- 活动宣传路线使用 `routeName`，城市使用 `cityCode`；沿用本地城市目录和足迹聚合逻辑，保留未选城市可保存的行为。

## 界面与资源

- 延续已有山野杂志视觉：冷白、岩松绿，登山队与页脚使用深松绿。优先复用设计变量和组件，具体数值以 `src/design-tokens.css` 与视觉规格为准。
- 浅色故事标题采用思源宋体，中文正文与界面采用思源黑体，英文及数字采用 DM Sans；字体保持本地托管，保留来源与许可。
- 桌面为主要验收端，同时检查窄屏布局、键盘操作、焦点、弹窗关闭与恢复、图片替代文字及减少动画偏好。
- 修改分章阅读时，检查滚轮惯性、章节内滚动、嵌套列表、锚点跳转、浏览器前进后退和阅读进度；复用 PageReader／SectionReader 及对应导航逻辑。
- 修改二维地图、字体或图片时保留来源、许可与生成记录；私有资料不得放入 public/。

## 合作手册同步

- 手册由作者内容生成；在线项目列表来自数据库，数据库修改不会自动更新 PDF。先将已确认内容同步到作者文件，再重建手册。
- 修改手册引用的文案、项目或图片后，运行 `npm run handbook`，再运行 `npm run build`；不要通过手改校验文件跳过过期检测。
- 保持以下成果同步：`public/docs/chuanheng-partnership-handbook.pdf`、`output/pdf/chuanheng-partnership-handbook.pdf`、`public/images/handbook-cover.png`、`public/docs/handbook-manifest.json`。
- 重建需要 Python 和 `scripts/handbook-requirements.txt` 中的作者依赖，环境及字体选择见 README；普通网站构建无需重建 PDF 或安装 Python。
- 检查 `artifacts/previews/handbook/` 的全部逐页预览，确认中文、分页、图片、页边距和示例标记。

## 数据、密钥与发布

- .env.local、.dev.vars、data/、uploads/ 可能含真实密钥、账号、报名和上传资料。不要在日志、截图、回复、提交或发布包中泄露；只需要配置结构时读 `.env.example`。
- 浏览器只调用本站 API；数据库密码和 Supabase 后端密钥仅供服务端使用，禁止放入 VITE_*、前端源码或公开资源。账号接口不得返回密码或散列。
- 本地测试使用临时数据目录。手工浏览器验证可使用 `node tests/browser-fixture.mjs`，它在 3002 启动隔离站点，使用合成账号并将数据写入 artifacts/browser-checks/；先构建网页。
- 当前部署目标为 **Cloudflare Workers + Hyperdrive + Supabase PostgreSQL／私有存储**，沿用现有自建账号体系。旧 `api/`、`vercel.json`、`render.yaml` 和 build:cloud 属于其他部署方案，未要求时不要混用或删除。
- Cloudflare 使用 build:cloudflare，保留 ASSETS 的 `run_worker_first: true`。旧 build:cloud 会执行 Vercel 资源准备，不适合作为 Cloudflare 构建命令。
- cloud:check 会向真实云端上传并删除测试图片；cloud:setup、president:setup 会操作账号或数据库；`scripts/configure-hyperdrive.mjs` 涉及凭据传输；deploy:cloudflare 会发布网站。这些不是普通只读检查，仅在用户授权的对应任务范围内执行。
- 不重置已初始化的云端数据库，不自动开通付费服务。不要从历史文档或已有绑定编号推断实时部署状态，发布任务中重新核实。
- 山体叙事、地形和校园模型功能已取消，相关工程、原始数据、脚本、文档及预览已移除，不作为后续任务或部署依赖。网站二维足迹地图与活动、项目中的山峰介绍继续保留；路线 3D 打印自动化属于独立项目。

## 验证与交付

- 只改文档时，核对路径、命令和描述与代码一致，并检查差异；无需为此运行完整应用测试。
- 修改代码后运行相关测试及 `npm run build`。涉及权限、迁移、请求桥接或公共服务逻辑时运行 `npm test`，同时覆盖本地与云端实现。
- 涉及 Workers 打包或部署配置时额外运行 `npm run check:cloudflare`；预检成功不等于线上连接或功能验收成功。
- 界面变更除构建外还需实际浏览器检查桌面与窄屏，测试受影响的交互；涉及账号与写入操作时使用隔离站点。
- 交付时简要列出改动、实际执行的检查和结果、已知限制。检查因环境或依赖无法执行时如实说明，不将旧测试记录当成本次验证。
