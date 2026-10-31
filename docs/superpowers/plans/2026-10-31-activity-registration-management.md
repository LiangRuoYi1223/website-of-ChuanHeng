# Activity Registration Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 提供名额、候补递补、个人排位、后台缴费和可追溯日志。
**Architecture:** 基于applications增加状态及追加日志，RPC负责权限与排名；会员端显示本人，后台活动名单管理复用现有视觉。
**Tech Stack:** React/Vite、Supabase PostgreSQL、Node24、PGlite。
**Spec:** docs/superpowers/specs/2026-10-31-activity-registration-design.md

## Global Constraints
保留黑白橙及官方徽章；不写真实示例报名；不改旧chuanheng、轨迹快照；不实现自动付款；管理员身份只来自app_metadata；会员不得读取他人报名或日志。

## Review Focus
并发报名稳定排序；退出重报顺序；未登录和伪造角色拒绝；旧活动缺失名额；付款竞争、重复请求与日志不可伪造；无外部通知或自动付款。

### Task 1: 数据库与RPC
- [x] 读取契约，先写隔离测试观察缺失功能失败，再实施CLI生成的增量迁移。
- [x] 验证本人/管理员/游客/伪造角色、直接DML、排名/退出/重报、付款和日志；保留原数据。

### Task 2: 会员报名页面
- [x] 先写服务/DOM测试失败，再实现排位/容量、入选候补、缴费提示、退出及重报，防异步账号串读。
- [x] 验证错误、加载、登录变化、未知名额、竞争及键盘操作。

### Task 3: 后台报名管理
- [x] 先写服务/DOM测试失败，再实现名单、统计、付款切换及日志面板；父组件仅负责打开入口。
- [x] 验证空状态、加载失败、旧值冲突、操作记录和移动布局。

### Task 4: 集成及交付
- [x] 活动表单加入名额，行双击和显式按钮打开报名管理；保留原编辑入口。
- [x] 运行全套测试、隔离SQL验证、生产构建、独立审查和桌面/移动视觉检查。
- [x] 如需生产迁移/发布，先完成具体可审查结果，再按会话授权处理；不混入其他对话改动。
