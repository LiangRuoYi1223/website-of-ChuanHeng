# 本地真实参考底图

`dananshan-20261106.json` 是一次性生成的惠州大南山周边公共地理参考图，不包含会员资料、路线轨迹、活动 ID 或协会记录。

- 生成日期：2026-11-06；单张 1000×600 SVG，图像及精确 EPSG:3857 对应的经纬度范围、生成时间保留在 JSON 中。
- 开放数据来源：[Protomaps Basemap Downloads](https://docs.protomaps.com/basemaps/downloads)、[区域抽取说明](https://docs.protomaps.com/pmtiles/cli)。实际使用归档 `https://build.protomaps.com/20261106.pmtiles`，数据版本 `4.15.2`，zoom13 的6个真实 MVT，按区域抽取后由本站绘图，不依赖付费地图 API。
- 署名与许可：[OpenStreetMap contributors / ODbL](https://www.openstreetmap.org/copyright)、[Protomaps](https://protomaps.com)。Protomaps 将其地图归档作为 ODbL 的 Produced Work 提供，支持区域抽取和自行托管。图片内部及查看界面保留来源署名；没有抓取 OSM 标准瓦片。
- 图像仅绘制数据中存在的道路、水系、植被和命名地点；没有虚构等高线、协会行程或归属。岛屿等多边形内环保留为空洞。
- 只在旧轨迹没有保存底图、且**所有真实轨迹点**都位于该图片覆盖范围时作为本地参考背景。已有路线底图优先，已有但无效的底图仍明确报错，不静默替换。匹配不依赖名称、路线ID或城市推断，不改写路线数据或活动快照。

生成请求只包含公共地图文件范围，不发送用户身份、完整轨迹或认证令牌。原始下载、运行日志及临时测试资源留在 ignored artifacts，正式资源只包含已生成的静态图和来源元数据。
