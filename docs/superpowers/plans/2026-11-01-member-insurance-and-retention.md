# 会员保险资料与自动清理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成实名保险报名、个人设置、1 MiB缴费图、保险导出与每3分钟连续两轮核验的真实清理。

**Architecture:** 账户资料与活动临时身份证/手机号分离。受控RPC实现报名、保险、导出、双确认清理，受信Edge通过Storage API删除真实文件；Cron每3分钟唤醒，数据库控制每活动的时间和核验次数。会员、后台、后端各自独立文件，统一接口契约。

**Tech Stack:** Node24, React19/Vite7, Supabase Postgres/Auth/Storage/Cron/Edge, Cloudflare Images。

**Spec:** docs/superpowers/specs/2026-11-01-member-insurance-and-retention-design.md

## Global Constraints

- 全部沟通与界面简体中文；保留现有品牌黑白橙及官方徽章。
- 最终缴费图不超过1,048,576字节，原图最多8MiB；历史图最大3MiB仍可授权读取直到清理。
- 自动每3分钟一轮，数据库资料与真实Storage对象连续两轮为空才终止；失败重试不假报成功。
- 只清活动身份证、活动手机号、缴费图；保留个人手机号、姓名快照、报名/付款/保险结果和不可修改审计。
- 手动入口从报名开启时可用，须两次确认；完成后活动未结束可继续正常收集新资料。
- Excel只导出有效入选者，号码按文本；个人设置不显示/修改邮箱；网站不显示操作日志。
- 不覆盖另一工作树改动、不改旧迁移、不写生产合成身份或缴费图、不提交密钥/运行产物。

## Review Focus

- 清理与迟到上传交错，仍须删除全部历史/未关联对象并阻断结束后新增。
- 账号切换/卸载时敏感表单、Blob和迟到响应不能串到另一个账号。
- 两轮成功须跨3分钟，重复唤醒不能立刻累加到2；一次失败重置连续计数。
- 手动清理未结束活动不能永久封死报名，自动到期不能因改期重新开放。
- 保险审核与资料变化冲突必须拒绝，清理后姓名历史及个人手机号仍保留。

---

### Task 1: 受控数据接口和清理状态机

**Files:** Create `supabase/migrations/<CLI-generated>_member_insurance_retention.sql`, `scripts/validate-member-insurance-sql.mjs`; tests share existing isolatedPG harness. Do not edit old migrations.

**Interfaces:** RPC/JSON contract in `.superpowers/sdd/2026-11-01-member-insurance-and-retention/contracts.md`; produces profile, insurance, registration details, admin/export/manual cleanup and service-only cleanup functions.

- [ ] 先在隔离PG写失败用例：有效资料原子报名；旧入口失效；手机号保留分界；保险CAS；匿名/跨用户隔离；日志不可读改；手动两确认；三分钟双轮核验。
- [ ] 使用官方CLI创建新迁移，建立private活动资料、profile和cleanup队列；保留旧报名时间、付款和审计。
- [ ] 加入结束后读写限制和Storage前缀全扫、服务身份领取/完成接口及双确认token；无任意目标删除能力。
- [ ] PG17/18运行完整链并确认新用例全部通过，报告权限及兼容性。

### Task 2: 本人设置和实名报名

**Files:** Create `src/members/profile.js`, `MemberSettings.jsx`, `member-settings.css`, `src/applications/RegistrationDetailsDialog.jsx`; modify `registration.js`, `ActivityApplication.jsx`, `src/session/PublicSessionNavigation.jsx`, `src/App.jsx`; tests `tests/member-profile*.test.mjs`, `registration-details*.test.mjs`.

**Interfaces:** Consumes contract profile/history/register/details RPC; owns member service/form validation. Reuses session commit1731f1a, retains auth invalidation and admin links.

- [ ] 写失败测试：个人设置无邮箱、手机号预填但本次修改不改profile、明示用途与同意、旧报名补资料不改排位、换号清空/丢弃晚到响应。
- [ ] 实现本人资料页面和活动记录、用户名导航、资料弹窗以及新参数报名接口；不将身份证写入浏览器持久存储或Auth metadata。
- [ ] 活动结束/清理中的状态禁资料/图片操作；付款状态白字及圆点保留含义；注册/退出原行为兼容。
- [ ] 运行新DOM/服务测试和原applications/sidebars/paymentUI测试，修正真实回归。

### Task 3: 后台保险、Excel和两次确认清理

**Files:** Modify `src/applications/admin-registration.js`, `ActivityRegistrationAdmin.jsx`, `admin-registration.css`; create `src/applications/insurance-export.js`, `tests/insurance-export.test.mjs`; modify admin DOM/service tests. Own `src/payments/payment-status.css`.

**Interfaces:** Consumes contract admin/insurance/export/manualcleanup RPC; uses lazy generated realxlsx (text cells), no server export file. Do not modify App/Admin page shell.

- [ ] 写失败测试：移除日志、姓名左侧三色点/白字、保险取消无写入及确认CAS、双确认清理取消/过期/换号、导出仅入选和18位文本。
- [ ] 实现保险操作确认、管理员导出、私有图片清理状态和两次确认；父对话框键盘事件避让子dialog。
- [ ] 默认和唯一导出范围有效入选者；缺失字段明确列出，所有值文本防公式；动态加载writer，及时释放Blob。
- [ ] 运行新增及原后台服务/DOM测试，报告无敏感日志输出。

### Task 4: 图片上限、受信清理执行器与定时计划

**Files:** Modify `server/payments/processor.mjs`, `src/payments/payment-proof.js`, `PaymentDialog.jsx`; create `supabase/functions/activity-data-cleanup/index.ts`, pure cleanup worker module/tests; config/migration cron owned by Task1协调。

**Interfaces:** Consumes service-only claim/list/confirm RPC contract; Storage API remove only, fixed bucket. Upload new1MiB vs olddownload3MiB separate.

- [ ] 写失败测试：真实1–8MiB原图压缩不超1MiB，旧图授权下载仍兼容；每轮删除后检查，连续两轮跨180秒才完成，失败/残留重置，固定范围且幂等。
- [ ] 实现图片限制和Edge bounded executor；不接受请求中任意activity/path/bucket，平台服务密钥只在Edge运行环境。
- [ ] 设置3分钟Cron固定唤醒，受信数据库独立控制租约/到期；执行错误仅返回无敏感内容计数。
- [ ] 跑图片真实处理/HTTP/清理单测，验证Worker打包无Node依赖。

### Task 5: 集成审查、验证和统一发布

**Files:** Update `AGENTS.md`, `docs/activity-registration-workflow.md`, `docs/PRODUCTION-HANDOFF.md`, spec/plan progress; retain session commit1731f1a changes.

- [ ] 独立审查数据库与清理安全、会员/后台功能；处理重要问题并作定向复核。
- [ ] 完整npm test、PG17/18完整链、build:production及Worker dry-run；可用时真实桌面/手机UI验收，诚实记录限制。
- [ ] 应用针对性迁移、部署Edge及3分钟Cron，验证真实删除机制及权限；避免生产合成敏感资料，保留原数据哈希证据。
- [ ] 合并main、发布Cloudflare、验证线上资源与接口，记录部署版本并同步GitHub。
