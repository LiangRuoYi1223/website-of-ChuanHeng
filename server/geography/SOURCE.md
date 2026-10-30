# 离线省市匹配数据来源

当前用途为本地 GPX/KML 活动草稿识别。运行 `locateTrack()` 只读取随服务端打包的边界与轨迹，不调用地理编码 API、不发送 GPS 坐标，也不根据最近城市代表点补填结果。

## 数据覆盖与来源

2026-10-31 取得并生成 **391 个真实行政区匹配单元**，覆盖 34 个省级区域。其中 DataV 369 项，NLSC 台湾县市 22 项。这里的 city 是来源的市/地级区划或省直辖县级单元，不把自治州、盟或来源中的直辖县伪造成地级市。

- [DataV.GeoAtlas 官方说明](https://help.aliyun.com/zh/datav/datav-7-0/user-guide/datav-geoatlas-widgets/)明确数据来自高德开放平台，供学习和交流使用。当前本地版本沿用此来源；不将该数据声明为已获商业发布授权，正式公开使用前需确认适用授权或替换数据。
- 全国省级轮廓：`https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json`。北京、天津、上海、重庆、香港和澳门使用来源中的完整省级几何作为对应匹配单元。
- 普通省级区域的市/地级及直辖县边界：`https://geo.datav.aliyun.com/areas_v3/bound/<省代码>_full.json`，共 27 份。真实代码和名称直接取源属性，不从城市代表点推测边界，不补造未列出的新设行政区。
- 台湾县市来自[内政部国土测绘中心开放数据目录](https://data.gov.tw/dataset/7442)与[官方 ZIP](https://maps.nlsc.gov.tw/download/%E7%B8%A3%E5%B8%82%E7%95%8C%E7%B7%9A(TWD97%E7%B6%93%E7%B7%AF%E5%BA%A6).zip)，授权为政府资料开放授权条款第 1 版。实际下载包为 `COUNTY_MOI_1090820.shp`，包含 22 县市；**下载日期不等于边界版本日期**。使用源 `COUNTYNAME` 和 `TW-<COUNTYCODE>`，不编造大陆市县代码。
- 每份源文件的 URL、字节数、SHA-256，以及最终文件的校验值，记录在 [source-manifest.json](source-manifest.json)。源 ZIP 与先前已有快照校验一致，未把旧目录里的代表点当作几何。

## 坐标系

[DataV 官方地图数据格式说明](https://help.aliyun.com/en/datav/datav-7-0/user-guide/map-data-format-1)明确其地图采用 GCJ-02，并链接 [wandergis/coordtransform](https://github.com/wandergis/coordtransform)。[高德官方说明](https://lbs.amap.com/api/javascript-api-v2/guide/transform/convertfrom)区分 GPS 的 WGS84 与高德 GCJ-02。

本模块的输入统一为 GPX/KML 标准 GPS **WGS84**。对于 DataV 面，先使用上述项目的本地 WGS84→GCJ-02 数学公式转换查询坐标，再做点在多边形判断。该公式按 MIT 许可适配，完整版权/许可保留在 [coordtransform.LICENSE.txt](coordtransform.LICENSE.txt)。没有调用高德在线转换，也不宣称测绘级转换精度。

NLSC 源 `.prj` 为 `GCS_TWD_1997`，地理经纬度 EPSG:3824。此概略省市匹配直接将 WGS84 经纬度用于该面；TWD97 与 WGS84 的小量基准差异远小于下述 500 米保守排除带。它不适用于精密地籍、导航或边界认定。原始轨迹和返回的代表点始终保留 WGS84，不把 GCJ-02 查询坐标当作用户 GPS 位置。

## 压缩、索引与不确定性

`china-cities.compact.json` 为 1,731,353 字节（gzip 测量约 695 KB）；包含 174,021 个保留顶点。构建器对真实闭合环使用 RDP 简化，容差 `0.0003°`，量化至 `0.00001°` 后使用整数差分编码。没有用中心点生成 Voronoi 区、手绘面或矩形面代替行政边界。外环、孔洞及离岛均保留为源环的 even-odd 拓扑。

运行时仅解码为本地数值数组，按坐标系建立一度网格与包围盒索引。每次定位检查**全部不超过 30,000 个已记录点**、最多 100 段；不抽样、不丢弃短段，也不在断点之间插值。相同坐标复用本次请求缓存。没有记录点经过的两点之间不推断途经城市，因此来源中明确 `coverage: 'all-recorded-points'`、`interpolatesBetweenPoints: false`。

距离简化边界 500 米内的点、重叠或多重归属点都不自动判定。500 米是本产品采用的保守排除策略，**不是来源数据误差上限或法定边界精度保证**。境外、无覆盖区域和海上无法确认的点返回未知；不调用最近城市兜底。来源中的旧行政区、海岸及微小岛屿边界可能存在概化或时效局限。

## 返回约定

同步导出 `locateTrack(track)`，接受转换器的 `geojson.geometry.type === 'MultiLineString'` 结构，返回：

```js
{
  coordinates: [lon, lat] | null,
  province: string | null, city: string | null, adcode: string | null,
  locations: [{ province, city, adcode, segmentIndex, coordinates: [lon, lat] }],
  locationStatus: 'matched' | 'partial' | 'unmatched',
  source: {
    id, provider, method: 'offline-point-in-polygon',
    inputCoordinateSystem: 'WGS84', boundaryCoordinateSystems,
    retrievedAt, boundaryGuardM, simplificationToleranceDegrees,
    coverage: 'all-recorded-points', interpolatesBetweenPoints: false
  },
  checkedPointCount, matchedPointCount, totalPointCount,
  warnings: [/* 中文说明 */]
}
```

`coordinates` 是整条轨迹真实第一点，不取包围盒中心或城市中心。顶层省市只对应第一点；即使其未知、后续点已经匹配，也不把后续城市挪到第一点上。`locations` 按段和首次经过顺序保留该段每个已确认市级单元；每项坐标取该段该市的第一条真实 GPS 记录。同一城市在不同段重复保留。

所有点确认匹配才为 `matched`；一部分确认时为 `partial`；没有确认时为 `unmatched`。此结果用于自动预填和人工核对，不能证明协会实际到访、发布或活动完成。活动派生流程仍须检查正式/示例状态及活动授权。

## 重建

显式运行 `python server/geography/build-data.py` 下载公开边界并重建。脚本不会读取用户轨迹、使用云端密钥或执行数据库操作。Windows 系统下载器与 Python 对 NLSC 的证书链兼容性不一致时，保留证书验证，用系统客户端下载 ZIP，然后运行：

```powershell
python server/geography/build-data.py --taiwan-archive <本地官方ZIP路径>
```

构建脚本、来源清单和数据文件均只在服务端目录。前端无需加载全国多边形包；当前未部署至 Cloudflare，也未写入任何 Supabase 数据。
