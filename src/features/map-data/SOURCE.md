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

`projectChinaPoint()` 使用与主图相同的投影与拟合系数，将本地城市代表点投影到省级底图。此地图仅用于足迹位置的展示交互。

## 本地城市坐标表

`cities.ts` 提供离线的城市代码、名称、所属省级区域和经纬度，以及 `findCity(code)` 查询。共 **391 项，覆盖 34 个省级区域**：DataV 的 369 项和 NLSC 的 22 个台湾县市；没有运行时地理编码请求、地图 SDK 或 API 密钥。

### DataV 城市代表点

- 官方说明：[DataV.GeoAtlas 地理小工具](https://help.aliyun.com/zh/datav/datav-7-0/user-guide/datav-geoatlas-widgets/)
- 获取日期：2026-10-05（Asia/Shanghai）
- 全国层级入口：[100000_full.json](https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json)
- 城市来源：`https://geo.datav.aliyun.com/areas_v3/bound/<省级代码>_full.json`，共 27 份省级子区域数据。
- 本地快照：`city-source-properties.json`，仅保留原始要素属性、源 URL、原文件字节数及 SHA-256；没有保留城市边界几何。

普通省级区域使用全部直接子要素；包含地级市、自治州、地区、盟和来源中列出的省直辖县级单位（例如济源市、仙桃市、神农架林区、海南省直辖县）。北京、天津、上海、重庆以及香港、澳门各使用一个对应源要素代表点，不把其区县重复列为城市。坐标直接读取原始 `properties.center`，缺失时才采用 `centroid`，不由地名猜测或人工手编。

DataV 官方说明其 GeoAtlas 数据来自高德开放平台，供学习和交流使用。城市与区划为下载时来源版本，不能视作实时行政区划查询。比如新疆该源包含截至胡杨河市的 24 项，未列出的后设单位不会自动补造；需要更新时应再次取得可靠数据并重建表。

### 台湾县市补充数据

DataV 的台湾省要素 `childrenNum=0`，无县市子层，因此没有把台湾省代表点伪装成城市。补充来源为内政部国土测绘中心 NLSC 官方开放数据：

- 官方目录：[直轄市、縣市界線（TWD97經緯度）](https://data.gov.tw/dataset/7442)
- 官方下载页：[国土测绘图资服务云](https://maps.nlsc.gov.tw/pro/download.jsp)
- ZIP：[縣市界線(TWD97經緯度).zip](https://maps.nlsc.gov.tw/download/%E7%B8%A3%E5%B8%82%E7%95%8C%E7%B7%9A(TWD97%E7%B6%93%E7%B7%AF%E5%BA%A6).zip)
- 获取日期：2026-10-05（Asia/Shanghai）；原 ZIP 为 3,708,666 bytes。
- SHA-256：`0c6fca34a92b92ef3e9a41957e403cb89e814bb64942ca7c7e51c746f913d49d`
- 实际包内源文件：`COUNTY_MOI_1090820.shp`（2020 版；获取日期不表示边界年份）。
- 原坐标：TWD97 经纬度（EPSG:3824）；本地图的展示尺度下直接使用经纬度投影，没有宣称测量级位置精度。
- 授权：[政府资料开放授权条款第 1 版](https://data.gov.tw/license)。
- 本地快照：`taiwan-city-points.json`，保留代码、名称、自动生成的代表点和下载校验信息，不保留边界大文件。

`build-taiwan-city-points.py` 用 Python 标准库解析官方 SHP/DBF，从面积最大的外环取平面质心；凹多边形的质心不在环内时，以该纬度最宽内部区间的中点作为代表点，避免落在海上。包括 22 个县市（含金门、连江、澎湖），不包含导航入口或路线轨迹。保留真实 `COUNTYCODE`，网站代码使用 `TW-<COUNTYCODE>` 前缀，不编造大陆行政区划代码，所属省级代码统一为 `710000`。

### 重建与更新

本地重建 `cities.ts` 不访问网络：

```powershell
node src/features/map-data/build-city-catalog.mjs
```

主动更新 DataV 快照并重建：

```powershell
node src/features/map-data/build-city-catalog.mjs --refresh
```

主动更新台湾快照后重建（Python 标准库，无额外依赖）：

```powershell
python src/features/map-data/build-taiwan-city-points.py
node src/features/map-data/build-city-catalog.mjs
```

若下载环境的 Python TLS 与官方服务证书不兼容，可使用保留证书验证的系统客户端取得原 ZIP，再使用 `python src/features/map-data/build-taiwan-city-points.py --archive <本地ZIP路径>` 离线解析。下载 ZIP 仅用于重建，无需提交。

这些坐标均是**城市或县市代表点**，不表示活动实际集合点、登山口、山峰、GPS 轨迹或导航位置。地点选择精确到城市即可，路线宣传名称另存，与地理关联代码分开。

## 演示点位与照片

地图不再使用独立的深圳、韶关、桂林、成都地点示例。`../footprint-data.ts` 根据已发布活动的城市代码聚合，同城多场活动使用一个点；演示点必须来自关联的演示活动，并沿用演示标记，不能作为川衡协会到访成果。已完成活动用绿点，未来活动用蓝点，同城兼有已完成与未来活动时用蓝点。

所有配图均为项目中已有的原创 AI 示意图，不能作为当地或协会活动实拍使用。生成提示词、原始文件和格式转换说明见 [public/images/ASSETS.md](../../../public/images/ASSETS.md)。后续替换真实足迹时，应同时更新地点、叙述与图片来源说明。
