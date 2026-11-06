# 当前底图来源：开放地图文件

2026-11-06 核对。授权路线上传时从 Protomaps 开放归档按区域读取少量真实地图数据，由本站绘制单张 SVG，随路线保存。查看路线和活动不再访问第三方地图服务。

## 许可与可用性

- [Protomaps Basemap Downloads](https://docs.protomaps.com/basemaps/downloads)把每日 PMTiles 作为 ODbL Produced Work 提供，明确支持下载、区域抽取及自行托管。[PMTiles 获取与抽取](https://docs.protomaps.com/pmtiles/cli)和[格式说明](https://docs.protomaps.com/pmtiles/)解释使用 HTTP Range 仅读所需部分；无需 API key，不使用其收费 API 或访客热链服务。
- 固定官方目录 `https://build-metadata.protomaps.dev/builds.json`；从中选最新已完成、日期不晚于服务端当天且兼容 v4 schema 的归档，严格只接受 `https://build.protomaps.com/YYYYMMDD.pmtiles`。不把临时保留的某一天文件写死成永久地址；实际归档、版本与缩放级别记录在图片元数据。
- 数据署名：[© OpenStreetMap contributors / ODbL](https://www.openstreetmap.org/copyright)、[Protomaps](https://protomaps.com)。[官方 v4 图层](https://docs.protomaps.com/basemaps/layers)决定真实道路、水系、landuse 植被和命名地点类型；不推测等高线，不将高程缺失或行政区未知补成真实信息。
- 图片底部及界面显示署名、ODbL 和可点击许可来源。没有下载或预抓 `tile.openstreetmap.org` 标准瓦片。

## 处理与限制

同源请求经现有可信领队/管理员身份验证后，`convert?basemap=1` 自动生成图片；旧路线 `POST /api/tracks/basemap` 只收 `{geojson}`，不写数据库。前端确认保存才替换路线，活动继续保持原快照。

图片 1000×600，EPSG:3857；从原始轨迹计算边界、按图片比例扩幅并增加20%留白。线段保持断开，水域和植被内环采用偶奇规则保留洞，不添加不存在的地物。标签转义；SVG只含被动路径、矩形和文字，没有脚本、外部资源或任意 HTML。

父流程总期限30秒；仅一个兼容缩放级别，最多12个矢量瓦片。每次处理的构建目录读取最多64KiB、总下载最多4MiB、最多40次Range、单Range最多1MiB；严格核对206、Content-Range、长度、归档大小与一致ETag，拒绝200整包响应和重定向，不下载整份世界地图。解压单块最多4MiB、总量16MiB；PMTiles目录在SDK分配对象前校验四列最短编码长度、每块最多60000条目、整次最多120000条目；最多6000地图要素、60000坐标，最终SVG最多256KiB。取消覆盖目录、头部和瓦片读取；SDK缓存仅限本次处理，不跨账号/请求持有进行中的Promise。错误、超限及超时均明确失败，原路线保留。

固定数据目录与Range请求不发送认证令牌、账号、名称或完整轨迹，只发送公开文件请求和必要字节范围。代码无Node专属依赖，Worker与本地Vite适配共用实现。

## 验证

自动化使用真实合成PMTiles v3/MVT字节及None/Gzip组合验证读取、解压、SVG和Worker运行时认证；合成数据不作为协会记录发布。真实公开惠州范围已成功读取目录与精确Range并生成静态图，证据在 ignored `artifacts/pmtiles-source-live`。云端实际运行与线上发布另记生产交接，不将本机成功等同于云端验收。
