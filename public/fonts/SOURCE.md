# 本地思源字体与 DM Sans

本目录为川衡网站提供本地 WOFF2。字体请求仅访问网站自己的 `/fonts/`，不使用外部 CDN、Adobe Fonts kit 或账户授权服务。所有字体以 SIL Open Font License 1.1 发布；完整许可与原始版权声明随文件保留。

| 用途 | 真正的上游字体 | 本网站网页分片家族名 | CSS 字重 |
| --- | --- | --- | --- |
| 中文正文、界面 | Adobe Source Han Sans CN VF 2.005（思源黑体 CN） | `Chuanheng Han Sans CN` | 400–700，包含 400/500/700 |
| 故事、章节标题 | Adobe Source Han Serif SC VF 2.003（思源宋体 SC） | `Chuanheng Han Serif SC` | 400–500，包含 400/500 |
| 英文、数字 | DM Sans 4.004，Google Fonts 官方发行 | `DM Sans` | 400–700，包含 400/500/700 |

中文文件确实来自 Adobe 官方思源字体，不能将系统回退字体称为思源。两套官方思源可变字体的 `wght` 轴为 250–900；本网站 CSS 使用其中所需的范围，并非浏览器合成粗体。DM Sans 同时保留 `opsz` 光学字号轴。

## 官方来源与固定版本

- [Source Han Sans 官方仓库](https://github.com/adobe-fonts/source-han-sans)，[2.005R 发行说明](https://github.com/adobe-fonts/source-han-sans/releases/tag/2.005R)。固定 release 提交：`a4f7cf94edfb9d7ffbdfc4841de276358bd7e0f2`。[原始 CN WOFF2](https://raw.githubusercontent.com/adobe-fonts/source-han-sans/a4f7cf94edfb9d7ffbdfc4841de276358bd7e0f2/Variable/WOFF2/TTF/Subset/SourceHanSansCN-VF.ttf.woff2)。许可：`Source-Han-Sans-OFL.txt`。
- [Source Han Serif 官方仓库](https://github.com/adobe-fonts/source-han-serif)，[2.003R 发行说明](https://github.com/adobe-fonts/source-han-serif/releases/tag/2.003R)。固定 release 提交：`7889f11bf31170b5d092a083b357c8c8130f89e0`。[原始 SC WOFF2](https://raw.githubusercontent.com/adobe-fonts/source-han-serif/7889f11bf31170b5d092a083b357c8c8130f89e0/Variable/WOFF2/TTF/SourceHanSerifSC-VF.ttf.woff2)。许可：`Source-Han-Serif-OFL.txt`。
- [DM Sans 官方设计项目](https://github.com/googlefonts/dm-fonts)，[Google Fonts 官方发行目录](https://github.com/google/fonts/tree/9710da1eacb3be272583c3224dcb70f9da6eadbb/ofl/dmsans)。固定提交：`9710da1eacb3be272583c3224dcb70f9da6eadbb`。[原始可变 TTF](https://raw.githubusercontent.com/google/fonts/9710da1eacb3be272583c3224dcb70f9da6eadbb/ofl/dmsans/DMSans%5Bopsz,wght%5D.ttf)。许可：`DM-Sans-OFL.txt`。

下载日期：2026-10-02。字体内的版本、上游名称、可变轴与 SHA-256 均记录在 `MANIFEST.json`。

## 分片方式与未来文案

使用 fontTools 4.59.2 与 Brotli 将官方字体转换为按需加载的 WOFF2；未重新设计字形、改变字重轴或替换为相似字体。原始版权、商标和许可元数据保留。

中文先生成一个覆盖构建时网站文案及基础拉丁字符的 `core` 分片，降低现有页面的首次字体下载量。其余字符按每 512 个 Unicode 码位的区块分片，由 `src/fonts.css` 的 `unicode-range` 自动选择。**全部分片合计保留原始字体全部可映射字符，不是只导出当前文案。** 新增文案只要原字体支持，即可自动加载对应已有分片，无需为每次内容更新重建字体。

- 思源黑体 CN：保留原始 30,926 个 Unicode 字符映射。
- 思源宋体 SC：保留原始 44,779 个 Unicode 字符映射。
- DM Sans：保留原始 403 个 Unicode 字符映射。

上述数量指原发行字体的字符覆盖，并不声称覆盖所有 Unicode 字符。官方 CN 区域版之外的罕见字、emoji 等，由 token 中的后续系统字体回退。每个输出分片均重新解码校验，所有分片字符集合与上游字符集合相等；详见 `MANIFEST.json` 的 `coverage_equal`。

## 分片名称与开源许可

Adobe 的许可保留名称 `Source`。网页预分片属于修改版，因此中文分片的内部家族、PostScript 与相关标识改为 `Chuanheng Han …`；CSS 家族名同步更名。这里的名称表示本网站的思源网页分片版，并不表示 Adobe 发布了同名字体，也不表示川衡创作了这些字形。官方来源与原名称完整保留在本说明、许可及 manifest 中。依据：[OFL FAQ 2.6 / 3.1](https://openfontlicense.org/ofl-faq/)。

## 复现

构建脚本位于 `scripts/build-fonts.py`。只在字体素材制作时需要 Python、`fonttools[woff]==4.59.2`；网站构建与浏览不依赖这些工具。

```powershell
python scripts/build-fonts.py
```

脚本从上述固定官方 URL 下载原始字体，生成 WOFF2 与 `src/fonts.css`，并写入字符校验和文件摘要。原始字体、解码中间文件与临时处理依赖位于 `artifacts/runtime/fonts/`，不在 `public/` 发布目录。
