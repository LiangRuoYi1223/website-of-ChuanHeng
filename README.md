# 川衡登山协会 · 页面设计演示

当前阶段聚焦电脑端的页面设计与可视化。使用 React + Vite + TypeScript，页面直接读取本地演示内容，不需要后台、数据库或登录。

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
- **川衡登山队**：训练方向、未来项目区域、单次攀登项目与全年训练合作说明。

动态效果包括影像视差、内容渐入与固定滚动章节。当前验收以电脑端为主。

视觉采用山野杂志主题：暖纸色、苔绿、麦黄，浅色故事标题使用思源宋体；登山队增加岩石黑与冰蓝。字体、字号、间距、圆角、图片比例和动效集中在 `src/design-tokens.css`，确认的规格见 [DESIGN_TOKENS.md](DESIGN_TOKENS.md)。字体使用本地文件，来源与许可见 `public/fonts/SOURCE.md`。

## 替换内容与素材

文案、活动、公众号入口和合作信息集中在 `src/demo-content.ts`。修改该文件后，开发预览会自动更新。活动日期与回顾目前均为明确标注的演示内容，攀登项目列表暂为空。

本学期日历的标题与日期范围在 `settings.semesterName`、`semesterStart`、`semesterEnd` 中设置；当前以 2026 秋季学期（2026 年 9 月至 2027 年 1 月）为演示。速览信息使用活动的 `duration`、`cost`、`meetingPoint`、`beginnerFriendly`、`registrationStatus` 字段。没有提供的信息会保持待公布状态。

活动预告可按 `category`、`timeCommitment`（`half-day`／`full-day`／`multi-day`）与 `experience`（`relaxed`／`scenic`／`skills`）组合筛选，分别对应半日以内／一整天／多日和轻松漫步／山野探索／技能练习。体验标签描述活动形式，具体参与要求仍由正式活动通知提供。

每次活动详情都有出发前准备卡，可在活动的 `preparation.notice` 与 `preparation.items` 中单独配置。条目包含 `id`、`title`、`description`。勾选显示当前核对进度，可以全部重置；状态只保留在当前页面，切换活动或刷新后清空。过往活动显示为准备清单回顾。

山野相册使用过往活动的 `album` 字段，每张照片配置 `id`、`src`、`alt`、`caption`、`isDemo`。页面预览前三张，灯箱可浏览全部照片，支持左右键、Esc 与焦点恢复。替换为真实照片时，也应更新说明与示意标志。

中国足迹地图使用本地矢量素材，不依赖在线地图服务。地图点位与右侧卡片内容集中在 `src/features/footprint-data.ts`，先用于展示交互，明确标为演示点位；确认真实活动记录后再替换。几何来源及生成方法见 [地图来源说明](src/features/map-data/SOURCE.md)。

图片位于 `public/images/`。可替换图片文件，或修改内容文件中的图片路径。当前三张主图和一张相册同行图为 AI 生成示意影像；来源与完整生成提示见 [ASSETS.md](public/images/ASSETS.md)。山形标志为演示用原创 SVG。

公众号链接、二维码和合作联系方式尚未提供，页面保留待补充状态。二维码占位图不能扫描。

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
