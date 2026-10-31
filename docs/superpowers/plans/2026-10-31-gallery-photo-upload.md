# 影像照片直接上传实施计划

> **For agentic workers:** 使用 superpowers:subagent-driven-development，并按任务独立测试和审查。步骤完成后勾选。

**Goal:** 影像管理直接选择照片、预览并上传，保存结果每张最多 3 MiB，超限原图由服务端压缩。

**Architecture:** 新增独立照片处理接口与 gallery-photos bucket，复用现有身份校验与 Images binding 适配。客户端只能上传已成功处理的 WebP；不改活动封面接口、报名功能或旧业务数据。

**Tech Stack:** React 19、Node.js 24、Cloudflare Workers Images、Supabase Storage/RLS、Node test runner。

**Spec:** 本聊天用户要求及附图；原图上限 20 MiB，保存上限 3 MiB；JPEG/PNG/WebP；单张编辑，原比例、不放大、移除元数据。原图最长边 12000 像素、4000 万像素以内；后台输出最长边先用 2560，质量 85/75/65，必要时缩小到 1920，失败绝不上传原图。

## Global Constraints

- 保留本聊天已完成的项目管理删除及他人的未跟踪计划文件。
- 另一聊天使用独立 activity-registration-management 工作副本；本次不切分支、不暂存、不提交、不发布，不修改其工作副本。
- 管理权限只来自服务端核验的 Auth app_metadata.role=admin，不信任 user_metadata。
- 新照片使用本人 UUID 目录与随机新文件名，不覆盖或删除旧对象；Storage 结果上限 3145728 字节、只收 image/webp。
- 生产无本地旁路；本地设计预览仅由 Vite 已验证的回环请求启用，压缩仍在后台完成。
- 不写真实/合成协会记录，不重跑旧 SQL，不修改活动封面 3 MiB 原图限制。

## Review Focus

- 大于 3 MiB 且不超过 20 MiB 原图可进入压缩；边界值、空文件、伪造格式及时限错误不得写存储。
- 处理失败、上传失败、关闭编辑器、并发选图均保留原照片，上传期间禁止保存。
- 新照片内容必须有照片；已有图片地址在编辑时继续显示，上传完成后保存 image 字段。
- 匿名/普通用户/伪造管理员、跨站调用及生产伪本地请求不得绕过后台核验。
- 输出不超过 3 MiB，保留比例、无 EXIF，不覆盖/删除既有文件；与活动封面及项目删除兼容。

### Task 1: 上传客户端和界面

**Files:** 新增 src/media/gallery-photo.js、GalleryPhotoUpload.jsx；新增 tests/gallery-photo.test.mjs、gallery-photo-dom.test.mjs。可复用 activity-cover.css，不修改 Admin.jsx、旧封面组件或后端。

**Interfaces:** uploadGalleryPhoto(client,file,{local=false,fetchImpl=fetch,readDataUrl,randomUUID,signal}={}) 返回 {url,originalBytes,outputBytes}；GalleryPhotoUpload({initialValue='',onBusyChange,disabled=false,local=false}) 提交 hidden image，显示预览、上传/更换/移除按钮、处理状态及前后体积。

- [x] 先写并运行失败测试：接受 >3 MiB 原图、20 MiB 上限；服务错误/未标记结果/输出超限不写存储；管理员验证、随机路径、upsert:false；本地也调用后台，之后才生成 data URL，不接触云存储。
- [x] 实现 POST /api/photos/process，结果需 x-photo-processed:1、image/webp、有效 WebP 签名、0<size<=3145728；正式成功后上传 gallery-photos 本人目录，返回公开地址；不上传原图。
- [x] DOM 验证处理中的忙碌回调与禁用，成功后预览和 hidden image 更新，失败保留旧图，卸载不更新，显示处理结果体积；文案原图最多 20 MiB，保存每张最多 3 MiB。

### Task 2: 独立后台图片处理

**Files:** 新增 server/photos/http.mjs、processor.mjs；新增 tests/photos-http.test.mjs、photos-runtime.test.mjs；不修改 worker.mjs、Vite 适配、旧 covers 文件，由主代理接线。

**Interfaces:** handlePhotoRequest(request,env={},options={})；processPhoto(file,images,options={}) 返回 {bytes,originalBytes}；MAX_PHOTO_BYTES=3145728，MAX_PHOTO_SOURCE_BYTES=20971520，MAX_PHOTO_REQUEST_BYTES=SOURCE+65536。POST /api/photos/process 返回 WebP 与 x-photo-processed:1、x-photo-original-bytes、x-photo-output-bytes。

- [x] 先写失败测试验证 >3 MiB 原图被接受；同源及可信管理员验证优先于处理。localPreview===true 仅供 Vite 可信回环使用，生产接线显式 false。
- [x] 实现有界 multipart、源大小/格式魔数/像素/30 秒时限；复用 tracks/http.mjs 身份/请求工具及 covers/processor.mjs detectImageFormat。独立处理策略按 Spec，多次编码总时限 30 秒，输出仍超限则可恢复报错，不回退原图。
- [x] 用真实 sharp 本地绑定验证 >3 MiB 合成图片压为 <=3 MiB WebP、原比例、EXIF 清除；错误路径、超时、超体积、伪造身份；不将合成图片上传到正式云存储。

### Task 3: 集成、存储和验收

**Files:** 主代理修改 src/pages/Admin.jsx、server/worker.mjs、server/tracks/vite-plugin.mjs；CLI 新建针对性 Storage 迁移；新增集成测试和 docs/gallery-photo-upload.md。

- [x] 最小接入 photo 专用组件，保存时要求 image，上传期间不可保存；保留 activity 组件与 article/route 地址输入。
- [x] Worker 和 Vite 共享 handlePhotoRequest，生产禁用本地旁路；本地只使用 isLocalPreviewRequest 结果。
- [x] 新建 gallery-photos 存储策略，管理员本人目录 INSERT/SELECT，限制其他既有宽泛策略绕过，禁止覆盖/删除；隔离验证迁移；与报名统一发布前由另一聊天应用，当前没有云端数据变化。
- [x] 独立审查，运行相关测试、全套 npm test、生产构建、Worker 无 Node 依赖打包；浏览器桌面和手机检查一轮，确认上传界面与限制。
- [x] 记录通过项及未进行的云端真实照片上传；不部署。

## 执行记录

- Ruling: 在当前工作区最小修改，保留已完成但未提交的项目删除；不切换共享分支或操作他人副本。
- 文档依据：Supabase Storage bucket 限制与 RLS 文档、Cloudflare Images bindings/limits（2026-10-31 已核对）。

- Task 1/2: complete，分任务及整体审查通过；Vite 真实配置加载问题另行红绿验证并补审。
- Task 3: 本聊天授权范围完成；393/393、PG17/18各29/29、正式构建、真实Edge桌面/手机与本地大图上传均通过；生产迁移与发布按协调留待统一整合。
- Ruling: 图片预览使用 contain 展示完整画面；静态加载 Node-only 本地绑定，避免 Vite runner 关闭后的延迟导入。
