# 活动轨迹关联与同名路线处理

## 当前流程（2026-10-31）

已应用针对性迁移 `20261031131635_activity_route_scheduling` 与 `20261031142417_route_manual_metrics_and_cover_limit`。GPX/KML 的唯一上传界面是后台路线管理，旧 `/routes/import` 地址跳转到该界面。先新建路线、上传轨迹并保存，再在活动编辑器选择路线；活动不再上传轨迹或自动新增路线。

`save_activity_with_route(activity_record jsonb)` 原子保存活动，首次选择或改选路线时由服务端生成 `payload.routeSnapshot`。同一路线的后续普通编辑保留快照；路线之后修改不会回写历史活动。旧活动自带轨迹、原自动路线及去重审计保留，清空关联时从原始旧轨迹恢复参数。前台以快照优先、旧轨迹兼容的顺序展示地图和海拔。

编辑携带 `expected:{payload,published}`，改选路线携带 `routeExpectedPayload`。源活动/路线被修改或删除时拒绝过期编辑，不重建已删除活动。触发器与延迟约束覆盖直接 DML 的引用保护；旧轨迹保存 RPC 已撤销站点调用权，删除 RPC 已解除对它的依赖。原去重 RPC 保留，重绑顶层 routeId 不修改历史快照来源。

四时间为 `registrationStart`、`registrationDeadline`、`dateStart`、`dateEnd`。输入按本地时区转换为 ISO，前台按北京时间展示；新公开活动起止必填，开启报名要求 `报名开启 < 报名截止 ≤ 活动开始 < 活动结束`。前台及数据库同时判断窗口。截止后可编辑历史内容；旧记录缺失时间不补造，未修改时间的旧记录可保留原字段。

活动封面支持不超过 3 MiB 的 JPEG、PNG、WebP 原图。`POST /api/covers/process` 在同源请求、真实管理员身份、文件体积/格式/像素与处理时限校验后，通过 Images binding 按比例转成最长边不超过 1920 像素、质量 80 的 WebP，并移除图片元数据。客户端只上传成功处理的结果至 `activity-covers`，服务失败不回退原图。使用管理员本人目录和随机新文件名，不覆盖或自动删除历史图片；存储仍只允许管理员本人目录 INSERT/SELECT，容量上限 3 MiB。首页、列表及详情共用封面降级逻辑：缺图或坏图显示带 AI 标识的示意图，示意图也失败则显示中性占位。

里程与累计爬升优先读取 `track.stats`。路线上传后缺失的项目会弹窗提示：管理员可补充缺失值、跳过或取消本次导入；已自动识别的项目不能覆盖。补充仅写入独立的 `track.manualMetrics`，包含 `source:'administrator'` 与 ISO 确认时间；原统计、逐点海拔和剖面保持不变。有效值优先级为自动统计 → 合法管理员补充 → 未提供，真实 0 值有效。数据库同步校验来源、时间和非负有限数字，防止直接 DML 绕过。

跳过补充时，未知里程或爬升显示“暂不提供数据”，不填零。Debug 列出仍有缺失项的路线，并提供路线编辑入口。活动编辑器只读展示所选路线的有效指标，不提供里程/爬升输入；首次选择或改选路线时，把当时指标及来源一起保存到活动快照。之后补充或修改路线不会改变已有活动的历史快照。

本地纯事务为 `src/tracks/activity-route-selection.js`，指标解析为 `src/tracks/metrics.js`。隔离 SQL 验证命令 `node --test scripts/validate-activity-route-sql.mjs`，`SQL_TEST_ENGINE=pg17` 选择另一引擎；双引擎各 27/27。云端旧活动保存事务验证后回滚；最新迁移与检查前后内容及报名哈希保持不变，封面对象数仍为 0。真实云端压缩已 HTTP 200 验证，但未将合成图片写入 Storage。真实用户封面 Storage 上传、实机视觉及多连接竞争仍待验收，不发布合成协会记录。

以下旧流程保留为数据兼容性记录，不是新建活动的上传指引。

本地草稿和隔离 SQL 已验证。生产迁移 `20261031074956_chuanheng_v1_content_and_tracks` 已应用，包含本文原子 RPC；旧 `chuanheng` schema 与数据保持原状。新版 Worker 已部署，公网 HTTP 验收通过；真实账号交接见 [生产交接](PRODUCTION-HANDOFF.md)。

## 本地原子更新

`src/tracks/activity-workflow.js` 只计算新数组，不读写 localStorage、IndexedDB 或网络，也不修改传入记录。调用方应在轨迹已成功保存、元数据已校验后，调用一次 `applyActivityTrack(rows, activityRecord)`，随后对返回列表做一次持久化。持久化失败不能假报活动或路线已保存。

`activityRecord` 是完整 `content_items` 形状：`{id, kind:'activity', payload, published, created_at}`。同 ID 不能覆盖其他类型的内容。活动标题、路线标题及 ID 不能用来推断真实地理位置。

可用轨迹有两种表示：

- 云端/内存完整轨迹：`payload.track` 为转换结果，带 `stats.distanceM`、`stats.ascentM` 与 GeoJSON。
- 本地引用：`payload.trackLocalId` 为已写入 IndexedDB 的 ID；`payload.trackSummary` 为摘要，包含 `stats:{distanceM,ascentM}`，也接受扁平 `distanceM/ascentM`。没有摘要或统计无效时拒绝保存，不能把未读取完成误当作删除。

距离由米换算成 `payload.distance` 的公里；`payload.ascent` 为米，缺失海拔保留 `null`。位置优先采用活动已经明确提供的 `coordinates`，其次摘要 `coordinates`、摘要 `location.coordinates`，再取完整轨迹首个真实点。仅保存经度 ±180°、纬度 ±90° 范围内的有限坐标。不会用边界中心、城市代表点或名字猜测活动地点。省、市等字段只跟随调用方已核实的活动定位结果。

每个有轨迹的活动维护一条自动路线：

| 字段 | 行为 |
| --- | --- |
| route `payload.generatedFromActivityId` | 自动路线的唯一归属活动 ID |
| route `payload.title` | 依次采用非空字符串：管理者显式 `routeName` → 文件 `track.name` → 本地摘要 `trackSummary.name` → 活动 `title`；去两端空白 |
| route `track / trackLocalId / trackSummary` | 跟随活动当前轨迹表示；本地引用不复制大体积几何 |
| route `distance / ascent / location / coordinates / province / city` | 跟随活动轨迹与已核实位置，同时支持 `provinceCode/cityCode/locations/locationStatus` |
| route `published` | 跟随活动发布状态；归档活动不发布其自动路线 |
| route `payload.isDemo / verified` | 均为 `false`；导入不代表实地核验 |
| activity `payload.routeId` | 关联生成或管理员去重保留的路线 |
| activity `payload.routeLinkSource` | 自动关联时为 `activity-track` |
| activity `payload.footprintEligible` | 有可用轨迹且未归档为 true；这不是协会/地点真实性证明 |

本地新自动路线 ID 为确定性的 `activity-route:<activityId>`，重复保存不会新增。这个 ID **只用于本地草稿**，不能直接插入云端 UUID 列。云端由服务器生成 UUID 并通过 `generatedFromActivityId` 保持稳定关联。

同名不同活动各自生成路线，不自动覆盖或合并。不同活动导入相同文件路线名，也会在 Debug 中产生同名组。已关联到去重胜出路线的活动继续保有自己的轨迹。胜出路线一旦有非空 `duplicateResolutions` 审计数组，其原归属活动和后续重定向活动的更新都不会改动它的标题、轨迹、元数据与发布状态；活动自己的轨迹仍可更新。

移除轨迹时，活动清除 `track/trackLocalId/trackSummary`、派生坐标、省市、位置状态和自动路线关联，设置 `includeFootprint=false`、`footprintEligible=false`；保留手填 `location` 文字。自动路线若无人再引用且不是已审计胜出者，仅归档并保留几何；若仍被其他活动引用或有去重审计则原样保留。归档原因 `activity-track-removed` 的原自动路线可在该活动明确重新上传轨迹时复用；去重归档路线绝不因此复活。

删除内容使用 `deleteContentWithLinks(rows, id)`，仍是无副作用的纯函数。删除活动先应用上述移除轨迹规则，再删除活动行；自动路线和审计历史不会被顺带删除。删除路线时，只要还有活动 `routeId` 引用、其 `generatedFromActivityId` 所指活动仍存在，或其他记录的 `duplicateWinnerId` 引用，就以 `CONTENT_IN_USE` 拒绝。不存在的内容以 `CONTENT_NOT_FOUND` 拒绝。其他内容保留原有删除行为。调用方也应在最终持久化前读取最新列表并检查编辑快照冲突，防止异步轨迹写入期间用旧列表恢复已去重记录。

## Debug 中人工选择

`findDuplicateRoutes(rows)` 返回 `{key,title,routes}` 数组，只包含未归档、非空标题且至少两条的路线组。比较规则为 Unicode NFKC → 去两端空白 → 连续 Unicode 空白折叠成单个空格 → 小写；全角 Latin、兼容空格及大小写差异会落到同组。

管理员看清各记录后调用：

```js
const nextRows = resolveDuplicateRoutes(rows, group.routes.map(row => row.id), winnerId, {
  actorId: 'local-admin',
  now: new Date().toISOString(),
});
```

调用会重新检查现存完整组。新增第三条、某条改名/归档/删除、传入部分组、重复 ID 或胜出者不在组内，均拒绝；`STALE_DUPLICATE_GROUP` 应提示刷新后重新选择，不能静默重试旧决定。

胜出路线保留原标题、轨迹、元数据与发布状态，仅追加审计；失败路线保留原行和全部几何，设置：

```text
payload.archived = true
payload.archivedReason = "duplicate"
payload.archivedAt = ISO时间
payload.archivedBy = 管理员标识
payload.duplicateWinnerId = 胜出路线ID
published = false
```

胜出路线 `payload.duplicateResolutions` 为数组，每次追加：

```json
{"originalIds":["按ID排序的完整组"],"winnerId":"保留ID","actorId":"管理员标识","at":"ISO时间"}
```

活动的 `routeId` 从失败者重定向胜出者，活动自有轨迹不删除。已去重归档的自动路线后续只沿 `duplicateWinnerId` 链找到当前胜出者，不新增同名替身，也不覆写胜出者。链失效或成环则拒绝保存，要求人工检查。归档失败者不会再次出现在 Debug 重复组中。

## 早期云端原子 RPC（兼容性记录）

下方保留最初的三个 RPC 定义背景；现行活动保存使用上文 `save_activity_with_route`，旧 `save_activity_with_track` 已撤销站点调用权。三个早期 RPC 均使用 `SECURITY INVOKER`、固定 `search_path`、服务器受信 `app_metadata.role=admin` 与非空 `auth.uid()` 检查。普通登录用户有函数 EXECUTE 权限并不意味着有业务操作权限；函数内部与现有 RLS 都会拒绝非管理员。没有使用 `user_metadata`、service key 或 SECURITY DEFINER 绕过。

- `resolve_route_duplicates(route_ids uuid[], keep_id uuid) returns jsonb`：返回 `{winnerId, archivedIds, resolution}`，原子归档失败路线、重定向活动和记录审计。
- `save_activity_with_track(activity_record jsonb) returns jsonb`：输入完整活动行，返回 `{activity,route}`，无当前关联路线时 `route=null`。验证 `kind='activity'`，确认现存 ID 为活动，再原子保存活动与其 UUID 自动路线。云端必须提供完整 `payload.track`；浏览器 `trackLocalId` 不能代替服务器可读取的轨迹。
- `delete_content_with_links(content_id uuid) returns jsonb`：返回 `{deletedId}`。对路线执行相同引用保护；对活动在同一事务内先调用移除轨迹逻辑，再删除活动。若已有报名的外键约束拒绝删除，前面的归档也会回滚。

三个函数在读取内容前取得 `SHARE ROW EXCLUSIVE` 表锁，再锁定/重验涉及记录；同时阻止普通内容写入及另一 RPC 在检查后插入新同名路线，避免只锁旧组留下幻读窗口。采用 `NOWAIT`，竞争时整体失败，界面应刷新并提示稍后重试。适合目前小规模管理操作；数据规模扩大后应另行设计基于规范键的唯一约束/专用锁模型。函数异常使整个调用回滚，不会出现只保存活动或只归档部分路线。

路线 RPC 部分不改变现有新模型的表、索引或 RLS；初始迁移中的表和策略由另一来源脚本创建。`CREATE FUNCTION` 刻意不用 OR REPLACE，同签名已存在时先失败，不得在已迁移生产库重复初始化。执行权限显式撤销后只给 authenticated；纯规范化辅助函数也限定权限。客户端不能上传自定 `archivedBy` 冒充另一管理员，云端审计身份来自 `auth.uid()`。

PostgreSQL `normalize` 依赖 UTF8；`lower` 使用数据库 locale。生产应继续核对 locale 与浏览器 Unicode 小写行为，尤其非中文/Latin 名称；服务端分组为最终依据。[PostgreSQL 字符串函数](https://www.postgresql.org/docs/current/functions-string.html)

现有 `public.content_items` 的 authenticated 表级 UPDATE/DELETE 授权满足此表锁权限要求，管理员资格仍由 RPC 检查与现有 RLS 双重限制。表锁持续到事务结束，并发更新需要一致锁顺序；建议各 RPC 单独调用，不和前序直接写内容混在外层长事务中。[PostgreSQL LOCK](https://www.postgresql.org/docs/current/sql-lock.html)

## 验证范围与上线前矩阵

本地测试覆盖自动关联和更新、文件命名优先级、不同活动同文件名、IndexedDB 引用摘要、空海拔、移除轨迹、共享路线保留、Unicode 分组、全组过期拒绝、审计与重定向、输入不变、归档不再提示、后续保存不复活失败者、失效/循环去重链与 ID 冲突，以及原 owner 更新/移除/删除时胜出者冻结、活动删除后路线归档、路线引用拒删。

上述旧流程已在隔离 PGlite 中实际安装并用 `SET ROLE` 验证游客、成员、伪造 `user_metadata`、领队、管理员的权限，以及保存/去重/删除和事务失败回滚。现行流程已另外核验真实管理员 JWT、现有活动保存回滚、迁移、RLS/函数授权、匿名 REST 与 advisors；持久化真实内容、Storage 用户照片上传和多连接锁竞争仍待验收。可复现步骤与修复记录见 [SQL 隔离验证](supabase-sql-validation.md)。
