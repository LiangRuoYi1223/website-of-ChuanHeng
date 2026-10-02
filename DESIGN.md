---
name: 川衡网站
description: 延续现有山野杂志视觉
colors:
  paper: "#F5F6F4"
  surface: "#FCFDFC"
  soft: "#E7EBE6"
  green: "#315447"
  ink: "#202923"
  muted: "#606B63"
  line: "#D6DED8"
  alpine: "#17241F"
  alpine-ink: "#F2F5F3"
  ice: "#B3CBC0"
typography:
  display:
    fontFamily: "Chuanheng Han Serif SC, Songti SC, SimSun, serif"
    fontSize: "5rem"
    fontWeight: 500
    lineHeight: 1.15
  body:
    fontFamily: "DM Sans, Chuanheng Han Sans CN, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.75
rounded:
  image: "4px"
  button: "4px"
  panel: "8px"
spacing:
  grid: "32px"
  gutter: "48px"
  section: "96px"
components:
  button-primary:
    backgroundColor: "{colors.green}"
    textColor: "{colors.surface}"
    rounded: "{rounded.button}"
    height: "48px"
---

# Design System: 川衡网站

## Overview

既有山野杂志视觉，采用冷白与岩松绿，深松绿用于登山队和页脚。此文件记录 `DESIGN_TOKENS.md`、`src/design-tokens.css` 和现有页面，不改变原有系统。

## Colors

冷白用于阅读背景；岩松绿用于主要操作、章节强调和焦点；深松绿用于深色章节；浅松绿用于深底强调。

## Typography

浅色故事与章节标题用思源宋体，中文正文及界面用思源黑体，英文标签及数字用 DM Sans。登山队标题沿用黑体。

## Layout

最大内容宽度 1296px，桌面两侧 48px，章节间距 96px，重要转场 128px。网格间距 32px。760px 以下沿用现有单列布局和折叠导航。

## Elevation & Depth

常规内容以色块、细线和留白分层，少用阴影。影像沿用现有视差和入场规则，减少动画模式关闭位移。

## Shapes

图像和按钮轻微圆角，内容面板圆角 8px；权益表和项目条目采用清楚的对齐与分隔。

## Components

保留现有导航、山形标志、按钮、章节编号、图片说明与页脚。主要按钮用岩松绿，深色区域用浅松绿按钮。

## Do's and Don'ts

- 延用现有字体、色板与间距。
- 照片始终标注为示意影像，示例资质不表现为真实认证。
- 新合作页采用已确认的清单、图文条目、对照表及四步流程。
