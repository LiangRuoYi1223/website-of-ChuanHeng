# 川衡 V1 生产交接与回滚

## 当前发布：注册验证码长度修正（北京时间2026-11-02）

用户实际收到8位验证码，而首次前端实现将输入长度和正则固定为6位，导致输入被截断、无法验证。现允许输入6–10位完整数字验证码，与Supabase支持的邮件验证码长度范围一致；保留前导零，提示不再写死“六位”。码是否正确、实际长度及有效期仍由Auth服务器核验。本次不调整Supabase验证码设置、邮件模板或身份权限。

| 项目 | 本次确认结果 |
| --- | --- |
| 修复提交 | `af7f29c2d3b2410845abd3ca2e4d2b92295dde55`，已推送GitHub `main` |
| 正式发布 | 2026-11-02 00:50（北京时间），Worker `e40417e0-2985-42ec-ae79-1adb1c1384fb`，100%流量；部署ID `f8d12df5-8341-48de-a36e-bdc0fdcac1ff` |
| 自动验证 | 先复现6位限制的失败用例，再完成修复；针对性17/17、完整集逐项运行567/567、生产构建通过；独立审查未发现需修复项 |
| 覆盖范围 | 合成6/7/8/9/10位数字均通过浏览器校验并经真实按钮完整传入`verifyOtp`；8位前导零保留；5/11位、空、字母及全角数字拦截；未将用户截图中的真实邮箱或验证码写入测试 |
| 线上核验 | 00:52注册入口HTTP200并确认引用新入口`/assets/index-DMI4qKc0.js`；Cloudflare管理面确认本次版本承担100%流量；Wrangler确认`index.html`与变更JS上传成功 |
| 验收边界 | 线上JS的SHA-256核验在两次连接尝试后仍受TLS中断影响，未记为通过；未提交用户真实验证码或操作其邮箱；真实验证码登录与浏览器实机输入仍需用户验证 |
| 回退版本 | `05cf46d1-69ce-46d9-bf9a-3bfe76464f1e`；该旧版包含已知6位输入限制，回退会恢复此问题 |

运行证据位于ignored `artifacts/otp-length-fix-tests.log`、`artifacts/otp-length-fix-build.log`、`artifacts/otp-length-fix-deploy.log`、`artifacts/otp-length-fix-before-deploy.json`、`artifacts/otp-length-fix-after-deploy.json`及`artifacts/otp-length-fix-live-verification.json`。无需数据库迁移，未写入真实会员资料或重发注册邮件。

## 上一发布：注册邮箱六位验证码（北京时间2026-11-02）

注册提交邮箱和密码后，在同一页面输入注册邮件中的六位数字验证码；成功取得会话并由Auth服务器核实用户ID及邮箱后，返回原站内页面，无返回目标时回首页。支持错误/过期重试、60秒后重发和更换邮箱；切换登录或离开验证步骤后，迟到响应不能恢复旧页面或触发跳转。邮箱确认前不会假称已登录，注册不授予管理员角色。

| 项目 | 本次确认结果 |
| --- | --- |
| 功能提交 | `c7ee903161347a3123d4c53ca4f33974ef63640f`，已推送GitHub `main` |
| 正式发布 | 2026-11-02 00:18（北京时间），Worker `05cf46d1-69ce-46d9-bf9a-3bfe76464f1e`，100%流量；部署ID `7af622a1-dd86-479e-b79d-d3cc84385de5` |
| 正式网站 | https://chuanheng-website.vulhusky.workers.dev/login?mode=register |
| Supabase | 项目`gftecgpbhiubrkmazlcu`为`ACTIVE_HEALTHY`；公开Auth设置确认邮箱注册启用、注册未关闭、必须邮件确认；本次使用现有`verifyOtp`/`resend`接口，无需数据库迁移，未改写SMTP或用户已配置的邮件模板 |
| 自动验证 | 提交前完整测试逐项运行566/566通过，生产构建通过；独立代码审查和发布范围检查通过；涵盖前导零、非法格式、错误/过期、身份不符、重发冷却/限流、安全回跳、重复提交与迟到响应 |
| 线上核验 | 首页与注册入口HTTP200，均确认引用新入口`/assets/index-82UQRgjg.js`；Cloudflare管理面确认本次Worker承担100%流量；本地构建样式为`index-VJH47iGR.css` |
| 资源与数据 | Wrangler确认3个变更静态资源上传成功；完整线上资源SHA-256核验因当前网络反复TLS连接中断未完成；未写入真实会员、活动或报名资料，未发送测试注册邮件 |
| 回退版本 | `16ad12ed-02b0-4982-ba3f-43e2cc897a14`；保留此前活动费用、登录状态和报名敏感资料清理规则 |
| 验收边界 | 自动DOM与Auth边界使用合成数据；未进行真实邮件收取、实际验证码提交及浏览器实机截图验收；不能将页面HTTP200等同于真实邮件流程已经验收 |

提交前测试和构建记录分别保存在ignored `artifacts/signup-email-otp-publish-tests.log`、`artifacts/signup-email-otp-publish-build.log`；部署记录为`artifacts/signup-email-otp-deploy.log`，前后Cloudflare版本快照为`artifacts/signup-email-otp-before-deploy.json`、`artifacts/signup-email-otp-after-deploy.json`。线上检查摘要为`artifacts/signup-email-otp-live-verification.json`，明确区分已确认入口与未完成的资源哈希检查。

## 上一发布：活动报名费用（北京时间2026-11-01）

后台活动编辑在预设人数下方新增“报名费用（元）”。金额随每场活动单独保存，支持两位小数；留空为“未公布”、0为“免费”，正数统一显示为如`¥12.50`。活动资料、报名区域和缴费窗口使用同一金额。现有活动不自动填价，由管理员填写实际费用。

| 项目 | 本次确认结果 |
| --- | --- |
| 功能提交 | `b78507dca46652798b75e55770119d4ef18c6e99`，已推送GitHub `main` |
| 正式发布 | 2026-11-01 22:35（北京时间），Worker `16ad12ed-02b0-4982-ba3f-43e2cc897a14`，100%流量 |
| 金额存储 | 活动JSON可选`registrationFeeCents`整数分；十进制精确转换，拒绝负值、超两位小数和不安全数值；旧记录缺失键保持未知，清空已有值保存null |
| 前台行为 | 未登录、候补、入选均可看金额；切换活动不沿用旧金额；免费配置不自动修改人工缴费状态 |
| 自动验证 | 最终全套559/559通过，生产构建和独立审查通过；涵盖后台保存/回填/清空、RPC参数及并发预期、金额精度、报名区和缴费窗口 |
| 线上核验 | 22:39完成；5个页面HTTP200，全部8个JS/CSS资源HTTP200且SHA-256与本地一致；入口`index-3RjehpXy.js`、样式`index-UtpndSS2.css` |
| 服务与数据 | `/api/tracks/status`为HTTP200、`configured:true`、`localPreview:false`；无需数据库迁移；未写入真实活动价格或会员资料 |
| 回退版本 | `62d0f596-c7b7-445e-92e3-a8ab923ce59a`；保留登录状态、状态标签、报名缴费及敏感资料清理规则 |
| 验收边界 | 前台/后台DOM与RPC边界为合成自动测试；线上核验为版本、页面、资源及服务状态；未进行真实管理员金额写入或Windows浏览器截图验收 |

首次并行构建时，既有`activity end immediately hides an already opened proof and disables sensitive actions`及`final identity verification crossing end also discards export and server cleaning blocks a completed response`两个短时序用例失败；独立复核21/21通过，停止并行构建后最终全套559/559通过。未修改相关用例或放宽到期规则。

最终测试、部署及线上核验记录分别保存在ignored `artifacts/registration-fee-publish-final-tests.log`、`artifacts/registration-fee-deploy.log`与`artifacts/registration-fee-live-verification.json`。

## 上一发布：活动状态标签文字恢复（北京时间2026-11-01）

活动详情的分类文字样式曾覆盖状态标签前景色，导致“报名中”与橙色背景同色。现仅收窄分类选择器，排除`.status`，恢复“报名中”橙底深色文字，以及其他状态原有的黑/白文字；普通活动分类文字保留品牌橙。活动状态计算、组件逻辑、数据库与Worker接口未修改。

| 项目 | 本次确认结果 |
| --- | --- |
| 修复提交 | `054cc243956f7d994dc5545a6096c816128f1391`，已推送GitHub `main` |
| 正式发布 | 2026-11-01 21:44（北京时间），Worker `62d0f596-c7b7-445e-92e3-a8ab923ce59a`，100%流量 |
| 自动验证 | 全套542/542通过；生产构建通过；单选择器改动独立审查通过 |
| 配色检查 | 源样式两种加载顺序及线上实际CSS共9项状态文字检查通过；普通分类文字仍为橙色 |
| 线上核验 | 21:48完成；首页、活动、个人设置、登录、后台5个入口HTTP200；全部8个JS/CSS资源HTTP200且SHA-256与本地一致；入口`index-ICi4_-gY.js`、样式`index-BS2YFSod.css` |
| 服务状态 | `/api/tracks/status`为HTTP200、`configured:true`、`localPreview:false`；无需数据库迁移 |
| 回退版本 | `bb0cd7e5-ba49-4154-b489-89c080242324`；保留前次用户名显示、保险报名与敏感资料清理规则 |
| 验收边界 | 已检查实际线上CSS的计算配色，未完成Windows浏览器实机截图验收 |

运行证据保存在ignored `artifacts/activity-status-publish-tests.log`、`artifacts/activity-status-deploy.log`与`artifacts/activity-status-live-verification.json`。

## 上一发布：前台登录状态与用户名显示（北京时间2026-11-01）

登录后右上角显示用户图标和已保存的用户名，点击进入个人设置；未设置用户名时显示“已登录”。窄屏保留用户名，长用户名截断并可查看完整提示。切页、恢复页面、窗口聚焦及重新可见时重新核实会话；修改用户名同步更新桌面及移动菜单，退出和换账号使旧请求失效。

| 项目 | 本次确认结果 |
| --- | --- |
| 正式网站 | https://chuanheng-website.vulhusky.workers.dev |
| 修复提交 | `991ece7acce47c32d60ff79792e75a751ef2a9af`，已推送 GitHub `main` |
| 发布时间 | 2026-11-01 21:24（北京时间）；线上资源核验完成于21:28 |
| Worker | `bb0cd7e5-ba49-4154-b489-89c080242324`，100%流量 |
| 自动验证 | 实际项目目录下全套542/542通过；生产构建通过；独立发布范围审查通过 |
| 页面与资源 | 首页、`/activities`、`/settings`、`/login`、`/admin`均HTTP200并引用`index-CZXiM6w9.js`；全部8个JS/CSS资源HTTP200且SHA-256与本地一致，包括`index-vFrNzW4F.css` |
| 服务状态 | `/api/tracks/status`返回HTTP200、`configured:true`、`localPreview:false` |
| 变更范围 | 前台会话展示、样式及回归测试；无需数据库迁移；未写入真实会员、活动、报名或缴费资料 |
| 回退版本 | 发布前100%版本`a74f0437-088a-4b05-b19b-69f2e28c990e`；保留保险报名、敏感资料清理及现有权限规则 |
| 验收边界 | 已验证自动DOM行为、构建、线上页面和静态资源；Windows浏览器工具因无法可靠识别当前网址停止，未完成真实登录浏览器的实机视觉验收 |

本次运行记录保存在ignored `artifacts/login-navigation-publish-tests.log`、`artifacts/login-navigation-deploy.log`、`artifacts/login-navigation-live-verification.json`。现有保险与清理发布记录保留如下。

## 上一发布：保险报名、个人设置与自动清理（北京时间2026-11-01）

报名确认真实姓名、身份证、活动手机号及用途，号码预填个人设置且本次修改不回写账户。后台登记保险、二次确认购买、仅导出有效入选者Excel；号码为文本。新缴费图自动压至1 MiB，姓名左侧白/蓝/绿圆点、文字统一白色。网站移除日志页签，日志仅Supabase受控追加。

活动结束立即封存敏感读写，Cron每3分钟清除及核验，连续两轮实际至少180秒的空检查才停止。公平队列、同槽去重及租约支持失败重试。手动清理从报名开启可用，须两次确认；期间暂缓敏感提交，完成且未结束可恢复收集。删除活动身份证、活动手机号、全部历史及未关联缴费图；保留账户手机号、姓名和报名/缴费/保险结果。

| 项目 | 本次确认结果 |
| --- | --- |
| 入口 | https://chuanheng-website.vulhusky.workers.dev ／ `/settings` ／ `/admin/activities` |
| 部署源 | `00f5236274dd382a5aafd853e4fe0097346b6d83`；核心 `b89cc2e9457b757cd9b44bf1acbb8eb39dcae5eb` |
| 登录修复 | 另一对话1731f1a已精确整合为3fbf23d，保留独立管理后台及后台「打开网站」新标签页 |
| Worker | `a74f0437-088a-4b05-b19b-69f2e28c990e` |
| 生产迁移 | `20261101045621_member_insurance_retention`、`20261101050040_activity_cleanup_schedule`、`20261101051053_activity_cleanup_permissions`，各执行一次，文件名与远程一致 |
| Edge | activity-data-cleanup v1 ACTIVE，ID ac1ab069-48cc-4ea3-8303-be39ad2adbf7，包SHA-256 deda2b06c51e7a4b56912ce838421783172fc90fb4b2773877931c09ea33da4d |
| 认证 | Edge自有Vault令牌认证，无令牌401；服务密钥仅平台运行环境，网站身份不能领取清理任务 |
| Cron | 唯一job1，active，`*/3 * * * *`；实际计划触发HTTP200、claimed=0/failed=0，当前无到期活动 |
| 自动验证 | 特性与合并后main各537/537；PG17/18含权限迁移各53/53；生产构建通过；Worker50输入，无Node及外部bundle imports；全部独立审查通过 |
| 线上资源 | index-CZvpyipy.js、index-Cn-JG8v0.css、insurance-export-DG7tvVJ4.js均HTTP200且SHA-256与main一致；首页载入新JS，/settings为200 |
| 匿名访问 | 缴费图处理401 AUTH_REQUIRED；资料RPC401/42501；无凭证清理唤醒401 AUTH_REQUIRED |
| 原数据 | 迁移后、上线前2条内容、1条报名原字段、5条日志及0个对象的哈希与迁移前一致；无生产合成身份证/手机号/缴费图 |
| 私有权限 | 网站无日志表SELECT/UPDATE/DELETE；四个private业务表明确restrictive false及表级撤权；旧二参报名入口移除 |
| 验收边界 | 真实本机图片处理/DOM/SQL和云端调度/资源核对；未实测真实支付、保险购买、金融图云端删除、多连接锁竞争或Excel桌面打开。Windows浏览器因无法识别当前URL停止，未做实机视觉验收 |

流程、权限及删除/备份边界见 [会员保险及资料清理](member-insurance-retention-workflow.md)。运行记录为ignored artifacts/registration-management下的insurance-main-tests.log、deploy-insurance-retention.log、insurance-live-verification.json。平台pg_net由supabase_admin持有，项目postgres的REVOKE未移除平台SQL默认授权；实际DataAPI隔离已验证（net为406/PGRST106，GraphQL未启用，网站角色不能登录数据库）。advisors保留该非可移动扩展的命名空间WARN，不能声明零新增；原8个旧schema INFO及密码保护WARN保持，四个新增private无策略INFO已消除。

回滚须保持六参报名、三态缴费/五参凭证CAS和清理兼容。不得恢复绕过资料入口、网站日志读取、清空审计或停用保留期限任务；优先向前修复。恢复数据库备份后先清理到期资料再开放敏感访问，不能靠恢复历史备份重曝已删数据。

## 上一发布：全站微信收款码与缴费记录（北京时间2026-11-01）

服务配置统一管理一张真实微信收款码，所有活动共用。会员缴费窗口展示「付款时请备注姓名」，点击「我已缴费」后须上传缴费记录图片；提交成功后为蓝色「应已缴费」，最终由管理员核实为绿色「已缴费」，未缴费显示白色。活动报名名单可看最新及历史图片。

| 项目 | 本次确认结果 |
| --- | --- |
| 网站／收款码配置 | https://chuanheng-website.vulhusky.workers.dev ／ `/admin/services`（兼容 `/admin/settings`） |
| 部署源提交 | `dd3293dfa2ca87c5f8ff7c24976500f921fd97b7`，核心功能 `9af34552fed59a6c90c5b9964fbd872eba749bdc` |
| Worker版本 | `594f1aec-5880-49ac-a1c3-7c51c0255024` |
| 新生产迁移 | `20261031185118_activity_payment_proofs`，仅应用一次 |
| 自动验证 | 全套476/476，PG17/18各40/40，正式构建通过；Worker dry-run 50个输入，无external/Node依赖 |
| 独立审查 | 安全、界面审查通过；修正管理员手动pending但无图时的提示，避免假称图片已提交 |
| 线上资源 | `/assets/index-BHmoJYvE.js`、`/assets/index-CxpVttOF.css`均HTTP200且SHA-256与main正式构建一致 |
| 入口权限 | 匿名凭证处理401 AUTH_REQUIRED；匿名收款配置RPC401／42501；旧四参数审核RPC已移除 |
| 原数据保留 | 迁移前后2条内容、1条报名原字段、1条报名日志及0个存储对象哈希一致；新凭证与设置日志均0条 |
| 私有存储 | `payment-proofs`为private，仅WebP、3MiB；本人／管理员授权download，禁止网站覆盖删除 |
| 收款码初始状态 | 尚未配置；需管理员在服务配置上传真实图片并保存，全站共用，不制作示例码 |
| 验收边界 | 本地DOM与真实图片处理、云端只读权限／资源核对；未进行实机视觉、真实扫码付款、真实云端凭证上传或多连接锁竞争 |

管理员审核同时核对旧状态与最新凭证ID，避免审核旧图时确认新图；网站也不能改删报名及收款码变更日志。新迁移移除了旧四参数审核接口，回滚须使用兼容三态及五参数CAS的代码，不能直接恢复绕过凭证校验的旧入口或删除凭证／日志。Supabase安全advisors没有新增项，原项目提醒保持。

## 上一发布：活动分区侧栏（北京时间2026-11-01）

用户在localhost比较三种布局后选择「分区切换，排位常驻」。正式活动页现使用活动资料／报名详情双页签，底部显示本人状态和主要操作，入选未缴费时可打开缴费提醒。手机通过底部入口展开模态面板；高度不超过600px时允许整卡滚动，避免短屏裁掉操作。路线与资讯侧栏未改。

| 项目 | 本次确认结果 |
| --- | --- |
| 网站 | https://chuanheng-website.vulhusky.workers.dev |
| 代码提交 | `a8282d8f7708ad2fe92ad1ba5806b9ad9df008da` |
| Worker版本 | `2f272b77-92e5-48c5-b59f-b30c18b84be7` |
| 验证 | 全套433/433，分区与报名DOM针对测试17/17，生产构建通过，独立代码审查通过 |
| 线上资源 | `/assets/index-DAtPnovG.js`、`/assets/index-uN7e1hmF.css`均HTTP200，SHA-256与正式构建一致 |
| 数据库 | 无迁移、无权限变更、未写入生产示例记录 |
| 验收边界 | 本次代码及DOM交互验证；Edge/IAB自动浏览器不可用，未进行实机视觉验收、真实报名或缴费联调 |

报名状态仍只挂载一次，切换页签不重复请求或提交；原身份绑定、排队、退出递补和只追加日志规则保持。回滚可重新部署下列上一统一版本，数据库无需回滚。

## 上一统一发布（北京时间2026-11-01）

报名管理、只追加日志、影像照片直接上传及项目占位入口移除已统一上线。旧私有数据、历史轨迹、封面与现有内容保持原样。

| 项目 | 本次确认结果 |
| --- | --- |
| 网站 | https://chuanheng-website.vulhusky.workers.dev |
| Worker版本 | `dd8eaa85-3f13-4b4f-858d-8d138e69cfb2` |
| 新生产迁移 | `20261031163237_activity_registration_management`、`20261031163336_gallery_photo_upload` |
| 自动验证 | 网站421/421，PG17/18各30/30，生产构建和Worker无Node外部依赖打包通过 |
| 实机范围 | 本地Edge桌面/390px合成数据，报名退出、手动付款、影像压缩预览及保存；不写生产合成记录 |
| 线上入口 | `/assets/index-CUIz_R-f.js`、`/assets/index-CkxJwZLJ.css` HTTP200，SHA-256与本次构建一致 |
| 权限 | 照片处理和后台名单RPC匿名请求均401；网站角色不能直接新增、改写、删除或清空日志 |
| 数据保留 | 2条内容与1条报名原字段哈希一致，原报名时间不变；图片验证未增加生产对象 |
| 图片桶 | `gallery-photos`公开读取，3MiB，仅WebP；管理员本人目录新文件INSERT/SELECT，不覆盖或删除旧对象 |

日志只由业务变更追加，历史修正须Supabase受信数据库管理权限，网站不保存平台密码；自动缴费未实现。历史名额缺失不补造，需管理员明确设置。生产安全advisors无新增项；原有Auth泄露密码保护及旧schema提示保持原样。真实支付、真实用户照片持久化及多连接锁竞争仍待实际验收。

代码基线为main的统一提交及随后发布记录提交。以下为此前交接记录，保留用于追溯，并不覆盖上表的当前版本。

## 此前交接记录（2026-10-31，保留）

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
