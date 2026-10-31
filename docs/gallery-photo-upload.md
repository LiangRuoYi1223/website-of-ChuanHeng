# 影像管理照片上传

影像编辑器直接选择 JPEG、PNG、WebP，并显示预览；已有记录的图片地址继续显示，重新选图后以新图保存。新建影像必须有照片，处理期间禁止保存。失败保留原照片，移除只清空当前编辑器引用，不删除历史文件。

## 体积和处理

- 原图最多 20 MiB，最长边 12000 像素、4000 万像素以内；每张保存结果最多 3 MiB（3145728 字节）。
- 所有原图在后台校验真实格式并转成 WebP，移除 EXIF 等元数据。超出 3 MiB 的原图可正常进入处理，不在浏览器直接拒绝。
- 保持原比例、不裁切、不放大；最长边先用 2560，质量依次 85、75、65，仍超限则缩小到 1920 并重试；整个处理最多 30 秒。无法压至上限时提示重选，不上传原图。
- 界面显示处理前后体积。原图不会写入正式 Storage。

## 接口与存储

`POST /api/photos/process` 接收单个 multipart `file`，先验证同源与真实管理员身份，再有界读取上传体并处理。生产 Worker 显式禁用本地旁路；Vite 本地设计预览仅在显式开启且两端 socket 都为回环地址、Host 也为回环时允许本地处理。

客户端只接受带 `x-photo-processed: 1` 的非空 WebP，检查输出大小和签名，再上传到公开 bucket `gallery-photos` 的本人 UUID 目录，随机生成新文件名、`upsert:false`。Storage 只允许 3 MiB 以内的 WebP，管理员本人目录可 INSERT/SELECT；限制性策略防止既有宽泛策略开放覆盖、删除或其他用户目录。普通用户不得上传。

本地预览同样先调用后台压缩，处理后只保存浏览器草稿，不访问云存储。浏览器草稿容量有限，存满会提示保存失败；正式使用应连接云端。

活动封面继续使用原有 `/api/covers/process` 和 `activity-covers`，原图上限仍为 3 MiB；本次不修改封面流程。

## 发布与验收边界

迁移：`supabase/migrations/20261031163336_gallery_photo_upload.sql`，由 Supabase CLI 创建。仅增加专用 bucket 和策略，不修改旧私有数据、活动、报名或原有对象。已于北京时间2026-11-01与活动报名功能统一迁移并发布。

本次不上传合成协会记录，不使用真实照片做云端存储测试。自动测试、真实本地图像解码/压缩、隔离 PostgreSQL 权限验证、Worker 打包和浏览器检查应分别记录，不能据此宣称云端真实上传已验收。

2026-11-01 本地验收：网站全套 393/393；PostgreSQL 17/18 各 29/29；生产构建通过。真实 Vite runner 的图片加载问题已复现、修复，并加入接线回归。独立 Edge 使用 17,518,075 字节合成 JPEG，后台处理为 2,965,416 字节 WebP（1707×2560），检查原比例、无 EXIF、本地保存及 1440/390 像素布局通过；无页面异常或横向溢出。代码及 Vite 修复均通过独立审查。生产迁移、部署和云端真实照片 Storage 上传尚未执行。

实现依据：[Supabase Storage 访问控制](https://supabase.com/docs/guides/storage/security/access-control)、[bucket 限制](https://supabase.com/docs/guides/storage/buckets/creating-buckets)、[Cloudflare Images bindings](https://developers.cloudflare.com/images/optimization/binding/) 和 [限制](https://developers.cloudflare.com/images/get-started/limits/)。
