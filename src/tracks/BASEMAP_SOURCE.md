# 轨迹地图底图来源

## 默认底图

- 服务：OpenStreetMap Standard，直接由访问者浏览器请求 `https://tile.openstreetmap.org/{z}/{x}/{y}.png`。
- 地图和数据来源：[OpenStreetMap 版权与许可](https://www.openstreetmap.org/copyright)。界面保留可见的 `© OpenStreetMap contributors` 链接，不混用原 OpenTopoMap/SRTM 的署名。
- 使用依据：[OSMF Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/)，2026-11-06 核对。公开小型网站的普通交互查看可使用，无需新 API key；服务尽力提供，不保证可用性。
- 只按当前视口和正常浏览器行为请求，不实现离线下载、区域预抓或批量抓取，不添加服务端瓦片代理。使用浏览器默认缓存，不发送禁缓存请求头。
- Leaflet 瓦片使用 `strict-origin-when-cross-origin`，保留站点来源 Referer，不把当前活动页面的完整地址发送给跨站底图服务。
- 默认最高缩放级别 19，轨迹按 GPX/KML 的真实 WGS84 坐标叠加。坐标不为显示底图改写，不在轨迹断点间补线，不改变海拔或统计。

## 自定义与离线

继续支持 `.env.example` 中的 `VITE_TERRAIN_TILE_URL`、`VITE_TERRAIN_TILE_ATTRIBUTION` 和 `VITE_TERRAIN_TILE_MAX_ZOOM`。自定义 HTTPS XYZ 必须提供来源署名；设置为 `offline` 时明确只显示坐标轨迹。环境变量保留原名以兼容已有配置，并不表示默认 OSM Standard 含地形等高线。

瓦片需要访问者网络可达。网络失败显示明确提示与重试入口，坐标轨迹始终可以查看；不以虚构地形代替真实底图。站点 SVG 全国省级地图的来源/授权另见 `src/map/SOURCE.md`，此处更换瓦片不会改变该数据的许可状态。

## 本次核验边界

在正常系统代理路径，对惠州附近 z13/z15 的各一张瓦片进行少量按需检查，原 OpenTopoMap 和 OSM 均返回有效 PNG；OSM 本次响应更快。此观察不证明所有网络环境可用，也不表示原 OpenTopoMap 停止服务。没有批量扫描、预取多级区域或把样例轨迹作为协会记录。
