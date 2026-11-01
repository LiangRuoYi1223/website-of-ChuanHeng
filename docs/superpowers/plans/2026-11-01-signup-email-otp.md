# 注册邮箱验证码接入计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有邮箱密码注册后输入邮件中的六位验证码，核验成功后登录并安全返回原页面。

**Architecture:** 保持 Supabase `signUp` 发注册确认邮件；没有 session 时挂载独立邮箱验证表单。调用 `verifyOtp({email, token, type: 'email'})` 后以 `getUser` 核实身份。重发使用 `resend({type: 'signup'})`，不切换为免密注册。

**Tech Stack:** React 19、现有 Supabase JS 2.78.0、Node.js 24、JSDOM。

**Spec:** 用户本次请求及其指定聊天《邮箱验证码注册实现》：Confirm signup 模板已含 `{{ .Token }}` 与备用确认链接；只需接通网站六位码验证。

## Global Constraints

- 保留现有黑白、品牌橙及官方徽章，不变更邮件模板、SMTP、数据库和权限。
- 密码、验证码和待验证邮箱仅在当前页面内存及必要请求中使用，不新增浏览器持久化。
- 生产配置继续从 Wrangler 读取公钥；不读取或复制服务端密钥。
- 保留既有用户未获管理权、服务端核实身份与安全回跳规则。

## Review Focus

- 错误或过期验证码仍停留验证步骤，可重试和重发。
- 发送成功不等于登录成功，无会话或身份不符不得显示成功及跳转。
- 发送倒计时依据绝对时间；接口限流后可恢复。
- 更换邮箱、切换登录或离开页面后旧响应不得恢复旧状态。
- 码及密码不写入 localStorage、URL或日志。

### Task 1: 注册与验证码表单

- [x] 在 `tests/production-auth-dom.test.mjs` 补充真实组件行为回归，先确认新增用例失败。
- [x] 新建 `src/auth/SignupVerification.jsx`，实现六位码、验证、重发冷却、错误恢复和卸载保护。
- [x] 修改 `src/pages/Admin.jsx` 注册完成后的步骤、请求代次保护及安全回跳；增补 `src/pages/admin.css` 对应样式。
- [x] 运行针对性测试并独立审查，修复有证据的问题。

### Task 2: 验证与交付

- [x] 更新 `docs/DEPLOYMENT.md` 说明邮件六位码流程及验收边界。
- [x] 完整测试逐项运行566/566通过（`npm test -- --test-concurrency=1`）；首轮生产构建通过。
- [x] 检查最终差异和仓库状态，排除旧 KML 计划和所有运行产物。
- [x] 按2026-11-02用户后续授权同步 GitHub，并发布 Cloudflare 线上网站；核对 Supabase 设置，记录实际部署与回退版本。

## 验证记录

针对性验证码与认证测试16/16通过，覆盖验证码前导零、格式、错误/过期重试、缺会话或身份不符、重发冷却/限流、安全回跳及迟到响应。独立代码审查与发布范围检查均未发现需修复项。

初次并行全套中的既有 `export response arriving after end never downloads and releases returned contacts`、`final identity verification crossing end also discards export and server cleaning blocks a completed response` 时序用例因负载失败；独立复核21/21通过，完整集逐项运行566/566通过。未修改这些用例或放宽业务规则。

2026-11-02提交前再次逐项运行完整集566/566通过。Supabase项目状态为`ACTIVE_HEALTHY`，公开Auth设置确认邮箱注册启用、注册未关闭且必须邮件确认；本次仅前端对接现有Auth接口，无需数据库迁移，不改写SMTP或用户已经设置的邮件模板。真实收信、验证码时效及浏览器实机验收仍与自动测试分开记录。

功能提交`c7ee903161347a3123d4c53ca4f33974ef63640f`已推送`main`，Cloudflare版本`05cf46d1-69ce-46d9-bf9a-3bfe76464f1e`于北京时间2026-11-02 00:18上线并承担100%流量。首页和注册入口HTTP200且引用本次新入口；完整资源哈希检查因当前网络TLS中断未完成。实际状态与回退版本见`docs/PRODUCTION-HANDOFF.md`，未将未完成检查记为通过。
