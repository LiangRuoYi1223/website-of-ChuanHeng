# GPX/KML 轨迹导入实施计划

历史计划说明：下文记录本地功能实施阶段的目标。当前 Supabase 迁移与新版 Worker 部署均已完成，公网 HTTP 验收通过；最新状态见 [生产交接](../../PRODUCTION-HANDOFF.md)。

**目标：** 领队上传文件，由服务端转换成同一张地图中的独立线段及每段单独的海拔图。

**架构：** 纯 JavaScript 严格 XML 解析核心由本地 Vite 服务和 Cloudflare Worker 共用。结果带 GeoJSON、逐点剖面及分段统计，前端只绘制结果。本地草稿将大轨迹放入 IndexedDB，内容草稿只保存引用；云端使用 content_items.payload 与原子 RPC。数据库和 Worker 已在后续授权部署阶段应用。

**约束：** 保留已有权限；生产转换入口验证 Supabase 返回的 admin/leader app_metadata，开发绕过仅限回环本地服务。限制 5 MiB、30000 点、100 段。缺失海拔不填零，KML 非 absolute 高度不作为海拔。各段独立计算，不跨断点连线或累计距离。

1. [x] 解析核心与失败测试：GPX trk/rte、KML LineString/gx:Track、多段、异常XML、坐标及大小边界。
2. [x] HTTP、开发适配与 Worker：文件上传、同源、鉴权、流式大小限制、失败错误及测试。
3. [x] 地图与各段剖面：真实瓦片、离线坐标图回退，米/公里坐标轴，逐段选择与数据缺失状态。
4. [x] 上传工作台、管理编辑、草稿预览和持久化：转换后导出/保存；刷新和错误恢复验证。
5. [x] 全量测试、构建、本地HTTP上传冒烟，交付操作说明与生产交接记录。

实施选择由 React/Vite + Cloudflare/Supabase 环境决定。地图瓦片只提供底图，不给文件补充不存在的海拔；DEM补高程不是本次默认行为。转换不会认定轨迹已实地核验或自动发布。
