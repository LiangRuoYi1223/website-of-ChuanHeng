# 路线静态底图来源与边界

**现行实现已改为 [Protomaps 开放地图文件与区域抽取](PROTOMAPS_SOURCE.md)。以下 Overpass 方案只保留为历史试验记录，已不参与当前路线上传或查看。** 原公共查询服务在真实云端也超时，因此不再作为正式数据来源或自动后备。

2026-11-06 核对。此功能在有权限的路线上传/补图操作中，以路线范围查询一次真实 OSM 数据，再由本站服务端绘制单张 SVG；图片随现有路线 JSON 保存。活动选择路线时继承该图片快照，查看图片不再请求第三方地图。

## 数据、署名与服务使用

- 数据：[OpenStreetMap 版权与许可](https://www.openstreetmap.org/copyright)，ODbL。OSM 允许复制、分发与改编开放数据，须署名并明确许可。图片底部保留 `© OpenStreetMap contributors · ODbL · openstreetmap.org/copyright`；元数据同时记录许可链接，前台也应提供可见署名和可点击的版权链接，遵循[官方署名指南](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines)。本站没有把 OSM 开放数据误当成无约束的免费瓦片服务。
- 查询服务固定为 [Private.coffee Overpass](https://overpass.private.coffee/) 的 `https://overpass.private.coffee/api/interpreter`。其直接公开条款允许包括商业用途的项目使用，无需注册，目前没有速率限制；仍要求公平使用、限制并发、不得发送身份信息、遵守 OSM 许可。服务没有可用性保证。仅在认证路线导入时串行按需准备一次并持久保存，不自动重试、不轮换端点、无访客实时查询。
- 请求只包含扩大后的地理边界与固定要素筛选，不发送路线名称、用户身份、完整轨迹或认证令牌。按服务建议使用 POST，User-Agent 标识本站程序及公开项目联系地址：`ChuanhengRouteBasemap/1.0 (+https://github.com/LiangRuoYi1223/website-of-ChuanHeng)`。
- 原 `overpass-api.de` 主公共服务不再作为默认或后备。其[资源说明](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html)和当前 [OSM Wiki 服务说明](https://wiki.openstreetmap.org/wiki/Overpass_API#Public_Overpass_API_instances)指出常态网站使用需要更严格额度及限制，原服务联调也出现 HTTP 406；本次是主动改为单一允许项目使用的服务，不以失败后轮换方式规避原服务规则。原 FOSSGIS [服务条款页](https://www.fossgis.de/arbeitsgruppen/osm-server/nutzungsbedingungen/)在工具访问中被 Anubis 拒绝，未声称已读其全文。
- 未请求、抓取或缓存 `tile.openstreetmap.org` 标准瓦片。[OSMF 瓦片策略](https://operations.osmfoundation.org/policies/tiles/)明确禁止该服务的离线预抓；允许使用开放数据不代表可以预抓标准瓦片。

## 保存内容与保护

- 图片只包含响应中实际存在的道路、水系、封闭水域/植被区域和命名地点；不绘制等高线、猜测地名或虚构要素。没有可显示的要素就明确失败。底图不包含用户路线线条，前台另按原始坐标叠加轨迹。
- 1000 × 600，EPSG:3857；从真实轨迹求边界，按图片宽高扩展并增加 20% 留白。保存的 WGS84 `bounds` 精确描述整张图片的投影范围；超出 Mercator 纬度范围或跨日期变更线的轨迹拒绝生成。
- 路线最多 30,000 点、100 段。补幅后的投影边长不超过 200 km，面积不超过 10,000 km²。Overpass 超时声明 15 秒，本地从请求到读完响应的总期限不超过 20 秒；响应最多 4 MiB、6,000 要素、60,000 路径坐标，SVG 原文最多 256 KiB，Base64 后相应增加约三分之一。任何限制触发均保留失败状态，不以空背景冒充底图。
- 标签按 XML 文本转义并限制长度；SVG 仅包含本站绘制的本地路径、文字与固定样式，没有脚本、外部资源、外链元素或 `foreignObject`。输入、OSM 响应、图片数据和用户路线不写日志。

## 接入

`createRouteBasemap(geojson, {fetchImpl, signal, now, timeoutMs})` 无 Node 专属依赖，适用于 Worker 与本地服务。给 `handleTrackRequest` 注入 `createBasemap: createRouteBasemap` 后：

- `POST /api/tracks/convert?basemap=1`：保留既有 GPX/KML 转换和可信角色验证，成功后在 `track.basemap` 合并静态图片；底图失败时整次转换不返回部分成功结果。
- `POST /api/tracks/basemap`：同源、同一可信身份验证，JSON 仅接受 `{geojson}`，请求体最大 5 MiB，用于既有路线补图；返回 `{basemap}`。它不直接写数据库，也不能更改历史活动快照。
- 未带 `basemap=1` 的转换保持原有行为，不额外调用 Overpass。可信本地预览的授权范围沿用既有适配器；生产入口必须继续显式禁止本地预览。

本次自动化测试全部使用合成坐标和受控 OSM 形状数据，不向第三方发送真实会员或路线记录。源数据质量、现场开放情况和通行安全仍需核实；简化背景图不是导航或实地审核凭证。

## 服务核对与实际联调

直接核对了 [Private.coffee Overpass 主页及服务条款](https://overpass.private.coffee/)（页面标注条款更新于 2026-04-10），已将其作为唯一固定上游。条款许可和真实连通性是两件事；修改端点不意味着联调成功。

2026-11-06 使用公开的大南山范围 `114.8583…114.9161, 22.9053…22.9242` 合成两端点，经本机系统代理串行诊断原服务 POST、Private.coffee POST 和 GET；三次都在 20 秒内未收到响应头，尚无 HTTP 状态码或响应类型可记录。结果另存忽略提交的 `artifacts/route-basemap-live-check/*-diagnostic.json`。仅凭这几次本机检查未取得真实地图图片，不宣称通过图面清晰度验收。端点迁移依据是新服务明确的项目使用许可，不是自动故障轮换。

另建立了独立的 Cloudflare 临时远程开发验收配置和固定公开范围脚本，未引用生产业务绑定、变量或正式路由。默认环境和一次显式系统代理修正后均未返回本机开发端口的健康响应，随后停止全部自有临时会话；未触发地图生成入口，未发出远程 Worker 的 Overpass 请求。因此尚不能确认真实 Worker 出站连接和真实底图图面。记录保存在忽略提交的 `artifacts/route-basemap-remote-check/result.json`，没有为此部署正式 Worker 或更改业务数据。
