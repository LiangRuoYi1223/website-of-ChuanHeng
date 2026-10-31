# 新版背景与官方 Logo

本页记录素材替换阶段的来源与当时验收。Supabase 与 Cloudflare 已部署，公网 HTTP 验收通过；最新 278 项测试和生产状态见 [生产交接](PRODUCTION-HANDOFF.md)。

依据用户指定的 `C:/Users/ander/Desktop/徒步新设计` 内六张设计合集，使用内置 image_gen 逐张重新绘制摄影资产。生成图不含文字、界面、Logo 或边框；没有沿用旧摄影。保留自然色彩，用冷蓝雪峰、适量暖光、绿色山海和橙色帐篷统一视觉。

## 已接入素材

| 文件 | 使用位置 | 完整提示词与来源 |
| --- | --- | --- |
| [home-summit.webp](../public/images/redesign-v2/home-summit.webp) | 首页首屏、通用主视觉 | [生成记录](../public/images/redesign-v2/home-summit-SOURCE.md) |
| [activities-snow.webp](../public/images/redesign-v2/activities-snow.webp) | 活动、资讯、足迹页与详情默认图 | [生成记录](../public/images/redesign-v2/activities-snow-SOURCE.md) |
| [routes-coast.webp](../public/images/redesign-v2/routes-coast.webp) | 路线库、精选路线、路线内容 | [生成记录](../public/images/redesign-v2/routes-coast-SOURCE.md) |
| [gallery-sunset.webp](../public/images/redesign-v2/gallery-sunset.webp) | 影像首屏、摄影内容 | [生成记录](../public/images/redesign-v2/gallery-sunset.SOURCE.md) |
| [team-ridge.webp](../public/images/redesign-v2/team-ridge.webp) | 关于首屏、协会介绍与人物主题影像 | [生成记录](../public/images/redesign-v2/team-ridge.SOURCE.md) |
| [join-hiker.webp](../public/images/redesign-v2/join-hiker.webp) | 加入、登录、首页加入模块 | [生成记录](../public/images/redesign-v2/join-hiker-SOURCE.md) |
| [alpine-lake.webp](../public/images/redesign-v2/alpine-lake.webp) | 首页轮播、知识入口、影像 | [生成记录](../public/images/redesign-v2/alpine-lake-SOURCE.md) |
| [camp-night.webp](../public/images/redesign-v2/camp-night.webp) | 首页轮播、营地影像 | [生成记录](../public/images/redesign-v2/camp-night-SOURCE.md) |

原始 PNG 保存于 `artifacts/redesign-v2/`，网站仅引用压缩后的 WebP。仅进行了格式压缩，没有通过 Pillow 创意修图。旧素材保留作历史记录，但不再被 src 中的页面或默认数据引用。文件尺寸、字节数与 SHA-256 见 [MANIFEST.json](../public/images/redesign-v2/MANIFEST.json)。

## 官方徽章

用户提供的 JPG 原样复制为 [chuanheng-official-badge.jpg](../public/brand/chuanheng-official-badge.jpg)，未重绘、未改色、未反色。源文件与项目文件 SHA-256 一致，记录见 [Logo 来源](../public/brand/SOURCE.md)。

导航、页脚、关于川衡、登录、后台和浏览器图标均使用该原图。关于与页脚展示完整徽章，其他位置等比缩小。

## 校验

- 8 张 WebP 均已打开检查且尺寸、压缩文件可读；8 份完整生成记录均存在。
- 官方徽章原始字节比对一致。
- 全部旧摄影 URL 已从 src 引用中移除。
- 素材替换阶段生产构建通过，当时 89 项自动检查通过；后续全套测试已增至 278/278。
- 首页、关于、登录、官方 Logo 和全部 8 张 WebP 的 localhost 请求均返回 200。
- 素材替换阶段仅更新本地资源；后续服务部署结果以生产交接记录为准。

新图片为 AI 摄影视觉示意，不能作为协会活动实拍、真实成员肖像或攀登成果；网站保留示意标识。浏览器自动目视检查受工具识别限制，本轮视觉复核针对实际 WebP 原图，未将其表述为三端浏览器截图验收。
