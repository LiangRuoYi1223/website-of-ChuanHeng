# 活动缴费记录实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为活动增加真实微信收款码、会员记录上传、三态显示和管理员核实能力。

**Architecture:** 私有Storage与受控RPC负责凭证和状态；同源Worker与Vite共享图片处理；单一报名状态源驱动会员弹窗与管理员名单。所有图片新文件追加，只有管理员能确认paid。

**Tech Stack:** 现有React/Vite、Cloudflare Images/Workers、Supabase Postgres/Auth/Storage，新增依赖仅官方CLI工具运行，不更改产品包。

**Spec:** docs/superpowers/specs/2026-11-01-activity-payment-proofs-design.md

## Global Constraints

- 旧数据与日志保留；不运行历史初始化SQL，无真实示例收款码，无生产测试报名。
- 严格身份绑定和私有读取，来源仅可信app_metadata；不暴露服务密钥。
- pending为会员自报，paid必须由管理员核实；UI使用用户指定白/蓝/绿与明确文字。

## Review Focus

- 管理员审核旧图时，会员已退回后重交新图：状态和proofID双重CAS。
- 处理或上传期间账号变化/退出/管理员确认：最终RPC再查，禁止错误人/降级。
- 私有图片的对象URL、隐藏弹窗与切换账号：及时撤销和清理。
- Storage宽策略、伪造路径/metadata、候补或匿名访问：restrictive政策及隔离SQL测试。
- 上传已完成但RPC网络失败：不得假成功或删图，重试幂等。

### Task 1: 数据与受控提交

Files: supabase/migrations/20261031185118_activity_payment_proofs.sql、scripts/validate-payment-proof-sql.mjs、既有SQL测试桩。

- [x] 写新状态、提交、私有读取、审核冲突和不可改日志的失败测试。
- [x] 扩展状态约束、只追加凭证表、Storage政策、本人提交与管理员5参RPC；旧4参入口撤销。
- [x] PG17/18验证，核对旧字段原样保留。

### Task 2: 服务端与客户端图片接口

Files: server/payments、server/tracks/http.mjs、server/tracks/vite-plugin.mjs、server/worker.mjs、src/payments/payment-proof.js、status.js/CSS。

- [x] 测试先行，实现严格同源、真实身份/本人入选校验、限流式大小和真实解码转换。
- [x] 客户端上传新私有对象后受控提交，下载仅授权Blob；失败与换号不假成功。
- [x] 对应测试及Worker无Node打包验证。

### Task 3: 会员与管理员界面

Files: ActivityApplication.jsx/registration.js、src/payments/PaymentDialog.jsx与PaymentProofImage.jsx、后台活动编辑与名单。

- [x] 会员状态与弹窗测试，展示真实QR与备注提醒、我已缴费后选择图片、成功pending。
- [x] 后台服务配置统一上传全站QR、三态下拉、当前/历史记录查看和提交日志；CAS带当前proofID。
- [x] 检查候补/已缴费提示、对话框焦点与移动面板内弹窗，独立安全审查。

### Task 4: 统一验证和发布

- [ ] 全套测试、生产构建和无Node依赖打包通过，保存原数据基线。
- [ ] 应用唯一针对迁移，核实权限/数据保留和安全advisors；部署后核对线上资源。
- [ ] 同步main/GitHub并记录实际迁移版本与Worker版本；如实记录未做真实支付验收。

## 当前验证记录

全套476/476、PG17/18各40/40、生产构建通过。Worker dry-run 50输入且无external imports；各实现者已停写，独立安全与界面审查通过；已修复手动pending无图时的提示。真实收款码尚未提供，不生成示例码；云端不创建合成报名/缴费数据。

已应用生产迁移 20261031185118_activity_payment_proofs，原2条内容、1条报名、1条日志及0个图片对象的原字段/对象哈希一致；新凭证/设置变更日志0条，收款码尚未配置。网站日志DML、匿名提交、旧4参审核入口均拒绝。
