# 中国省级底图来源与转换

本目录仅包含地理底图，没有活动地点、攀登成果、路线轨迹或虚构标记。`geography.json` 为自包含的离线 SVG 路径数据，运行时不调用地图网络服务，也不需要地图账户或 API 密钥。

## 来源与用途限制

- 数据分发来源：[阿里云 DataV.GeoAtlas 范围选择器](https://datav.aliyun.com/portal/school/atlas/area_selector)。
- 上游文件：[中国省级边界 100000_full.json](https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json)。
- 来源说明：[阿里云 DataV.GeoAtlas 官方文档](https://help.aliyun.com/zh/datav/datav-7-0/user-guide/datav-geoatlas-widgets/)，2026-10-30 重新核对。
- 官方说明数据来自高德开放平台，**仅供学习和交流使用**，版权问题需向高德开放平台确认。没有找到允许任意商业使用的开放许可证，因此不能将本数据标成 MIT、CC0 或免费商用素材。当前用于 localhost 设计验证；正式公开发布前应确认适用授权或换用获得相应授权的数据。
- 这是一份 DataV 分发数据的下载快照，不是对当前行政区划、界线版本、官方审图状态或导航精度的保证。快照未声明 CRS；本地转换直接采用其经纬度，未自行标称 WGS84 或 GCJ-02，也未对坐标进行纠偏。

现有本地原始文件（只读使用，未更改）：

`C:/Users/ander/Documents/ChatGPT/川衡网页设计/src/features/map-data/china-provinces.geojson`

该文件来源记录的下载日期为 2026-10-01，大小 582,522 bytes，本次读取计算的 SHA-256 为：

```text
99adfeded5223848bbe37a0a12f8023e11ee12161c7800521c27db42fdeac275
```

同时核对了该目录的 `SOURCE.md`、`china-paths.ts`、`build-china-map.mjs`。本次仅复用地理数据和既有投影算法，没有复制旧站 UI、城市表或活动数据。

## 覆盖范围

| 要素 | 本地快照与输出处理 |
| --- | --- |
| 全部省级要素 | 来源共有 34 个省级要素；输出 `provinces` 保留全部 34 个，包括台湾、香港、澳门 |
| 台湾 | 来源 14 个多边形全部保留在台湾省主图路径中 |
| 海南与南海诸岛 | 来源海南省 133 个多边形全部保留于附图；主图同时保留其中面积最大的海南主岛 |
| 香港、澳门 | 来源分别 9、2 个多边形全部保留 |
| 来源海域界线 | 额外要素 `100000_JD` 的 10 个多边形全部保留在附图；没有按示意图手绘或补造界线 |
| 省界与沿海小岛 | 其余省级要素的源多边形和各环全部保留，没有简化、平滑或重新拟合边界 |

“保留全部”仅指保留这份源快照中实际包含的几何，不宣称涵盖其他版本或更高精度数据中的全部细节。主图和附图配合展示，海南诸岛没有因为主图取主岛而被丢弃。附图边框是排版框，不是地理界线。

## JSON 结构

```text
viewBox: [0, 0, 920, 650]
fillRule: "evenodd"
provinces: [
  {
    id, adcode, name, path,
    label: [x, y], labelSource, labelCoordinates: [longitude, latitude],
    sourcePolygonCount, renderedPolygonCount
  }
]
inset: {
  title: "南海诸岛",
  coordinateSpace: "main-viewBox",
  frame: {x: 770, y: 416, width: 120, height: 170},
  paths: [{id, adcode, name, path, sourcePolygonCount}],
  projection: {...}
}
projection: {
  type: "albers-equal-area-conic",
  units: "degrees",
  standardParallels: [25, 47], centralMeridian: 105, latitudeOfOrigin: 35,
  fit: {minX, maxY, scale, left, top}
}
source: {provider, url, documentation, downloadedAt, verifiedAt, bytes, sha256, ...}
```

`path` 可以直接用于 SVG 的 `d` 属性。所有主图和附图路径都已经在相同的 920 × 650 画布坐标内，**绘制附图路径时不要再次平移或缩放**。主图省级路径与附图使用 `fill-rule="evenodd"`；边界可通过路径描边呈现。`inset.frame` 只是建议的可见附图框。

`id` 与 `adcode` 保留来源代码。省级名称保留源数据原文。标签从来源 `properties.centroid` 取得，缺失时回退至 `properties.center`，经主图投影得到；没有手编地理点。标签坐标仅供文字排版，不表示活动位置、城市、登山口或导航目标；狭小区域的标签拥挤应由 UI 排版解决。

## 投影与今后的真实地点

主图采用球面 Albers 等积圆锥投影，标准纬线 25°、47°，中央经线 105°，原点纬度 35°。拟合系数与既有构建器完全相同，保存在 `projection.fit`。省级几何保留每个源点，仅将最终 SVG 坐标保留两位小数。

将经过核实的经纬度转换为相同画布坐标时，可使用下列函数；本次没有把任何活动点写入数据：

```js
function projectChinaPoint(longitude, latitude, projection) {
  const radians = Math.PI / 180;
  const [parallel1, parallel2] = projection.standardParallels;
  const n = (Math.sin(parallel1 * radians) + Math.sin(parallel2 * radians)) / 2;
  const c = Math.cos(parallel1 * radians) ** 2 + 2 * n * Math.sin(parallel1 * radians);
  const rho0 = Math.sqrt(c - 2 * n * Math.sin(projection.latitudeOfOrigin * radians)) / n;
  const rho = Math.sqrt(c - 2 * n * Math.sin(latitude * radians)) / n;
  const theta = n * (longitude - projection.centralMeridian) * radians;
  const { left, top, minX, maxY, scale } = projection.fit;
  return [
    left + (rho * Math.sin(theta) - minX) * scale,
    top + (maxY - (rho0 - rho * Math.cos(theta))) * scale,
  ];
}
```

南海附图采用独立线性经纬度投影，源构建公式原样保留：

```js
function projectSouthSeaPoint(longitude, latitude) {
  return [777 + ((longitude - 107) / 17) * 98, 428 + ((25.5 - latitude) / 23.5) * 144];
}
```

后续活动地点必须来自经过核实的真实活动资料；底图及文字标签本身不代表协会曾到访某地。

## 本次验证

2026-10-30 进行了离线核对：原始 GeoJSON 为 35 要素（34 个省级要素与 1 个海域界线要素）；重新用原始坐标和投影公式计算全部主图、附图 SVG 路径，与既有路径逐字符串比较一致。所有 36 个输出路径均非空、坐标有限且位于 viewBox 内。台湾、海南、香港、澳门与海域界线的源多边形数量和输出记录一致。所有标签均来自源属性投影。没有执行任何云端操作。
