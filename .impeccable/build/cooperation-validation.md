# 合作页人工验证记录

记录日期：2026-10-02（Asia/Shanghai）。状态：已实现，人工验收完成，独立人工审查结论为 `ship`。

本记录保存本次实现的人工验证结果和真实证据位置。浏览器交互与构建结果由主实现代理完成并传递；记录代理独立确认了证据文件存在、运行时版本、手册清单及下载文件的完整 SHA-256。本记录不声称重新运行浏览器检查或构建。

## 批准方案

用户批准原话：“使用A，但是part6 pdf下载那部分我希望使用B的方案，那个立体出来的”。批准契约位于 `.impeccable/surfaces/cooperation.md`；构图测量位于 `.impeccable/build/cooperation-composition-spec.json`。整页采用 A，下载区采用 B 的深绿背景、左侧下载操作及向上跨出背景边缘的立体手册。

## 运行环境与命令

- 操作系统及终端：Windows、PowerShell。
- 工作目录：`C:\Users\ander\Documents\ChatGPT\川衡网页设计`。
- 当前 Node：`v24.19.0`，可执行文件 `D:\软件\node.exe`。
- 当前 npm：`11.17.0`，入口 `D:\软件\npm.ps1`。
- 构建验证命令：`npm run build -- --configLoader native`。主实现代理报告该命令成功完成手册同步校验、`tsc -b` 与 Vite 构建。
- 手册同步校验结果：8 页，3 个公开项目。项目的 `build` 脚本先运行 `scripts/check-handbook.mjs`，再检查 TypeScript 并构建前端。
- 最新 `git diff --check`：主实现代理报告无空白错误；仅有 Git 行尾转换提示。

本次记录仅确认上述带 `--configLoader native` 的构建结果，未将其扩展为默认 config loader 或所有平台均已验证。

## 浏览器交互验证

主实现代理完成以下实际浏览器操作：

- 导航中的“合作”入口可进入合作页。
- 在 390×844 视口中，点击移动导航的“合作”后菜单关闭，`aria-expanded=false`。
- 390px 视口的 `documentWidth=390`，无页面横向溢出。
- 登山队页可见三个同源示例项目。
- 实际点击“雪山攀登计划”项目卡进入详情，能看到目标、训练准备、支持需求、共同价值和示例说明；返回“合作”导航正常。
- 实际点击合作手册下载按钮，浏览器将文件保存至 `C:\Users\ander\Downloads\川衡登山队合作手册.pdf`。
- 浏览器开发日志检查结果为 `error=[]`。

## 视觉证据

以下截图均已确认存在于当前工作区。截图不是自动化视觉差异工具的输出。

| 视口或范围 | 证据文件 |
| --- | --- |
| 1440×900，全页 | `.impeccable/review/desktop.jpg` |
| 390×844，全页 | `.impeccable/review/mobile.jpg` |
| 1264×900，全页 | `.impeccable/review/user-1264.jpg` |
| 桌面下载区域近景 | `.impeccable/review/handbook-desktop.jpg` |

工作区根路径为 `C:\Users\ander\Documents\ChatGPT\川衡网页设计`；以上路径均相对此根目录。四张截图均已完成独立审查，记录见 `.impeccable/review/finish-review.md`。

## PDF 与下载一致性

- 网页下载的 canonical 文件：`public/docs/chuanheng-partnership-handbook.pdf`。
- 手册状态清单：`public/docs/handbook-manifest.json`。
- PDF 首页渲染封面：`public/images/handbook-cover.png`。
- PDF 逐页预览：`artifacts/previews/handbook/page-1.png` 至 `page-8.png`。
- 手册清单标明：示例版、更新日期 2026-10-02、8 页、3 个项目、1,502,646 字节。

记录代理读取 canonical 文件及浏览器下载文件并逐一计算 SHA-256，两者均为：

```text
f197eb68f7180040ac854889e443523e2f9284e4555631221dd493e480ec2961
```

该值也与 `handbook-manifest.json` 中的 `pdfSha256` 一致。网页封面来自手册首页，内容、图片、PDF 和封面通过 `scripts/check-handbook.mjs` 的清单哈希校验进行同步检查。

## 后续内容维护

合作内容和三个示例项目集中在 `src/cooperation-content.ts`，并由 `src/demo-content.ts` 挂入公开内容；手册聚合逻辑在 `scripts/handbook-data.mjs`。项目内容或影像更新后运行 `npm run handbook`，再运行 `npm run build -- --configLoader native`。手册生成脚本 `scripts/build-handbook.mjs` 寻找具有 `reportlab`、`pypdf`、`Pillow` 的 Python，可通过 `CHUANHENG_PYTHON` 显式指定；依赖说明见 `scripts/handbook-requirements.txt`。这是脚本当前支持的运行方式，本文未单独验证所有 Python 候选和渲染后端。

联系人、资质和三类项目仍为已批准的示例内容；金额、交付数量及具体授权留待洽谈。内容接口替换后应重新生成手册和截图，当前证据只对应本次版本。

## 工具限制与未运行项目

impeccable Windows launcher 在本次环境不可用，用户已被告知。engine、detector、comp-diff、seed 均未运行。本次采用真实浏览器检查、截图与人工构图比较；没有创建自动引擎执行状态，也没有把人工结果表示为自动工具通过。

独立人工审查结论：`ship`，无实质渲染缺陷或批准契约缺项。审查未重跑构建、浏览器或 PDF 检查，未声称不可用的 engine、detector 与 comp-diff 已通过。
