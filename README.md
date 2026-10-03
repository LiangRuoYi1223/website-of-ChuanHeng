# 川衡登山协会 · 页面设计演示

当前阶段聚焦电脑端的页面设计与可视化。使用 React + Vite + TypeScript，页面直接读取本地演示内容，不需要后台、数据库或登录。

## 版本记录

- **V0.1 · 网站演示版**：搭建 React 网站与活动、足迹、认识川衡和登山队页面；加入活动日历与筛选、活动回顾、山野相册、中国足迹地图、新手指南及成长路径，并保留后台开发草稿。
- **V0.2 · 视觉系统调整**：将暖纸色与苔绿更新为冷白和岩松绿，以深松绿延展登山队和页脚；调整按钮、活动区、焦点与文本选中等界面细节，并同步更新设计规范和图标。
- **V0.3 · 合作页面与手册**：新增「合作」导航及页面，汇总团队与示例资质、全部三个示例项目、支持方式与权益、流程和联系方式；项目、网页与 **8 页 A4 PDF** 共用内容来源，并加入手册生成与同步校验。

## 打开网站

已安装依赖时，Windows 下双击项目目录中的 **启动网站.cmd**，或在此目录运行：

```powershell
npm run dev
```

然后在这台电脑的浏览器打开 <http://127.0.0.1:5173/>。预览期间保持启动窗口打开；电脑重启或服务停止后需要重新启动。如果提示端口已被占用，可以直接尝试打开该地址。

首次安装需要 Node.js 24 或更高版本，并运行 `npm install`。本地地址只在当前电脑上有效，公开访问需另行部署。

## 页面与交互

- **活动与足迹**：本学期出发日历、日期点击后左右分栏的活动速览、按类别／时间／体验组合筛选的活动预告、活动回顾、山野相册、中国足迹地图及公众号报名区域。
- **认识川衡**：组织介绍、四步首次出发指南、招新信息、普通活动 → 系统训练 → 队伍选拔 → 专业攀登的滚动成长路径。
- **川衡登山队**：训练方向、全部公开项目、单次攀登项目与全年训练合作说明，以及合作页入口。
- **合作**：资质资料、全部公开项目、支持方式与权益对照、四步合作流程、联系方式，以及页底可下载的合作手册。手册区使用真实 PDF 首页作为立体书封面。

动态效果包括影像视差、内容渐入与固定滚动章节。当前验收以电脑端为主。

视觉采用山野杂志主题：暖纸色、苔绿、麦黄，浅色故事标题使用思源宋体；登山队增加岩石黑与冰蓝。字体、字号、间距、圆角、图片比例和动效集中在 `src/design-tokens.css`，确认的规格见 [DESIGN_TOKENS.md](DESIGN_TOKENS.md)。字体使用本地文件，来源与许可见 `public/fonts/SOURCE.md`。

## 替换内容与素材

文案、活动和公众号入口集中在 `src/demo-content.ts`。合作页文案、示例资质、权益、流程、联系方式与三个示例项目集中在 `src/cooperation-content.ts`，由 `demo-content.ts` 引用。修改这些文件后，开发预览会自动更新。活动日期与回顾、资质人员与攀登项目目前均为明确标注的示例内容，正式资料待协会替换。

`PublicContent` 中的 `cooperation` 与 `projects` 已定义独立的数据结构，登山队页、合作页与手册使用同一份项目列表。后续接入接口时可沿用这些字段；接口数据变更后需要重新生成静态手册。

本学期日历的标题与日期范围在 `settings.semesterName`、`semesterStart`、`semesterEnd` 中设置；当前以 2026 秋季学期（2026 年 9 月至 2027 年 1 月）为演示。速览信息使用活动的 `duration`、`cost`、`meetingPoint`、`beginnerFriendly`、`registrationStatus` 字段。没有提供的信息会保持待公布状态。

活动预告可按 `category`、`timeCommitment`（`half-day`／`full-day`／`multi-day`）与 `experience`（`relaxed`／`scenic`／`skills`）组合筛选，分别对应半日以内／一整天／多日和轻松漫步／山野探索／技能练习。体验标签描述活动形式，具体参与要求仍由正式活动通知提供。

每次活动详情都有出发前准备卡，可在活动的 `preparation.notice` 与 `preparation.items` 中单独配置。条目包含 `id`、`title`、`description`。勾选显示当前核对进度，可以全部重置；状态只保留在当前页面，切换活动或刷新后清空。过往活动显示为准备清单回顾。

山野相册使用过往活动的 `album` 字段，每张照片配置 `id`、`src`、`alt`、`caption`、`isDemo`。页面预览前三张，灯箱可浏览全部照片，支持左右键、Esc 与焦点恢复。替换为真实照片时，也应更新说明与示意标志。

中国足迹地图使用本地矢量素材，不依赖在线地图服务。地图点位与右侧卡片内容集中在 `src/features/footprint-data.ts`，先用于展示交互，明确标为演示点位；确认真实活动记录后再替换。几何来源及生成方法见 [地图来源说明](src/features/map-data/SOURCE.md)。

图片位于 `public/images/`。可替换图片文件，或修改内容文件中的图片路径。当前三张主图和一张相册同行图为 AI 生成示意影像；来源与完整生成提示见 [ASSETS.md](public/images/ASSETS.md)。山形标志为演示用原创 SVG。

公众号链接、二维码和合作联系方式尚未提供，页面保留待补充状态。二维码占位图不能扫描。

## 合作手册 PDF

合作页和手册读取同一份 `demoContent`。当前手册为 8 页 A4 示例版：封面、组织与资质、三个独立项目页、支持与权益、合作流程、联系方式。全部示例项目都纳入手册；人员与资质明确标为示例，邮箱和微信保持待公布。

- 网站下载文件：`public/docs/chuanheng-partnership-handbook.pdf`。
- 同步输出副本：`output/pdf/chuanheng-partnership-handbook.pdf`。
- 网站书封面：`public/images/handbook-cover.png`，从最终 PDF 第 1 页渲染。
- 内容与文件校验：`public/docs/handbook-manifest.json`。

修改合作内容、项目或手册引用的影像后，运行：

```powershell
npm run handbook
npm run build
```

`npm run handbook` 读取现有内容，生成 PDF、首页封面和全部逐页预览，再更新 SHA-256 校验文件。`npm run build` 自动检查内容、项目影像、PDF 和封面是否同步；发现过期或缺失文件时会提示重建。普通构建只需要 Node.js 24，不需要 Python；只有重建手册时才需要作者依赖。

生成脚本为 `scripts/build-handbook.mjs` 与 `scripts/build-handbook.py`。它优先使用 Codex 提供的 Python，也支持通过 `CHUANHENG_PYTHON` 指定自己的 Python。其他环境可安装作者依赖：

```powershell
python -m pip install -r scripts/handbook-requirements.txt
```

PDF 使用嵌入的中文字体子集，阅读和下载无需安装字体。当前手册正文使用本机的 **HarmonyOS Sans SC**，封面标题使用 **SimSun（宋体）**，英文与数字使用缓存的 DM Sans；这与网站本地思源字体是两套不同的输出字体配置。原始网站字体为可变字体，未直接用其默认极细字重生成手册。字体选择记录在校验文件中；没有把系统字体文件发布到网站。

非 Windows 环境或需要另选字体时，把 `CHUANHENG_HANDBOOK_FONT` 设置为有中文覆盖、允许嵌入的静态 TrueType 字体路径。该字体用作作者环境的正文与无系统字体时的标题回退。建议使用静态思源或 Noto 中文 TrueType 字体；ReportLab 的作者脚本直接嵌入所选字体。

逐页图片位于 `artifacts/previews/handbook/`。生成器优先用 Poppler 渲染 PDF，未提供 Poppler 时使用 `pypdfium2`。每次重建均校验 A4 尺寸、页数，以及全部资质、项目正文、权益和流程条目，交付前还应检查这些逐页预览的版式。

## 构建预览

```powershell
npm run build
npm start
```

`npm start` 预览 `dist/` 中的构建结果，地址仍为 <http://127.0.0.1:5173/>，运行前需停止同一端口上的开发预览。当前构建结果可作为静态网站部署；托管平台需为独立页面配置回退到 `index.html`。

## 后续阶段

已有后台草稿代码保留在 `server/` 与 `src/admin/`，当前页面不依赖、不加载这些模块。账号、多管理员、数据库和后台编辑功能暂不在本阶段验收范围内。

## 参考信息

基础组织信息参考 [南科大学生工作网站：川衡登山协会](https://classic.osa.sustech.edu.cn/index.php?a=detail&action=systzz&g=School&id=6111&m=College&pterm=81)。成长路径与登山队方向采用本次确认的方案，未填入未经核实的攀登成果或合作品牌。

视觉参考为 [Arc’teryx New Zealand](https://arcteryx.co.nz/)、[Patagonia Stories](https://www.patagonia.com/stories/) 与 [Apple MacBook Pro](https://www.apple.com/macbook-pro/) 的内容组织方式。
