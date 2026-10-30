# HarmonyOS Sans SC 与 Inter

本网站使用 **HarmonyOS Sans SC** 字体。版权所有 © 2021 Huawei Device Co., Ltd.，依据随字体保留的 HarmonyOS Sans Fonts License Agreement 使用。

英文与数字使用 **Inter 4.1**。版权所有 © 2016 The Inter Project Authors，依据 SIL Open Font License 1.1 使用。

核实日期：2026-10-30。字体从本网站自己的 `/fonts/` 提供，不请求第三方字体 CDN；原有思源与 DM Sans 字体、来源说明及生成器保留。

## 官方来源与实际文件

| 字体 | 官方获取地址 | 本站文件 | 实际字重与格式 |
| --- | --- | --- | --- |
| HarmonyOS Sans SC | [华为设计资源页](https://developer.huawei.com/consumer/en/design/resource/)、[官方 ZIP](https://developer.huawei.com/images/download/general/HarmonyOS-Sans.zip) | `harmonyos-sans-sc/HarmonyOS_Sans_SC_Regular.ttf` | 400，原始 TTF |
| HarmonyOS Sans SC | 同上 | `harmonyos-sans-sc/HarmonyOS_Sans_SC_Medium.ttf` | 500，原始 TTF |
| HarmonyOS Sans SC | 同上 | `harmonyos-sans-sc/HarmonyOS_Sans_SC_Bold.ttf` | 700，原始 TTF |
| Inter 4.1 | [官方网站](https://rsms.me/inter/)、[固定版本发行页](https://github.com/rsms/inter/releases/tag/v4.1)、[官方发行 ZIP](https://github.com/rsms/inter/releases/download/v4.1/Inter-4.1.zip) | `inter/InterVariable.woff2` | 100–900，原始可变 WOFF2 |
| Inter 4.1 | 同上 | `inter/InterVariable-Italic.woff2` | 100–900，原始可变斜体 WOFF2 |

华为当前英文资源页的下载按钮指向官方 RAR；上表的官方 ZIP 同样可获取，已实际读取并检查其 `HarmonyOS Sans/HarmonyOS_Sans_SC/` 内的字体与许可。本机已有的三份 HarmonyOS Sans SC 文件经逐字节比对与该官方 ZIP 一致后复制到本项目。

Inter 的两份 WOFF2 与许可直接取自官方 `Inter-4.1.zip` 的 `web/` 与根目录，未作转换。字体与发行包 SHA-256、文件长度和来源见 [`BRAND-FONTS-MANIFEST.json`](./BRAND-FONTS-MANIFEST.json)。

## 许可与交付约束

- **HarmonyOS Sans SC** 使用华为专用字体许可，不是 SIL OFL。保留 [`harmonyos-sans-sc/LICENSE.txt`](./harmonyos-sans-sc/LICENSE.txt) 原件、版权声明，并在网站中醒目标明使用 HarmonyOS Sans 字体。许可允许把未修改字体与软件一同嵌入、捆绑或分发，禁止修改字体或其组成部分，以及把字体单独分发或销售。本项目据此保留原始 TTF；不进行子集、分片、重命名字体元数据或 WOFF/WOFF2 格式转换。
- **Inter** 使用 SIL OFL 1.1，保留 [`inter/LICENSE.txt`](./inter/LICENSE.txt) 的版权与完整许可，不单独出售字体，不暗示作者为修改版背书；字体继续依据 OFL 分发。本站直接使用原始发行文件。
- 完整条款以随文件的许可证为准。字体许可不意味着华为或 Inter 作者对本网站、协会或项目作出背书。

## 网页接入

`src/brand-fonts.css` 声明两款本地字体；CSS 家族名分别为 `HarmonyOS Sans SC`、`Inter`。HarmonyOS Sans SC 的真实字重为 400 / 500 / 700；Inter 为 100–900。按页面实际所需字重加载，使用 `font-display: swap`，不预加载全部中文字体。

这份字体样式独立于旧的 `src/fonts.css` 和 `scripts/build-fonts.py`，避免由旧生成器误改华为原始字体。保留原始完整中文字体意味着单份约 8 MB；不能用重新分片来减小体积。
