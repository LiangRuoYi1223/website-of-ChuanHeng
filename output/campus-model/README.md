# 南方科技大学第一版建筑模型

2026-10-06 已生成；2026-10-07 继续完成交付检查。建筑依据校园官方地图、建筑照片与卫星影像核对身份和位置，在保留的 GEDTM30 校园 DTM 上独立搭建。

## 打开与查看

- `sustech_campus.blend`：可编辑 Blender 5.2.2 LTS 工程，约 31.7 MB。用 Blender「文件 → 打开」选择本文件，在 Outliner 的「重点地标」下选择理学院、工学院、商学院、智华楼或一丹图书馆；「校园建筑」保留其余来源建筑。地形、建筑、道路、水系、校门与照明分开组织。
- `sustech_campus.glb`：自包含模型，约 21.0 MB，供后续网站接入。标签与预览相机不导出，建筑身份、来源和估算说明保存在 extras 属性中。
- `campus_aerial.png`：完整校园斜上鸟瞰。
- `campus_overview_labeled.png`：标出五处主要地标（工学院分南、北楼）。
- `landmark_details.png`：五处主要地标与一号门的六格局部预览；原模型只读渲染，细节图不会改变主工程。
- `gate_inward.png`：一号门朝校园内部的模型预览。透明背景可承接后续天空；当前还没有正式造景与精细校名石。

在工程的「相机与照明」集合选择 `campus_aerial` 或 `gate_inward`，设为活动相机后按小键盘 0 查看构图；按 F12 可渲染。工程中文字体已打包。

## 已制作的内容

模型使用 **113 个来源建筑/建筑分部轮廓：109 个 building、4 个 building_part**，不能解读为 113 栋互相独立的实体楼。实际多边形、凹口和内院孔洞保留；道路与水系按地图中心线生成，宽度为第一版估计。

| 重点地标 | 模型依据与第一版处理 |
| --- | --- |
| 理学院 | 实际合并轮廓、内院及开放凹口；官方地上 5–9 层。低翼 23.5 米、高端部 42.5 米及高度分区位置为照片/卫星判读估算，非施工图。 |
| 工学院 | 南北两个实际 C/U 形轮廓与开放院落；南 9 层、最高 42.3 米，北 10 层、最高 46.8 米采用官方信息；坡屋顶高差和立面为照片估算。 |
| 商学院 | 实际带开放凹口的轮廓；采用官方地上 5 层，总高暂估 23 米。地下室没有建模。 |
| 智华楼 | 原第三教学楼的实际轮廓；采用现名、地上 5 层，总高暂估 22.5 米。 |
| 一丹图书馆 | 单独建筑分部、橙红色外墙与斜屋顶；官方总 4 层包含中心共用首层，按 4.5 米基座加 15.5 米上部体量估算，总高 20 米。没有把错误的 OSM 5 层继续叠加。 |
| 一号门 | 官方门址和照片；灰色标志墙、黑色雨棚及立柱已建，尺寸与朝向仍为照片估算。 |

普通建筑按可用 OSM 层数估高；未提供层数的暂按四层处理。窗户布局是简化重复立面，未逐窗测量。这是一版有真实布局与主要外形区别的校园体量模型，不是室内模型或测量级 BIM 复刻。

## 地形、精度与验证

原始地形网格完整保留，建筑基础作为独立网格接到 DTM。该 DTM 是约 30 米的全球预测裸地产品；校园道路的平台、台阶和精细竖向仍需实景资料，接地检查只能证明模型与当前 DTM 相接，不能证明现实地面精度。

三次独立 Blender 后台进程完成搭建保存、工程重开/导出渲染、GLB 回导。642 个导出网格、435,998 个三角面；来源信息、材质、边界和接地采样均通过工程验证。完整记录在 `../../docs/campus-model/build-validation.json` 和 `reports/`；建筑输入在 `../../docs/campus-model/buildings.json`。额外六格局部渲染的来源哈希与检查见 `detail-preview-validation.json`，主 BLEND、GLB 和原三张图没有改变。

2026-10-07 独立直接解码 GLB 的几何检查也已通过：113 个来源要素齐全，实际屋顶投影保持源轮廓，理学院内院、中心七个孔洞与四个上部部件的高度接口均正确。完整报告见 `../../docs/campus-model/model-geometry-qa.md` 和同名 JSON。

## 来源与署名

- 地形：Ho, Yufeng & Hengl, Tom (2026). Global Ensemble Digital Terrain Model 30m (GEDTM30), v1.2.0, OpenGeoHub, [doi:10.5281/zenodo.18887460](https://doi.org/10.5281/zenodo.18887460)，[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)。裁切与网格为修改后的派生物。
- 建筑轮廓与道路：© [OpenStreetMap contributors](https://www.openstreetmap.org/copyright)，ODbL 1.0；逐要素原始 URL 已保存在配置及模型属性中。
- 建筑身份与相对位置：[南科大官网校园地图](https://www.sustech.edu.cn/zh/contact_us.html)、[ICM 官方地图](https://icm.sustech.edu.cn/map/)。建筑高度/层数及照片的具体出处见 `../../docs/campus-model/building-reference-report.md`。
- 卫星核对：Esri World Imagery，Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community；影像拍摄时间未知。官方照片、示意地图和卫星影像用于参考，没有嵌入 GLB 作为纹理。

## 重新生成

在项目根目录使用已配置的 Python 3.12 运行时执行：

```powershell
& 'C:/Users/ander/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe' 'scripts/build-sustech-campus.py'
```

该命令读取已保存的 `docs/campus-model/buildings.json` 与原始校园 DTM，重新搭建工程并运行三阶段验证。生成输入的 `scripts/prepare-campus-buildings.py` 另需 `artifacts/campus-model/references/` 中已下载的源轮廓和项目内 Shapely；依赖清单见 `scripts/campus-requirements.txt`。本轮没有接入网站或搭建四地连续叙事世界。
