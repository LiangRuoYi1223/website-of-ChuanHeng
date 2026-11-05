# 后台标签页身份核验缓存 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 同账号切回后台保留当前页面与未保存编辑，当前标签页首次服务器核验成功后 12 小时内复用页面身份核验结果。

**Architecture:** 使用当前 JavaScript 页面内存中的客户端单例保存服务器核验身份和固定 12 小时期限；不写 localStorage/sessionStorage，不跨标签页授予权限。首次、换号及明确身份更新须服务器核验；过期保持同账号界面并后台核验。退出、换号、角色降级、认证失败使缓存失效，迟到响应丢弃。保存、删除、上传和敏感资料操作继续使用现有服务端鉴权。

**Tech Stack:** React 19、Vite、Supabase JS 2.78.0、Node.js 24、node:test/jsdom。

**Spec:** 本次用户请求：同账号切回保留页面和未保存编辑；后台核验；退出、换号、权限失效及时拦截；已核验成功标签页默认 12 小时不用重复核验。

## Global Constraints

- 当前标签页硬刷新和新标签页重新核验；12 小时从服务器核验完成计算，重复切回不续期。
- 无法在完全不联系服务器时感知远端权限撤销；使用登录事件、续期后角色变化和操作鉴权进行拦截，不改变数据库、Worker 和真实资料。
- 临时认证请求失败或超时不得维持无限管理员缓存；请求超时 15 秒。
- 已存在的未跟踪 KML 计划文件保持原样；不提交或发布，完成可供审查的本地改动。

## Review Focus

- 到期、时钟回拨和重复可见事件：后台核验不卸载同账号编辑，且不并发堆积。
- 后台路由离开期间的退出/换号：全标签页监听仍使缓存失效。
- 换号/撤权与迟到认证、保存、内容读取交错：不得恢复旧编辑或覆盖新账号状态。
- 子组件独立认证订阅：同账号通知不清编辑，管理员降级仍清理敏感显示。
- 页面缓存只控制呈现：实际操作仍核验管理员与发起账号。

### Task 1: 页面认证缓存与编辑器集成

**Files:** Create `src/session/admin-session.js`, `tests/admin-session.test.mjs`; modify `src/pages/Admin.jsx`, `tests/site-images-session-dom.test.mjs`.

**Interfaces:** `createAdminSession(client, {now, setTimer, clearTimer})`, `getAdminSession(client)`; store `getSnapshot()` / `subscribe(listener)`. 期限 `ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000`。

- [x] 先加入同账号 SIGNED_IN 不卸载编辑、12 小时内不重查、到期后台核验、换号与退出竞态回归，运行并确认失败。
- [x] 实现内存单例、固定期限、串行/去重核验、版本隔离和 15 秒超时；Admin 接入并清理身份边界上的编辑/请求。
- [x] 运行上述单元及 DOM 测试，验证保留编辑和即时撤销。

### Task 2: 子页面同账号事件与权限隔离

**Files:** Create `src/session/auth-events.js`, `tests/auth-events.test.mjs`; modify `SiteImagesAdmin.jsx`, `PaymentSettingsAdmin.jsx`, `ActivityRegistrationAdmin.jsx`, `PaymentProofImage.jsx` and corresponding DOM tests.

**Interfaces:** `shouldInvalidateAuthEvent(event, session, expectedUserId, {requireAdmin})`; 管理子页面接受可选 `expectedUserId`。

- [x] 先证明背景/收款/报名等独立订阅会清同账号编辑。
- [x] 同账号保留，退出/换号/同 ID 降级/缺失身份立即清理；丢弃迟到请求。
- [x] 运行对应 DOM 和事件判定测试。

### Task 3: 集成验证与交付

- [x] 更新部署说明中的页面核验行为与 12 小时边界。
- [x] 全套 `npm test`、`npm run build:production`、`git diff --check`。
- [x] 独立审查身份缓存、编辑保留及账号竞态，修复实质问题后交付；不发布。

## Execution record

- 决策：用户已提供明确执行范围，直接实现；当前工作区仅有既存未跟踪计划，按文件范围并行修改，不创建额外工作树或改动分支。
- 决策：同账号令牌续期优先检查其角色是否仍为管理员，12 小时内不追加页面 getUser；实际业务请求继续认证。明确 USER_UPDATED 作为身份信息改变例外，后台核验。
- 证据：同账号切回/到期保留的真实 AdminPage 回归先失败；子组件回归 6 项先失败再通过；会话单元测试揭示重复 USER_UPDATED 核验，去重后 15/15 通过。
- 证据：新增普通编辑器、保存/列表迟到、密码和同 UUID 重新登录隔离 7 项集成测试通过；临时移除旧请求失效前的 epoch 校验，第 7 项准确失败，恢复后通过。
- 验证：允许连接本机测试服务后 `npm test` 642/642 通过；受限运行的开发启动检查出现本机连接 EACCES，未作为产品失败或测试成功。生产构建通过，仅现有大 chunk 提示；无 Worker/数据库变更。
- 审查：独立审查发现同 UUID 旧失败误撤销新会话、改密代次检查边界，已修复；最新版无剩余实质问题。未进行真实账号浏览器联调，未提交、推送或发布。
- 发布授权：用户随后明确要求“发布并同步github”；执行正式构建、提交推送 main、Cloudflare 发布和线上资源核验。原有 KML 计划不纳入提交；发布结果记录在 `docs/PRODUCTION-HANDOFF.md`。
