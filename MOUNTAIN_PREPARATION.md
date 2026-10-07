# 山体模型第一步：资料与工具准备

整理日期：2026-10-04；更新日期：2026-10-07（Asia/Shanghai）。依据：[已定稿总述](MOUNTAIN_BRIEF.md)。

资料入口、地形取得处理与 Blender 运行验证已完成。2026-10-05 按用户要求重新取得数据，校园、塘朗山、五台山改用 GEDTM30 v1.2 预测裸地 DTM，慕士塔格峰保留 Copernicus GLO-30 冰川表面高程。四区均输出米制栅格和 OBJ，并通过 Blender 5.2.2 LTS 验证。旧数据删除记录见 [替换清单](docs/mountain-preparation/terrain-v2-replacement-manifest.json)。用户随后授权按官方地图、卫星资料搭建南科大具体建筑；校园第一版已生成并通过保存重开、GLB 回导和渲染检查，见 [校园模型](output/campus-model/README.md)。连续总场景和滚动镜头尚待制作。

## 1. 已确认的镜头需求

- 校园：从一号门朝内开场，校名石纳入镜头，随后升至斜上方鸟瞰。
- 校园鸟瞰新增必含建筑：理学院、工学院、商学院、智华楼、一丹图书馆等主要大型建筑；需核对其现状位置、建筑群范围及外形。
- 成长：五台山的草甸、山路、较高山脊、远望雪山四个独立阅读位置。
- 用户确认不必对应实际活动路线，五台山参考网络公开顺朝路线，由制作方搜索并选择参考。
- 峰顶：从峰顶外侧稍高处斜视，保留峰顶轮廓、山体与远山。
- 认识川衡：校园至五台山日光，慕士塔格峰为夕阳；加入段延续夕阳并拉远。
- 登山队：独立星夜山脚开场，沿冰川与雪坡升高，峰顶出现第一束日光。

## 2. 地形资料

### 2.1 数据选择与访问状态

| 数据 | 本阶段结论 | 用途与限制 |
| --- | --- | --- |
| [GEDTM30 v1.2 官方发布](https://zenodo.org/records/18887460) | 用于校园、塘朗山和五台山；从官方 30 米 COG 按目标窗口读取，原始网格与像元已核对。 | 约 30 米的机器学习预测裸地 DTM，CC BY 4.0；不是校园实测地形，可能存在残留树冠、建筑偏差和低地伪差。 |
| [Copernicus GLO-30 AWS 公共桶](https://registry.opendata.aws/copernicus-dem/) | 仅用于慕士塔格峰；2021 release 的两张瓦片已重新下载、校验并读取全部栅格块。 | 约 30 米 DSM，保留冰川和积雪表面形态；后期另加雪面材质及细节，不推算冰下基岩或当前冰川厚度。 |
| [Copernicus 官方数据及许可](https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM) | GLO-30/90 免费使用；使用、传播及改造数据时须按官方规定署名。 | 已保留 GLO-30 modified notice，记录发行版、来源、取得日期与派生文件校验值。 |
| [NASA SRTMGL1 V003](https://www.earthdata.nasa.gov/data/catalog/lpcloud-srtmgl1-003) | 备用轮廓交叉核对；Earthdata 入口需要登录。 | 约 30 米，2000 年采集；不能代表当前校园建筑或当前冰川表面。 |

Copernicus 的水平坐标为 WGS84、垂直高程为 EGM2008；文件格式与命名依据[官方说明](https://copernicus-dem-30m.s3.amazonaws.com/readme.html)。SRTM 使用时保留来源与 DOI `10.5067/MEASURES/SRTM/SRTMGL1.003`，依据 [NASA 数据使用说明](https://www.earthdata.nasa.gov/engage/open-data-services-software/data-use-policy)。

初始 [HEAD 访问记录](docs/mountain-preparation/terrain-access-check.json)仅保留为历史资料，不包含地形载荷。当前执行记录见 [v2 下载清单](docs/mountain-preparation/terrain-v2-download-manifest.json)与 [v2 处理清单](docs/mountain-preparation/terrain-v2-processing-manifest.json)：两个 GEDTM 原生分区裁切及两张重新下载的 Copernicus 瓦片合计 81,917,637 字节。

GEDTM30 当前 30 米 TIFF 的 scale 0.1 与 [官方精确 URL 元数据](https://codeberg.org/openlandmap/GEDTM30/raw/branch/main/metadata/cog_list.csv)的 scale 1、Float32、米不一致。依据官方元数据及塘朗山／五台北台同点高度对照，原始数值已是米；原生文件保留原标记，派生数据按 effective scale 1 处理并记录理由，未把山体压低十倍。

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
| 南科大 | 113.97、22.58、114.04、22.63 | GEDTM30 共享城市网格分区 |
| 塘朗山 | 113.94、22.54、114.04、22.585 | GEDTM30 共享城市网格分区 |
| 五台山 | 113.42、38.86、113.72、39.14 | GEDTM30 独立区域裁切 |
| 慕士塔格峰及山脚 | 74.95、38.10、75.35、38.50 | Copernicus N38_00_E074_00；N38_00_E075_00 |

这些区域保留原始真实地形。合入叙事世界时调整相邻关系与距离；应保留原始数据与改造记录，避免把叙事布局误作现实地图。

### 2.4 五台山顺朝参考（2026-10-04 补充）

- 已检索并阅读[亲历者顺时针朝台记录](https://www.zhihu.com/tardis/zm/art/706835071)：常见顺序为鸿门岩—东台—南台—西台—中台—北台，回到鸿门岩；具体支线与起终点存在不同版本。
- 该记录提供草甸、山路与松林等参考入口；当前未完成参考照片像素或路线轨迹的核对，不把文字记录视为测绘数据。
- [景区地理资料](https://www.wtsykfwzx.com/ztzl_show.aspx?id=71)支持五座台顶、草甸与山脊的地貌方向。
- 制作时选取沿线代表性景观，按四个成长阶段安排镜头；真实顺朝行程含升降，不要求网页镜头完整重走或持续遵循真实路线。

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

用户在 2026-10-05 曾要求跳过准备阶段的校园参考核对，随后明确要求按学校官方地图、卫星资料加入具体建筑。现已下载并实际查看官方地图、建筑照片与卫星影像，将 ICM 校界/标签、OSM 建筑轮廓及 WGS84 坐标对齐，核对五处主要地标。来源、文件哈希、官方层数和估算边界见 [建筑参考报告](docs/campus-model/building-reference-report.md)。参考照片没有作为模型纹理发布；历史航拍及 AI 校园作品不作为几何依据。

### 鸟瞰必含建筑补充核查（2026-10-04）

- 用户指定理学院、工学院、商学院、智华楼、一丹图书馆等为鸟瞰必含的主要大型建筑。第一版需要分别具有可辨认的体量、屋顶轮廓与正确的相对位置。
- [总务空间概况](https://gao.sustech.edu.cn/space.html?lang=zh-cn)将二期建设列为理学院、商学院与创新创业学院、工学院等，可作为建筑群范围的文字依据。
- [统计与数据科学系官方联系目录](https://stat-ds.sustech.edu.cn/portal/list/contact/id/50)列有商学院大楼办公室；商学院现已通过实际轮廓与官方照片核对，地上五层采用官方信息，总高暂估 23 米。
- [官方智华教学楼揭牌报道](https://newshub.sustech.edu.cn/html/202601/47208.html)发表于 2026-01-12，揭牌活动于 2026-01-10 举行。制作参考应使用当前建筑名称与近期外观，并核对旧地图中的对应标注。
- 后续建筑任务已取得并使用 113 个实际建筑/分部轮廓，保持院落与凹口。工学院采用官方最高高度；理学院高低分区、一丹图书馆坡屋顶及其余窗格为第一版估算，并在模型属性中记录。

### 校门精细模型的资料缺口

- 一号门：校外朝内正面、左右斜侧面、门内反看及门顶形态。
- 校名石：正面、侧后面及厚度。
- 尺寸：门体宽高、通道净宽、校名石宽高厚、门体到校名石距离。
- 校园鸟瞰：近期完整斜上实景、另一方向的交叉视角、主要建筑层数与屋顶轮廓。

现已根据一号门官方照片搭建灰色标志墙、黑雨棚及立柱，位置来自官方地图；尺寸与朝向为照片估算。独立校名石及精细近景仍需补充角度和尺寸资料。

## 4. 已有制作工具

| 工具 | 已核查结果 | 未执行的核查 |
| --- | --- | --- |
| Blender | 已实际运行 `D:\blender\blender.exe`，版本 5.2.2 LTS；四区地形导入、保存、新进程重开和 EEVEE 静帧渲染均通过。 | 尚未验证交互视口帧率或复杂最终场景性能。 |
| glTF 导出 | 已实际启用内置 glTF 模块；四区分别导出自包含 GLB，并在新进程回导核对坐标、面数、UV、简单材质和各自许可署名。 | 浏览器接入与最终材质表现属于后续阶段。 |
| Blender 自带 Python | Blender 内嵌 Python 3.13.13 已实际执行验证脚本。 | 未单独启动其命令行解释器；当前工具链不需要。 |
| 系统 Python | 初始核查为 3.14.7，NumPy 2.5.3、Pillow 12.3.0 可导入。 | 本轮未修改系统 Python；地形处理使用下一行的隔离依赖。 |
| 地形处理 Python | Codex Python 3.12.14，项目内 `artifacts/mountain-prep/python-tools` 包含 Rasterio 1.4.4、pyproj 3.8.0 等。 | 已完成四份源文件读取与四区处理，具体版本记录在 v2 处理清单。 |
| Computer Use / 脚本建模 | 用户已允许下载及本地 Blender 建模；校园采用后台 Blender Python 实际生成并保存模型。 | 本轮没有操作交互界面；尚未验证交互视口帧率。 |

工具状态记录：[tool-check.json](docs/mountain-preparation/tool-check.json)。运行验证记录：[v2 Blender 验证](docs/mountain-preparation/terrain-v2-blender-validation.json)；可编辑工程、GLB 与预览见 [四区 Blender 成果](output/blender-terrain-v2/README.md)。12 个验证阶段使用独立后台 factory-startup 新进程，没有保存用户偏好设置。

## 5. 准备结果与批准范围

- 已准备：总述、镜头方向、地形来源与实际地形输入、校园参考索引、资料缺口清单及经过实际运行验证的 Blender 工具链。
- 地形 v2 已完成：四区 WGS84 裁切、30 米 UTM 高程、16 位高度图、30/60 米采样 OBJ 地形及检查图，成果见 [地形说明](output/terrain-v2/README.md)。无空值；源像元、原始与派生文件校验、网格面朝向和 UV 已核对。校园与塘朗山 5,856 个重叠像元精确一致。
- 前三处使用 GEDTM30 预测裸地 DTM，没有把旧 DSM 简单滤波后冒充 DTM；树冠及建筑残留仍可能存在。慕士塔格保留冰川表面，不去除冰川真实体量。近景细节需后期制作。
- Blender 已生成四区地形验证工程；另完成南科大建筑第一版的可编辑 BLEND、GLB、校园鸟瞰、带标签概览及门内视角。重点建筑采用不同体量、颜色和屋顶；实际足迹与原 DTM 保留。工程记录见 [校园验证](docs/campus-model/build-validation.json)。
- 校园第一版含 109 个建筑和 4 个建筑分部轮廓，原 DTM 未变，独立基础接地检查通过。全球预测 30 米 DTM 及估算立面不代表实测精度；正式景观、材质、总场景和两页滚动镜头仍待制作。

用户已授权地形取得处理、Blender 验证、重新下载四区并删除旧模型，及按官方地图/卫星资料搭建校园建筑。当前地形入口为 v2，校园建筑入口为 `output/campus-model/sustech_campus.blend`。总场景与网站接入尚未执行。
