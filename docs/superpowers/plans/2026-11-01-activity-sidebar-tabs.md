# 活动侧栏分区切换实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将用户选定的分页侧栏接入真实活动页，长资料可滚动且报名状态和主要操作持续可达。

**Architecture:** ActivityApplication 保留单一状态与请求链，提供 summary/details/actions/shortLabel/checking 展示插槽。ActivitySidebar 负责页签和桌面/手机容器，Explore 仅替换活动侧栏。

**Tech Stack:** React 19、现有CSS、原生dialog、Node测试和JSDOM。

**Spec:** docs/superpowers/specs/2026-11-01-activity-sidebar-tabs-design.md

## Global Constraints

- 不新增依赖、迁移或示例正式数据；不修改路线、资讯或报名服务器权限。
- 保留身份切换保护、原报名窗口和未知值；只挂载一份报名组件。
- 仅本地合成数据验证；最终发布沿用已授权的正式发布流程。

## Review Focus

- 身份切换/刷新时不得继续展示或操作上一账号的排位。
- 候补和已缴费不出现缴费催促；退出与重新报名保留原行为。
- 通过登录返回 #application 时，隐藏的手机/报名页签应自动展开。
- 面板切换和缩放不重复挂载报名状态；模态卸载和桌面切换正确恢复页面滚动与焦点。
- 很长缴费说明、未知名额、低高度及窄屏应可滚动且所有操作可达。

### Task 1: 单一报名状态插槽

**Files:** src/applications/ActivityApplication.jsx、src/applications/application.css、tests/member-registration-dom.test.mjs

- [x] 在既有DOM测试中添加children插槽集成，验证分区切换时单一订阅、候补提示和退出/重报仍有效；先运行观察失败。
- [x] 提供 children({summary,details,actions,shortLabel,checking}) 可选展示接口，默认展示保持可用；所有操作继续使用原身份绑定函数。
- [x] 执行针对测试。

### Task 2: 页签与移动面板

**Files:** src/activities/ActivitySidebar.jsx、src/activities/activity-sidebar.css、tests/activity-sidebar-dom.test.mjs

- [x] 写键盘页签、hash定位和手机面板测试，先红后绿。
- [x] 实现 ActivitySidebar({activity,localDraft})，消费Task 1展示插槽。限定活动CSS，处理中段滚动和固定操作区。
- [x] 验证关闭/Escape/遮罩/卸载恢复、移动转桌面及长文本。

### Task 3: 接入与发布

**Files:** src/pages/Explore.jsx、docs/PRODUCTION-HANDOFF.md

- [x] 只替换活动详情侧栏；确认其他页面仍使用原侧栏。
- [x] 完成独立审查、全套测试与生产构建，实机能力受限时如实记录。
- [x] 检查main并发改动，按已授权流程合并、同步GitHub及发布，核对线上静态资源。

## 执行记录

单状态源和分区组件已完成，独立审查通过。全套433/433、生产构建通过。首轮受限环境在原生图片测试挂起，结束已确认的本次测试进程后以可运行本机原生图片及回环服务的环境重跑通过；未修改产品代码规避测试。浏览器工具未开放Edge/IAB，故此次无实机视觉验收。高度不超过600px时整卡内滚动，较高视窗保持中段滚动与底部常驻。

正式发布：代码a8282d8，Worker 2f272b77-92e5-48c5-b59f-b30c18b84be7；线上index-DAtPnovG.js与index-uN7e1hmF.css为HTTP200且SHA-256与main正式构建一致。无数据库变更。
