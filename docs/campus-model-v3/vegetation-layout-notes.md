# 校园参考约束植被分布

2026-10-07生成700个近似树位，固定seed20261007。原生Esri卫星参考1792×2048，按已记录EPSG:3857范围转换为EPSG:32649与原模型共同原点；使用绿色主导、9×9邻域密度及亮度纹理分类。只在学校官方校界及25米环境缓冲内采样，树位聚集于实际绿化区域，不在完整DTM范围均匀散布。

树干中心排除113个建筑/分部足迹外扩2.5米、道路与步道现有宽度的一半再加1米、水系现有宽度/水面；冠幅另与建筑轮廓保持1.2米额外距离。约5.8米最小干距避免重叠森林墙。由于照片含阴影、修剪草坪、旧建设状态，绿像素不是逐棵树识别；点位、物种、冠幅2.1–4.9米及树高7–16米均为可编辑制作估算。

每棵树保留原图像素坐标、RGB、excess-green、局部绿密度、纹理值和WGS84，经纬度只用于溯源。模型树位采用本地米制XY；Z用原DTM两组三角面插值而非双线性插值，保持接地。原DTM文件SHA256仍为 `5a268aaad2d5649a59f36260b7321ff07b76d747859c0cc06ad6ab5e0582cf4b`，脚本没有改地形。

- 输入/输出脚本：`scripts/prepare-campus-vegetation-v3.py`。
- 建模输入：`docs/campus-model-v3/vegetation-layout.json`。
- 分布核对图：`artifacts/campus-model-v3/vegetation-reference-overlay.png`，已实际查看。
- 分类核对图：`artifacts/campus-model-v3/vegetation-green-mask.png`。

图像只用于参考和内部核对，未作为模型纹理；本轮生成的是独立树位数据和程序植被。影像拍摄日期未知。公共参考版权为“Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community”；足迹/道路 © OpenStreetMap contributors (ODbL 1.0)。
