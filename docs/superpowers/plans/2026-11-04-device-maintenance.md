# 设备检测与路线重名提示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增真实状态待接入的维护页，移除 Debug/快速开始，在路线编辑入口提示重名。

**Architecture:** 新增独立维护组件与样式，复用 AdminPage 权限和导航。名称比较复用 normalizeRouteTitle，无后端及数据模型变更。

**Tech Stack:** React 19、React Router、lucide-react、Node 24、现有 esbuild/JSDOM 测试。

**Spec:** docs/superpowers/specs/2026-11-04-device-maintenance-design.md

## Global Constraints

- 简体中文，沿用黑底、品牌橙、官方徽章；无新依赖。
- 不伪造实时读数，不执行维护，不改动生产平台或业务数据。
- 不触碰既有未跟踪文件；当前工作区内实施，保留现有云端连接。

## Review Focus

- 名称全半角、大小写和空白一致比较；归档、示例与自身排除。
- 列表加载失败不显示“无重名”的确定结论。
- 切换页面及旧地址保留预览模式；设备页仍受管理员校验。
- 原有路线指标和地点问题仍在对应内容入口可见。
- 手机无横向溢出，键盘可操作；未知不等于零或正常。

## Task 1：设备页（独立组件）

Files: src/maintenance/DeviceDetection.jsx、device-detection.css、tests/device-detection.test.mjs。

- [x] 先验证未接入状态、无外部请求、维护频率切换的失败行为。
- [x] 实现 default DeviceDetection，规划配置、检测列表、维护计划。
- [x] 运行针对性测试。

## Task 2：后台导航与路线提醒

Files: src/pages/Admin.jsx、admin.css；tests/admin-track.test.mjs、admin-workflow-dom.test.mjs、render.test.mjs。

- [x] 更新退役 Debug 的测试，新增名称提醒/排除/刷新行为测试并确认失败。
- [x] 删除 Debug 与快速开始，接入设备页，迁移旧地址；路线列表保留待补提示。
- [x] ContentEditor 实时比较 normalizeRouteTitle，明确提示重复而不改写原记录。
- [x] 运行针对性测试，再运行 npm test 与 npm run build:production。全套 574/574 通过，生产构建通过。

## Task 3：验收

- [x] 独立代码审查，修正影响功能的问题。云端返回窗口刷新及手动刷新已先复现失败，再修复通过，保留未保存输入。
- [ ] 桌面与手机各检查一次，必要时集中修复并复核。（浏览器工具因无法可靠确认当前网址中止，本次不声明实机视觉验收通过。）
- [x] 交付本地改动，明确接口未接入、未迁移云端、未部署。

验证记录：首次受限运行在既有图片运行时检查阶段停滞并停止；使用获准的完整本机权限运行 `npm test` 后，574 项测试全部通过，包含真实图片运行时与 Worker 回归。浏览器工具中止后未绕过限制，未完成桌面/手机实机视觉验收。

## Task 4：任务管理器式趋势布局与网络范围

- [x] 用失败的DOM测试确认三类维护布局、指标切换及网络范围行为。
- [x] 新增DeviceTrendChart，空网格与真实样本渲染分离，单点、零值、缺失断线、窗口过滤覆盖。
- [x] 检测值与趋势并排，维护独立在下方，合并为每场活动/每月/不定期；手机纵向显示。
- [x] 网络提供7天、30天和自定义正整数天数，应用前保留原范围，非法值提示。
- [x] 针对性14项测试通过。
- [x] 全套586项测试通过，生产构建通过；独立审查未发现确定功能问题。

本轮浏览器工具未提供可用的本地页面标签，未进行实机视觉验收；布局通过源码静态检查，交互、样本绘图和范围过滤通过真实组件测试，不将这些检查等同于浏览器截图验收。
