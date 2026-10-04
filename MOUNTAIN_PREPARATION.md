# 山体模型第一步：资料与工具准备

整理日期：2026-10-04（Asia/Shanghai）。依据：[已定稿总述](MOUNTAIN_BRIEF.md)。

本阶段已完成资料入口整理、候选地形文件访问核查、既有制作工具的只读定位。当前没有下载地形或校园媒体，没有启动 Blender、Computer Use 或开始建模。下一阶段执行等待用户单独批准。

## 1. 已确认的镜头需求

- 校园：从一号门朝内开场，校名石纳入镜头，随后升至斜上方鸟瞰。
- 成长：五台山的草甸、山路、较高山脊、远望雪山四个独立阅读位置。
- 峰顶：从峰顶外侧稍高处斜视，保留峰顶轮廓、山体与远山。
- 认识川衡：校园至五台山日光，慕士塔格峰为夕阳；加入段延续夕阳并拉远。
- 登山队：独立星夜山脚开场，沿冰川与雪坡升高，峰顶出现第一束日光。

## 2. 地形资料

### 2.1 数据选择与访问状态

| 数据 | 本阶段结论 | 用途与限制 |
| --- | --- | --- |
| [Copernicus GLO-30 AWS 公共桶](https://registry.opendata.aws/copernicus-dem/) | 优先候选；官方入口无需 AWS 账号，公共桶为 2021 release；6 个候选文件 HTTP HEAD 均返回 200。 | 约 30 米 DSM，用于山体大轮廓；包括树冠、建筑等表面高度，不能提供校门立面、独立树木或近景冰裂缝。 |
| [Copernicus 官方数据及许可](https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM) | GLO-30/90 免费使用；使用、传播及改造数据时须按官方规定署名。 | 转为地形模型属于改造使用，后续保留官方 modified notice，记录发行版、来源与取得日期。当前未取得地形文件。 |
| [NASA SRTMGL1 V003](https://www.earthdata.nasa.gov/data/catalog/lpcloud-srtmgl1-003) | 备用轮廓交叉核对；Earthdata 入口需要登录。 | 约 30 米，2000 年采集；不能代表当前校园建筑或当前冰川表面。 |

Copernicus 的水平坐标为 WGS84、垂直高程为 EGM2008；文件格式与命名依据[官方说明](https://copernicus-dem-30m.s3.amazonaws.com/readme.html)。SRTM 使用时保留来源与 DOI `10.5067/MEASURES/SRTM/SRTMGL1.003`，依据 [NASA 数据使用说明](https://www.earthdata.nasa.gov/engage/open-data-services-software/data-use-policy)。

访问核查记录：[terrain-access-check.json](docs/mountain-preparation/terrain-access-check.json)。仅检查响应头，无数据正文下载；六个完整原始文件合计 224,793,801 字节，约 225 MB。访问成功不代表已经读取、校验或处理栅格内容。

### 2.2 各区域的真实轮廓依据

| 区域 | 形态参考 | 定位可信度与待核查点 |
| --- | --- | --- |
| 塘朗山 | [深圳城管官方介绍](https://cgj.sz.gov.cn/xsmh/gysz/twf/jytb/content/post_10840038.html)：塘朗顶约 430 米，丘陵山地、森林覆盖率 87%。 | 尚未确定可靠的 WGS84 峰顶控制点。[高德极目阁 POI](https://www.amap.com/place/B0FFKJYD0W)只用于位置交叉参考，不直接作为建模控制点。 |
| 五台山 | [UNESCO 官方介绍](https://whc.unesco.org/en/list/1279)：五座开阔台顶；[景区地理资料](https://www.wtsykfwzx.com/ztzl_show.aspx?id=71)支持台顶、草甸和山脊形态。 | [UNESCO 地图](https://whc.unesco.org/en/list/1279/maps/)的台怀遗产区定位为 39°01′50″N、113°33′48″E，不是北台峰顶。[原始登山 GPS 记录](https://www.prominent-mountains.no/mountains/3000mtn/wutai.html)的北台点 39.08029N、113.56764E，仅为非官方交叉参考。 |
| 慕士塔格峰 | [冰川研究论文与 Figure 1](https://tc.copernicus.org/articles/17/5435/2023/tc-17-5435-2023.html)、[政府地貌介绍](https://zrzyt.xinjiang.gov.cn/xjgtzy/dzyjxq1/202301/14376bacc7f648a2982a0432d76327f6.shtml)：宽厚山体、积雪及冰川。 | 论文给主峰约 38°17′N、75°07′E，为分钟精度区域定位，不是测量级控制点。峰顶及具体展示山侧在后续地形读取与参考对照中核查。 |

### 2.3 初始数据覆盖建议

以下为准备阶段的初始裁切建议，单位为度、顺序为西/南/东/北，属于制作范围，不是官方边界。最终裁切随镜头细化。

| 区域 | 西、南、东、北 | 已核查可访问的候选瓦片 |
| --- | --- | --- |
| 南科大与塘朗山 | 113.94、22.54、114.04、22.63 | N22_00_E113_00；N22_00_E114_00 |
| 五台山 | 113.42、38.86、113.72、39.14 | N38_00_E113_00；N39_00_E113_00 |
| 慕士塔格峰及山脚 | 74.95、38.10、75.35、38.50 | N38_00_E074_00；N38_00_E075_00 |

这些区域保留原始真实地形。合入叙事世界时调整相邻关系与距离；应保留原始数据与改造记录，避免把叙事布局误作现实地图。

## 3. 校园资料

| 参考 | 年代与核查状态 | 用途 |
| --- | --- | --- |
| [官网当前校园地图](https://www.sustech.edu.cn/zh/contact_us.html)、[地图图片](https://www.sustech.edu.cn/uploads/images/2024/05/10103209_79587.jpg) | 图片路径为 2024/05/10，未标明测绘或更新日期。 | 建筑群、道路、水系、校门的相对布局。示意图不提供精确尺寸。 |
| [总务校园景观](https://gao.sustech.edu.cn/campus.html?lang=zh-cn) | 未标明照片拍摄年代；官方文字确认校名石正对一号门。 | 校门与校名石的关系，开场地标及绿化参考。 |
| [官方 VR 校园](https://www.sustech.edu.cn/vr.html) | 入口已确认，具体全景点位、角度与拍摄时间尚待查看。 | 门内外、建筑外观与地标关系的候选参考。 |
| [官方宣传片](https://www.sustech.edu.cn/zh/gallery/sustech-scenery.html) | 页面发布日期 2025-12-18；尚未逐帧核对镜头年代、覆盖范围。 | 斜上鸟瞰、建筑体量与校园氛围的候选参考。 |
| [第一教学楼图鉴](https://newshub.sustech.edu.cn/photos/46460.html) | 发布于 2025-05-06，具体图片角度尚待查看。 | 主要地标外观核对候选。 |
| [南科大和你一起“拼”](https://newshub.sustech.edu.cn/photos/47672.html) | 发布于 2026-06-12，尚未确认是否含一号门或完整鸟瞰。 | 近期校园实景候选。 |
| [校园地图 v3.2](https://mirrors.sustech.edu.cn/site/sustech-online/documents/campus-map/%E5%8D%97%E6%96%B9%E7%A7%91%E6%8A%80%E5%A4%A7%E5%AD%A6%E6%A0%A1%E5%9B%AD%E5%9B%BE-v3-2.pdf) | 202208 版本，由校园服务办公室与南科手册制作。 | 建筑命名与区域关系的辅助，不作为 2026 年精确现状底图。 |

以上资料已整理来源与页面信息，未下载媒体、未完成全部角度的视觉校对。2017/2018 会议手册、2019 航拍仅作历史辅助；AI 校园作品不作为实景建模依据。参考图片与地形数据的授权分别记录，不将参考照片自动当作可发布纹理。

### 校门精细模型的资料缺口

- 一号门：校外朝内正面、左右斜侧面、门内反看及门顶形态。
- 校名石：正面、侧后面及厚度。
- 尺寸：门体宽高、通道净宽、校名石宽高厚、门体到校名石距离。
- 校园鸟瞰：近期完整斜上实景、另一方向的交叉视角、主要建筑层数与屋顶轮廓。

当前入口与布局资料可支持简模研究，校门精细建模资料尚不齐全。后续先核对公开参考，标注无法确认的部分，不伪造为实测尺寸。

## 4. 已有制作工具

| 工具 | 已核查结果 | 未执行的核查 |
| --- | --- | --- |
| Blender | 已定位 `D:\blender\blender.exe`，文件版本 5.2；用户快捷方式指向同目录的 `blender-launcher.exe`。 | 未启动软件，未验证运行、渲染、工程保存与导出。 |
| glTF 导出 | `D:\blender\5.2\scripts\addons_core\io_scene_gltf2\__init__.py` 文件存在。 | 只证明模块文件存在，未验证启用状态或实际导出。 |
| Blender 自带 Python | `D:\blender\5.2\python\bin\python.exe`，文件版本 3.13.13。 | 未运行该解释器。 |
| 系统 Python | 已核查 3.14.7；NumPy 2.5.3、Pillow 12.3.0 可导入，Pillow 含 libtiff 支持。 | 未读取实际地形；Rasterio、tifffile、pyproj 当前未安装，是否需要新增依赖在执行阶段确认。 |
| Computer Use | 已读取技能说明；可用入口为 `node_repl` 与技能规定的 `@oai/sky`。 | 未初始化、截图或操作窗口；用户单独批准后再按技能说明操作。 |

工具只读记录：[tool-check.json](docs/mountain-preparation/tool-check.json)。现有 Blender 将作为后续工具，不另行下载或安装新的 Blender。

## 5. 准备结果与批准范围

- 已准备：总述与两个新增视角、地形来源与候选覆盖范围、6 个数据入口访问记录、校园参考索引、资料缺口清单、既有工具位置与文件版本。
- 当前没有生成简模、纹理或新的 `.blend/.glb` 文件，没有改动网站页面。
- 等待批准后的执行范围建议：取得并核查地形数据、查看校园关键角度、启动已有 Blender 与必要的工具检查，再进入简模与镜头预演。
- 校门细节、实际地形内容及工具运行均需在执行时验证；本阶段的来源可访问和工具文件存在，不等于精细模型或运行验证已完成。

本阶段的资料整理与只读工具核查已完成，进入执行前等待用户单独批准。
