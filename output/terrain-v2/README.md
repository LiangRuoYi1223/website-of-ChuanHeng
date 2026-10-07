# 四区地形 v2

2026-10-05 按用户要求重新取得数据。南科大、塘朗山、五台山改用预测裸地 DTM；慕士塔格峰保留冰川表面高程。这里提供地形底座，南科大的理学院、工学院、商学院、智华楼、一丹图书馆等建筑仍需独立建模。

| 区域 | 数据 | 源分辨率 | OBJ 网格采样 | 米制高程范围 |
| --- | --- | --- | --- | --- |
| 南科大周边 | GEDTM30 v1.2 DTM | 约 30 m | 30 m | 10.54–351.00 m |
| 塘朗山 | GEDTM30 v1.2 DTM | 约 30 m | 30 m | −1.39–418.83 m |
| 五台山顺朝区域 | GEDTM30 v1.2 DTM | 约 30 m | 60 m | 1150.77–3060.38 m |
| 慕士塔格峰与西侧山脚 | Copernicus GLO-30 DSM | 约 30 m | 60 m | 3489.32–7484.00 m |

高度范围描述裁切后的 30 米栅格，不能当作测量级峰顶高度。60 米网格是从保留的 30 米栅格采样，未声称增加原始细节。裁切范围是制作范围，不是官方校园或景区边界。

## 文件

四个子目录分别为 `campus`、`tanglang`、`wutai`、`muztagh_ata`，各包含：

- 原生网格 WGS84 GeoTIFF、30 米 UTM GeoTIFF、Float32 NPY。
- 16 位高度图、带 UV 的 OBJ、来源及坐标元数据。
- 地形检查图和旧 DSM 减新地形的差值诊断图。差值不是实测树高或建筑高度。

校园与塘朗山使用 UTM 49N 和同一 XY 原点 `[807450, 2500665]`，5,856 个重叠像元精确相同；五台山为 UTM 49N，慕士塔格峰为 UTM 43N。OBJ 的 X 为东、Y 为北、Z 为上，单位米，Z 保留 EGM2008 绝对高程，垂直夸张为 1。两城市网格重叠部分在组装时应裁去一份，避免重叠面。

Blender 工程和 GLB 位于 [blender-terrain-v2](../blender-terrain-v2/README.md)。

## 来源及单位核对

- [GEDTM30 官方发布](https://zenodo.org/records/18887460)：机器学习预测裸地高程，CC BY 4.0。直接从外部 30 米 COG 按区域读取，未使用 Zenodo 附件中的 240 米版本，未整包下载全球文件。它不是校园实测 DTM，残留树冠、建筑偏差和局部地形误差仍可能存在。
- GEDTM30 的当前 30 米 TIFF 中 `scale=0.1` 与 [官方精确文件元数据](https://codeberg.org/openlandmap/GEDTM30/raw/branch/main/metadata/cog_list.csv) 的 `scale=1, Float32, meter` 不一致。塘朗山约 421.6 米、五台山北台约 3058.9 米的原始值与 Copernicus 同点高度接近。因此原始文件及该标记保留，派生文件按数值已经是米处理，明确设 scale 1；证据写入下载清单和每区元数据。
- [Copernicus GLO-30 官方公共数据](https://registry.opendata.aws/copernicus-dem/)：重新下载慕士塔格峰两张原始瓦片并读取全部栅格块。保留观测时期的冰川／积雪表面，不推算冰下基岩或当前冰川厚度。后期雪面材质和局部细节可独立添加。

完整署名见 [ATTRIBUTION.txt](ATTRIBUTION.txt)。局部负高程保留为源模型值；需要进入镜头的低地再核查，不对整幅地形自动拉平。

## 执行记录

- [下载清单](../../docs/mountain-preparation/terrain-v2-download-manifest.json)
- [处理与像元、UV、面朝向检查](../../docs/mountain-preparation/terrain-v2-processing-manifest.json)
- [Blender 运行验证](../../docs/mountain-preparation/terrain-v2-blender-validation.json)
- [旧版本删除记录](../../docs/mountain-preparation/terrain-v2-replacement-manifest.json)

原始数据位于 `artifacts/mountain-prep/terrain-v2/raw/`。对应脚本为 `scripts/download-terrain-v2.py`、`scripts/prepare-terrain-v2.py`、`scripts/verify-blender-v2.py`。
