# 川衡 V1.0.0 工作区

React + Vite 川衡官网，使用 Cloudflare Workers 和 Supabase。发布基线以 main 分支提交记录为准。旧系统私有数据保留，不迁入旧示例。

- 使用简体中文沟通。保留黑白、品牌橙及官方原色圆形徽章，AI 图像与示例数据不得充当真实协会记录。
- Node.js 24；`npm ci`、`npm run dev`（127.0.0.1:5178）、`npm test`。本地构建为 `npm run build`，正式构建为 `npm run build:production`；授权重复发布可用 `npm run deploy`。正式脚本只从 Wrangler 配置读取项目地址及 publishable 公钥，固定 live 模式。Windows 目录是联接时优先使用实际目录，Vite 已使用 realpath。
- 轨迹后端位于 `server/tracks`，生产入口 `server/worker.mjs`；本地 Vite 适配和生产 Worker 使用同一解析器。生产上传必须由服务端验证可信领队/管理员身份。
- GPX/KML 统一由路线管理上传；活动选择路线并保存当时的轨迹快照，后续路线修改不改写历史活动。多段同图、海拔分段，不补造缺失海拔或省市归属。
- 里程与爬升优先读取轨迹自动统计；缺失时仅在路线管理弹窗补充，保留原统计，并记录 `manualMetrics` 的管理员来源与确认时间。可跳过，未知值显示“暂不提供数据”并在 Debug 提醒。活动编辑器只读展示路线快照指标，不另设输入。
- 自动路线去重须明确选择，归档保留原数据和审计；更新、删除与跨标签页编辑须保护活动关联。
- Supabase 项目 `gftecgpbhiubrkmazlcu` 已应用 `20261031074956_chuanheng_v1_content_and_tracks`、`20261031131635_activity_route_scheduling`、`20261031142417_route_manual_metrics_and_cover_limit`、`20261031163237_activity_registration_management`、`20261031163336_gallery_photo_upload` 与 `20261031185118_activity_payment_proofs`；`public.content_items/applications` 为新模型，初始化为空，现有管理员内容保留。旧 `chuanheng` 全部表与数据原样保留。不得重复执行两份 docs SQL 的 CREATE 或把示例迁为正式内容；后续变更使用针对性迁移。
- 报名预设人数为正整数；有效报名按服务器时间排队，名额内入选、其余候补，退出后递补，重报排队尾。报名须确认姓名、身份证、活动手机号和用途；手机号预填个人设置号码，仅本次修改不回写账户。资料与报名原子保存，补资料不重排；保险已购买锁定更改，相同投保资料重报可保留保险排队尾。会员仅可读本人和匿名汇总，网站不读取、显示、修改或删除日志，受控业务只追加审计，历史维护仅限Supabase受信数据库管理；自动缴费调整暂未实现。当前规则见 `docs/member-insurance-retention-workflow.md`。
- 微信收款码由后台「服务配置」全站统一上传修改；缴费状态 unpaid「未缴费」、pending「应已缴费」、paid「已缴费」均为白字，姓名左侧圆点分别白/蓝/绿。有效入选者提交私有图片后pending，管理员核实后paid，不是自动到账。原图JPEG/PNG/WebP最多8MiB，同源验证及Images处理后新WebP最多1MiB，历史3MiB图在清理前仍可授权查看；审核须核对旧状态和最新proof ID，禁止覆盖图片，真实删除只通过受控活动清理。
- 个人设置 `/settings` 保存本人用户名、选填真实姓名和个人手机号，展示本人活动记录，不显示或修改邮箱；既有邮箱Auth登录保持。身份证与活动手机号在private临时表，永不放Auth metadata/JSON/localStorage/审计日志。管理员保险默认未购买，确认已购买前二次确认；Excel仅导出有效入选者，号码文本防科学计数/公式，迟到且跨到期/清理代次/账号的导出必须丢弃。
- 活动结束立即阻止敏感读写，受信Cron每3分钟清除身份证、活动手机号及全部缴费图并核验，连续两个实际间隔至少180秒的空核验才停止；公平排队、同槽防重复、租约和失败重试。手动入口从报名开启可用，须两次确认，暂缓敏感提交且完成后未结束可恢复收集；自动封存后改期不恢复。保留姓名/结果/日志和个人手机号。Storage必须API真实删除，覆盖历史和未关联对象；Vault唤醒凭证及Edge运行时服务密钥不得输出或复制至前端/Cloudflare。
- 活动具有报名开启/截止、活动开始/结束四时间；数据库按服务器时间校验报名窗口。旧记录时间缺失不自动补造。正式封面原图 JPEG/PNG/WebP 最大 3 MiB，经 `server/covers` 同源管理员验证及 Images binding 后端压缩为 WebP，再以新文件名上传至 `activity-covers` 本人目录；存储上限 3 MiB。压缩失败不得回退原图，换图不覆盖或删除历史文件。
- Cloudflare 目标为 `chuanheng-website`，部署与验收记录见 `docs/PRODUCTION-HANDOFF.md`。SPA 回退由 Worker assets 配置处理，禁止恢复 `_redirects` 通配 `/index.html` rewrite，以免触发 Cloudflare 100324 循环。
- Supabase/Cloudflare 平台账户、站点 Auth 用户及旧会员表记录是不同身份。站点用户注册并确认邮件后，由受信后台为对应 Auth UUID 赋 `app_metadata.role=admin`；注册和 `user_metadata` 不授予管理权。
- 密钥、用户数据、运行日志、node_modules、dist、artifacts 不提交。`VITE_` 变量不得包含服务端密钥。
- 地图、字体、图片保留来源记录；边界数据授权限制见 `server/geography/SOURCE.md`。本地可用不等于公开发布已获授权。
- 修改后运行对应测试；提交前运行全套测试与生产构建。Worker 修改需额外验证无 Node 依赖打包。诚实区分自动测试、实机检查和云端联调。

入口说明：README.md、docs/轨迹导入与活动足迹.md、docs/activity-route-workflow.md、docs/DEPLOYMENT.md、docs/PRODUCTION-HANDOFF.md。
