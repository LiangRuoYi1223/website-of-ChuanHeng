# 四区 Blender 地形工程 v2

对应 [地形来源与处理说明](../terrain-v2/README.md)。四份工程提供可编辑地形网格、简单灰色材质、用于检查的相机和灯光；尚未组成连续叙事场景，也没有校园建筑、正式岩雪材质或滚动镜头。

2026-10-05 已在 Blender 5.2.2 LTS 完成全部 12 个运行验证阶段，均通过。

| 区域 | 可编辑 Blender 工程 | GLB | 静帧 |
| --- | --- | --- | --- |
| 南科大周边裸地 | [campus_validation.blend](campus_validation.blend) | [GLB](campus_validation.glb) | [预览](campus_preview.png) |
| 塘朗山裸地 | [tanglang_validation.blend](tanglang_validation.blend) | [GLB](tanglang_validation.glb) | [预览](tanglang_preview.png) |
| 五台山裸地 | [wutai_validation.blend](wutai_validation.blend) | [GLB](wutai_validation.glb) | [预览](wutai_preview.png) |
| 慕士塔格峰冰川表面 | [muztagh_ata_validation.blend](muztagh_ata_validation.blend) | [GLB](muztagh_ata_validation.glb) | [预览](muztagh_ata_preview.png) |

每区采用三个独立后台 Blender 进程：OBJ 导入与工程保存、重开与 GLB 导出／渲染、GLB 回导。验证逐顶点坐标、三角面数量、逐面 UV、朝上法向、简单 PBR 材质和各自的数据来源署名。运行记录见 [terrain-v2-blender-validation.json](../../docs/mountain-preparation/terrain-v2-blender-validation.json)，阶段报告位于 `reports/`。

坐标单位为米，地形没有垂直夸张。导出采用 glTF 规范的 Y-up 坐标，由导出器转换；来源的 UTM 原点、EGM2008 高程和许可写入工程对象属性及 GLB extras。网格是开放地形面。
