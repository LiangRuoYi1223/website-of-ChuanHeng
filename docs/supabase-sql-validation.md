# SQL 隔离验证与最小生产迁移

## 当前迁移链：活动时间、路线快照与补充指标

已应用 `20261031131635_activity_route_scheduling` 与 `20261031142417_route_manual_metrics_and_cover_limit`。`node --test scripts/validate-activity-route-sql.mjs` 按文件名排序直接加载实际迁移链，默认 PG18；设置 `SQL_TEST_ENGINE=pg17` 后运行 PG17。两者各 **27/27 通过**，覆盖旧数据/私有 sentinel、角色、时间窗口、快照冻结、直接 DML 引用保护、过期编辑拒绝、删除事务、旧轨迹回退和 Storage restrictive 策略（含已有 broad policy 组合）。

新增验证还覆盖：`resolve_route_track_metrics` 对原始统计与管理员补充的优先级、真实零值、未知值 `null`、来源/确认时间/非法数字校验、直接路线 DML 拒绝无效补充，以及活动快照冻结。新迁移仅将封面 bucket 上限改为 3 MiB，不改写现有内容、历史快照或 Storage 对象，保留原策略与允许的 MIME 类型。

生产迁移前后现有 content_items=2、applications=0，完整行哈希一致；对现有活动的受信保存验证以事务回滚，没有保存合成正式内容或图片。PGlite 的 Storage 表为隔离 stub，不能证明真实文件上传服务、网络失败或多连接竞争。封面客户端、服务端鉴权/限额/失败处理另有自动测试，原生 Images binding 及实际云端转换均已验证；实际用户照片的 Storage 持久化上传仍待验收。下方保留早期初始化迁移的独立验证记录。

## 早期初始化迁移验证记录

验证日期：2026-10-31。验证对象为 `docs/supabase-schema.sql` 与 `docs/route-deduplication.sql`。隔离测试只建立内存 PGlite，不读取生产密钥、不连接 Supabase、不写云端。

实际结果：PGlite `0.3.14` / PostgreSQL `17.5` 为 **13/13 通过**；PGlite `0.5.13` / PostgreSQL `18.6` 为 **13/13 通过**。原始 TAP 结果保存于 `artifacts/sql-validation/pg17.tap`、`pg18.tap`。这是两个独立内存数据库中的真实安装与 SQL 调用。

## 可复现测试

测试源保存在 `scripts/validate-supabase-sql.mjs`。测试依赖单独放在被忽略的 `artifacts/sql-validation`，没有修改项目根 `package.json` 或 lockfile。可在项目根用固定版本恢复测试环境：

```powershell
npm install --prefix artifacts/sql-validation --ignore-scripts --save-dev --save-exact @electric-sql/pglite@0.5.13 pglite-pg17@npm:@electric-sql/pglite@0.3.14
node --test scripts/validate-supabase-sql.mjs
$env:SQL_TEST_ENGINE = 'pg17'
node --test scripts/validate-supabase-sql.mjs
Remove-Item Env:SQL_TEST_ENGINE
```

PGlite 使用实际 PostgreSQL 引擎。测试创建 `anon`、`authenticated` 角色，以请求级 claims 实现仅供测试的 `auth.uid()`、`auth.jwt()` 和 `auth.users`，随后原样执行两份 SQL。权限检查确实在非超级用户角色下运行；不是以数据库所有者查询后推断 RLS。

每个测试包裹在独立事务内，结束时回滚。测试先建立 `chuanheng.legacy_sentinel` 并在安装后核验原值，证明这两份脚本没有触碰旧私有 schema。该哨兵只存在于内存测试库，未在生产创建。

13 个实际数据库测试覆盖：

- 两份 SQL 安装、强制 RLS、表授权、函数执行授权、固定搜索路径与 `SECURITY INVOKER`。
- 游客只读已发布、非示例、非归档内容；无报名表及管理 RPC 权限。
- 成员、领队、缺失 UID 及只伪造 `user_metadata.role` 的请求不能管理内容。
- 报名只能使用本人 `user_id`；示例、草稿、关闭、结束、过期、无截止时间与归档活动不能报名；其他成员不能读取报名。
- 保存活动原子生成稳定 UUID 路线；文件名优先级、真实轨迹指标、未知爬升 `null`、未核验标记与发布跟随。
- 无效输入、本地 IndexedDB 引用与 ID 类型冲突均无部分写入。
- 模拟活动表在后半段写入失败，已尝试更新/新建的路线也全部回滚。
- Unicode 同名组完整重验、过期选择拒绝、归档、审计、活动链接重定向与原始几何保留。
- 去重 winner 的原 owner 与其他活动更新/移除/删除均不能覆写胜出路线。
- 路线 `routeId` 引用、尚存 owner、`duplicateWinnerId` 引用拒删；共享路线保留。
- 报名外键拒绝活动删除时，前面的路线归档也一并回滚。
- 无效审计与损坏去重链拒绝整个操作。

## 实测修复

1. `save_activity_with_track` 的坐标验证原为未加括号的 `IF CASE ... END THEN`，实际安装报 SQLSTATE `42601`。已改为 `IF (CASE ... END) THEN` 并验证可安装及调用。
2. 旧 `content_public_read` 和报名策略未排除 `archived`，已发布归档活动仍可公开和报名。两处均补充排除条件，新增的真实 RLS 回归验证拒绝这类数据。

## 验证边界

PGlite 只有单独占用的数据库连接，不能证明两个生产连接之间的 `NOWAIT` 锁竞争。测试覆盖了 SQL 实际执行、同名组过期重验、角色权限与事务回滚；不将其表述为 Supabase Auth、PostgREST、托管网络、生产 locale 或多连接并发的完整验证。[PGlite 官方说明](https://pglite.dev/docs/)

测试 auth helper 只模拟数据库读取已验证 JWT claims 的接口，不验证 JWT 签名。生产必须由 Supabase Auth/Data API 验证令牌；`app_metadata.role` 只能由受信管理员设置，变更后用户需要刷新令牌。[Supabase RLS 文档](https://supabase.com/docs/guides/database/postgres/row-level-security)

## 已完成的生产迁移与后续复核

初次生产迁移 `20261031074956_chuanheng_v1_content_and_tracks` 成功时，新表均 0 行，RLS/FORCE RLS、四个 invoker 函数及匿名禁执行已核验；当时匿名内容 REST 为 200 空列表、报名表为 401。当前三份迁移均已应用，现有管理员内容保留，最新核验结果见 [生产交接](PRODUCTION-HANDOFF.md)。Advisors 无新增对象告警；旧 `chuanheng` 对象与数据保持原状。

1. 现存生产对象已经创建，不得重跑两份初始化 SQL 的 CREATE 或重复应用同一迁移。后续变化先核对现存定义、版本、编码和 locale，再准备针对性迁移。
2. 初始表/RLS 和路线 RPC 已作为同一迁移应用。不要为填充空站导入旧示例，不修改旧私有表。后续迁移保持事务完整性，不留下表成功、函数失败的半安装状态。
3. 保持两表 RLS/强制 RLS、最小表权限、函数 `SECURITY INVOKER`、固定 `search_path` 与内部管理员检查。不要为解决权限问题改成 DEFINER 或放开 PUBLIC EXECUTE。
4. 安装后检查 catalog 中的策略/授权与函数定义；使用真实游客、成员、管理员令牌验证公开读取、报名拒绝和管理 RPC。管理员身份从受信 `app_metadata.role=admin` 取得，不沿用前端或 `user_metadata` 自报角色。
5. 用两个隔离连接验证 RPC 表锁竞争整体失败、无部分写入；核对生产 Unicode 分组和时区。生产验证可以在事务内使用测试记录后回滚，不能把测试行混入正式内容。最后运行 Supabase advisors 并复核 API 结果。

当前 Cloudflare Worker 版本为 `bc4bdf05-7663-471e-ba69-a0ab6b06d1a4`，100% 流量运行此版本。首位测试管理员已确认邮件、受信赋权并通过真实登录；邮件回跳管理配置、实机视觉、真实内容持久化及多连接竞争仍按生产交接继续验收。
