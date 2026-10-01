# 中国足迹地图几何来源

- 官方来源入口：[阿里云 DataV.GeoAtlas 地理小工具](https://datav.aliyun.com/portal/school/atlas/area_selector)
- 原始 GeoJSON：[中国省级边界 100000_full.json](https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json)
- 获取日期：2026-10-01（Asia/Shanghai）
- 原始文件：`china-provinces.geojson`，582,522 bytes
- SHA-256：`99adfeded5223848bbe37a0a12f8023e11ee12161c7800521c27db42fdeac275`

通过浏览工具核实 DataV 官方来源入口，再从 `geo.datav.aliyun.com` 下载公开文件。完整原始 GeoJSON 随项目保留；运行时不访问地理网络服务，也不依赖地图 SDK、账户或 API 密钥。

## 转换与绘制

`build-china-map.mjs` 读取原始 GeoJSON，生成本地 TypeScript 路径模块 `china-paths.ts`。重新生成命令：

```powershell
node src/features/map-data/build-china-map.mjs
```

主地图保留来源数据的 34 个省级要素，包含台湾、香港、澳门；海南主岛取该省面积最大的源多边形。使用 Albers 等积圆锥投影：标准纬线 25°/47°，中央经线 105°，原点纬度 35°。绘图坐标拟合到 920 × 650 SVG 画布，保留每个源坐标，仅将 SVG 坐标四舍五入至小数点后两位，未手绘或重新拟合地域轮廓。

南海 inset 使用来源的海南省全部多边形（包含主岛作为参照）与 `100000_JD` 海域界线要素，线性经纬度投影到独立框中；边界与岛屿环均来自同一原始文件。省界通过各省级路径的描边展示，孔洞使用 evenodd 填充规则处理。

`projectChinaPoint()` 使用与主图相同的投影与拟合系数，保证演示城市坐标与几何位置一致。此地图仅用于足迹位置的展示交互。

## 演示点位与照片

`../footprint-data.ts` 集中配置深圳、韶关、桂林、成都四个**地点示例**。它们不是川衡协会已完成的活动、到访地点或攀登成果，日期与路线均未虚构。城市坐标为位置展示用约略中心坐标。

所有配图均为项目中已有的原创 AI 示意图，不能作为当地或协会活动实拍使用。生成提示词、原始文件和格式转换说明见 [public/images/ASSETS.md](../../../public/images/ASSETS.md)。后续替换真实足迹时，应同时更新地点、叙述与图片来源说明。
