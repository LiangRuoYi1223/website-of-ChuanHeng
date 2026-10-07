# 南科大第二版校园模型

本版修复第一版视口深度精度与道路穿地问题，并对理学院、工学院、商学院、智华楼、一丹图书馆增加实体建筑构件。第一版文件保留，当前用户打开的工程没有被后台替换。

## 文件

- `sustech_campus_v2.blend`：用 Blender 打开的第二版可编辑工程，约 47.7 MB；请打开本文件，第一版 `output/campus-model/sustech_campus.blend` 不会自动更新。
- `sustech_campus_v2.glb`：约 65.5 MB，自包含，约 119 万三角形。为建筑质量核对版本，尚未做网站的分区加载和细节级别优化。
- `campus_aerial.png`、`campus_overview_labeled.png`、`gate_inward.png`：完整校园与校门预览。
- `landmark_details.png`：第二版五处主要地标及校门的局部预览，便于查看柱梁、玻璃进深、退台和高低体量。

初始视图聚焦校园，标签默认在普通视口隐藏。校园整体裁剪范围为 10–12000 米；进入特别近的窗框或室内视点时，在 N → 视图中减小近裁剪值。透视查看需要同时考虑场景尺度，避免重新设置成厘米近面与几十公里远面。标签仅在带标签的概览渲染中显示。

## 变化与验证

商学院使用两侧高翼楼、退台上部、低玻璃连桥及桥下支柱；智华楼改为高端块和较低长翼；理学院使用实体幕墙柱梁、大玻璃及顶层矮窗；工学院增加横向凹窗和坡屋顶边缘构件；一丹增加竖肋、错落凹窗与通高玻璃端。主要窗墙是有进深的几何，不再只是贴在实墙前的共面小窗片。

道路逐原 DTM 三角形切分并保持 0.15 米偏移。原地形和 113 个来源建筑/分部的顶层原始地理轮廓保留。保存重开、GLB 导出回导，以及独立道路交片检查均已通过；视口、实际几何和来源属性检查见 `../../docs/campus-model-v2/build-validation.json`、`../../docs/campus-model-v2/display-geometry-qa.json`。

更详细的原因和修订说明见 `../../docs/campus-model-v2/changes.md`。具体尺寸、窗格及部分高度分区仍按公开照片估算，普通建筑还比较简化，入口台阶、校园平台、完整景观和真实贴图尚待制作；本版不能称为完整校园精细复刻。约 30 米的全球预测 DTM 也不代表校园实测标高。

## 来源与重新生成

地形：Ho, Yufeng & Hengl, Tom (2026), GEDTM30 v1.2.0, OpenGeoHub, [doi:10.5281/zenodo.18887460](https://doi.org/10.5281/zenodo.18887460)，CC BY 4.0；网格为修改派生物。建筑/道路：© [OpenStreetMap contributors](https://www.openstreetmap.org/copyright)，ODbL 1.0。官方校园地图、建筑照片及卫星影像用于核对，未作为 GLB 纹理；逐建筑来源仍在输入及模型属性中。

输入由 `scripts/refine-campus-buildings.py` 生成，保留第一版输入。使用项目 Python 3.12 运行时，在项目根目录执行：

```powershell
& 'C:/Users/ander/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe' 'scripts/build-sustech-campus.py' --config docs/campus-model-v2/buildings.json --output-dir output/campus-model-v2 --docs-dir docs/campus-model-v2 --model-stem sustech_campus_v2
```

依赖使用项目内 `artifacts/mountain-prep/python-tools`，清单为 `scripts/campus-requirements.txt`。本轮没有接入网站。
