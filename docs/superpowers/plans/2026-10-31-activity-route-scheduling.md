# Activity schedules and route selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 活动精确设置报名及活动起止时间，唯一轨迹上传入口为路线管理，活动选择路线并保存历史版本。
**Architecture:** 保留 content_items JSON 模型，新增路线选择 RPC 和快照，针对性迁移完善时间和引用约束。前端和本地草稿使用同一字段及等价校验，旧轨迹只读兼容。
**Tech Stack:** React 19、Vite、Node 24、Supabase PostgreSQL、Cloudflare Workers。
**Spec:** `docs/superpowers/specs/2026-10-31-activity-route-scheduling-design.md`

## Global Constraints

- 保留现有黑白/品牌橙/官方徽章；不新增依赖，不提交凭据或用户数据。
- 旧活动、旧轨迹、路线及去重审计不重写；旧私有 schema 不迁移。
- `registrationStart < registrationDeadline <= dateStart < dateEnd`；草稿可缺失，公开活动起止必填，开启报名时窗口必填；旧时间只读兼容，不推造。
- `routeSnapshot` 存在活动 payload 中；同 routeId 保存不重取快照，改选路线才更新；没有路线允许保存草稿。
- 时间、路线、旧轨迹及直接表写入均由数据库保护；使用 app_metadata，保持 SECURITY INVOKER。

## Review Focus

- 历史活动没有新增时间时不补造；截止后还能关闭报名/编辑历史记录。
- 路线被修改、归档或另一窗口删除后，选择保存必须重新核实。
- 活动不覆写路线；路线变更不改写活动快照；去重后快照保留来源。
- 绕开新 UI 的直接 DML 不得留下悬空路线或伪造活动轨迹。
- 尚未开启报名的页面到点自动更新；数据库阻止抢跑和截止后的申请。

## Task 1: Schedule and public behavior

**Files:** `src/activities/schedule.js`, `src/applications/registration.js`, `ActivityApplication.jsx`, `src/pages/Explore.jsx`, `src/map/footprints.js`, matching tests.
**Interfaces:** `toLocalDateTime(value)`, `readActivitySchedule(form,{published=false,legacy=false})` returns `{dateStart,dateEnd,registrationStart,registrationDeadline,registrationOpen}` ISO/null fields; `effectiveActivityStatus(activity,now=Date.now())`; `activityDateLabel(activity)`.
- [x] Add failing tests for time order, local-to-ISO, unknown legacy dates, future opening and deadline/start/end boundaries.
- [x] Implement pure schedule helpers, server-equivalent availability, running/ended status and four-time display; read snapshot before legacy track.
- [x] Verify focused tests and existing public/auth behavior.

## Task 2: Local selection transaction

**Files:** new `src/tracks/activity-route-selection.js`, `tests/activity-route-selection.test.mjs`; adjust local deletion only if required.
**Interfaces:** `applyActivityRoute(rows,activityRecord,{now}={})` returns new rows; input never mutated. `routeSnapshot` contains sourceRouteId, selectedAt, title, available track/trackLocalId/trackSummary, location fields, distance, ascent. Copy only trusted route fields. Preserve snapshot for unchanged routeId; explicit empty selection clears snapshot; legacy own-track remains unchanged when no snapshot. Selection checks `routeExpectedPayload` when supplied.
- [x] Fail then implement: one route reused by two activities without any route writes; unchanged reference freezes snapshot; changed reference refreshes; missing/archived/demo route and stale expected payload rejected; old track remains.
- [x] Verify metrics, coordinates, missing altitude and no input mutation.

## Task 3: Admin editing and upload entry

**Files:** `src/pages/Admin.jsx`, `admin.css`, `RouteImport.jsx`, related admin DOM tests.
**Interfaces:** consume Task 1/2 helpers. Activity editor gets `rows` and `onRefreshRoutes`; route select submits `routeId`. Cloud save RPC `save_activity_with_route({activity_record:record})`, envelope includes `expected:{payload,published}` for edits and `routeExpectedPayload` for changed/new selection. Return `{activity,route}`.
- [x] Add failing DOM tests for four datetime inputs, route selection and management link, no activity upload, route refresh retains typed values and legacy loading protection.
- [x] Implement selecting/clearing routes; display snapshot metrics without allowing manual spoofing; route TrackUpload remains; old import page redirects to route management.
- [x] Replace obsolete activity-upload DOM flows with route-create then activity-select flows; retain meaningful conflict and route protection cases.

## Task 4: Targeted SQL migration and real SQL validation

**Files:** new CLI-generated migration, new isolated SQL verification script/tests; no edits to applied initialization SQL.
**Interfaces:** `save_activity_with_route(activity_record jsonb)` as above; snapshot generated server-side. Same route preserves snapshot. Validate expected old record and route selection payload to detect stale edits. Old RPC execution retired only after delete dependency is replaced. Registration policy validates server clock and safe parsing. Direct DML trigger protects route references and activity track/snapshot integrity while allowing existing audited deduplication.
- [x] Create failing isolated tests applying actual migration chain for snapshots, legacy preservation, roles, direct DML, expected versions, delete/rebind, bad timestamps and opening/cutoff boundaries.
- [x] Implement targeted migration, validate both available PostgreSQL engines, check no changes to legacy sentinel or seeded existing data.
- [x] Review migration, apply to production once, verify history and data hashes.

## Task 5: Integrate and release

- [x] Independent review of source and SQL; resolve substantive findings.
- [x] Full npm tests, production build, Worker browser bundle without external Node imports; document actual results.
- [x] Apply migration before dependent UI; publish existing Worker, validate public resources and read-only cloud interfaces, no synthetic published records.
- [x] Update workflow/handoff documentation; commit, merge tested feature to main and push under existing authorization; verify remote SHA and clean checkout.

## Progress and rulings

- Design accepted by user's explicit route-history selection; original requested fields and sole upload entry remain authoritative.
- Execution uses parallel agents with separated files, root integration and final independent review. Work stays on feature branch in the supplied workspace so the user's existing runtime/dependencies remain available.

- Completed: full npm 328/328; actual migration-chain PG17/18 each22/22; two independent source/SQL reviews and targeted fixes; production migration20261031131635; Worker f9084d3c-26b4-4466-a31c-7fc3f29535b0, verified resource hashes and existing-data rollback test. No real user cover uploaded and no browser visual QA; these remain explicit validation boundaries.
