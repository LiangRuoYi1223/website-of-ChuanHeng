# 项目入口移除与影像上传交接

更新：2026-11-01。代码就绪，等待与活动报名分支统一整合。基线为 `1d2efd0a7e6b69ad5297204754039795b562ef20`；本聊天未切分支、未暂存、未提交、未推送、未应用生产迁移、未发布，也未修改另一聊天的工作副本。

## 结果

- 移除项目管理导航及占位页，旧地址进入通用后台未找到页面；按背景管理标识保留系统设置分组位置。
- 影像选择照片上传，原图最多 20 MiB；后台压为最多 3 MiB WebP，按比例、不放大、无元数据，处理前后体积可见。上传期间禁止保存，失败保留旧照片，新建影像要求照片。
- 独立 `/api/photos/process` 与 `gallery-photos`；生产管理员核验、本地可信回环旁路；不覆盖/删除历史对象，不修改现有活动封面规则。
- 修复真实 Vite `--configLoader runner` 在配置加载结束后无法动态加载图片模块的问题：Node-only 适配和 sharp 在配置阶段静态加载。Worker 不导入该适配。

## 本聊天拥有的准确文件清单

合并时仅选择下列 21 个文件，保留其他工作。

```text
src/pages/Admin.jsx
tests/render.test.mjs
src/media/gallery-photo.js
src/media/GalleryPhotoUpload.jsx
src/media/gallery-photo.css
server/photos/http.mjs
server/photos/processor.mjs
server/worker.mjs
server/tracks/vite-plugin.mjs
server/covers/local-images.mjs
supabase/migrations/20261031155945_gallery_photo_upload.sql
scripts/validate-activity-route-sql.mjs
tests/gallery-admin-dom.test.mjs
tests/gallery-photo-dom.test.mjs
tests/gallery-photo.test.mjs
tests/photos-http.test.mjs
tests/photos-runtime.test.mjs
tests/photos-adapter.test.mjs
docs/gallery-photo-upload.md
docs/gallery-photo-upload-handoff.md
docs/superpowers/plans/2026-10-31-gallery-photo-upload.md
```

**明确不属于本次：** `docs/superpowers/plans/2026-10-31-kml-missing-altitude-mode.md`，原有未跟踪文件，保持未改动。不提交 artifacts、dist、日志或临时依赖。

## 验证

- 最终 `npm test`：393/393，通过；完整结果 `artifacts/gallery-photo-work/final-tests.log`。
- 隔离 SQL：`node --test scripts/validate-activity-route-sql.mjs` 与 `SQL_TEST_ENGINE=pg17` 各 29/29，通过。旧封面策略的快照断言改为仅比较 `activity_covers_%`，以允许新增影像策略；原策略、对象、历史内容仍验证保留。
- 正式构建 `npm run build:production`：通过。
- Worker `wrangler deploy --dry-run --metafile`：只本地打包；产物无外部/Node 内建模块。最终整合后应再做统一打包。
- 分任务及整体独立审查通过，最后 Vite 修复另有补审；报告位于 `artifacts/gallery-photo-work/task-review.md`、`final-review.md`。
- 真实无头 Edge 1440×1100 和 390×844：上传、后台处理、本地保存、编辑预览、无横向溢出通过。合成 JPEG 17,518,075 → WebP 2,965,416 字节，1707×2560、原比例、无 EXIF，无页面异常。截图与结果在 `artifacts/gallery-photo-work/visual/`。
- 没有真实云端照片上传、生产内容写入或生产迁移。真实 Vite 临时预览服务 5187 已停止。

## 建议整合顺序

在原目录仅提交上述清单，再将该提交合入活动报名独立分支。重点核对 `src/pages/Admin.jsx` 的 import、图片组件、保存校验、imageBusy 文案及既有项目入口删除，保留另一分支报名容量、双击名单和日志功能；SQL 验证脚本若双方都修改，保留两组新增测试及影像策略过滤。

统一测试、双 PostgreSQL、构建与 Worker 打包通过后，再应用报名迁移与 `20261031155945_gallery_photo_upload.sql`，核验 Storage bucket 上限 3145728/仅 WebP 和管理员本人目录策略；最后统一发布。本聊天已完成独立实现，源码写入停止后会在 commentary 明确说明。
