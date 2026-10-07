"""Render v2 detail views without saving the user's v1/v2 Blender scenes."""
from pathlib import Path
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[1]
src=(ROOT/'artifacts/campus-model/render-landmark-details.py').read_text(encoding='utf-8')
for before,after in [
    ('output/campus-model','output/campus-model-v2'),
    ('artifacts/campus-model','artifacts/campus-model-v2'),
    ('sustech_campus.blend','sustech_campus_v2.blend'),
    ('sustech_campus.glb','sustech_campus_v2.glb'),
    ('(.65, -.95, 1.65)','(.65, -.95, .95)'),
    ('(.65, -.95, 1.6)','(.65, -.95, 1.1)'),
    ('(.65, -.95, 1.5), 1.22','(.9, .8, .80), 1.22'),
    ('(.65, -.95, 1.5), 1.2','(.8, .8, .90), 1.2'),
    ('(-.65, -.95, 1.45)','(-.65, .95, .85)'),
    ("'ORTHO', .1, 20000","'ORTHO', 2, 3000"),
    ('重点建筑局部预览','重点建筑第二版 · 实体立面与高低体量'),
    ('第一版体量模型 / 部分高度、屋顶与立面按公开照片估算 / 真实轮廓与院落保留',
     '第二版 / 实体柱梁、凹窗、幕墙、退台与低连桥 / 具体尺寸与部分分区仍按照片估算'),
    ('Existing first version massing','Second version photo-derived architectural refinement'),
]:
    src=src.replace(before,after)
dest=ROOT/'artifacts/campus-model-v2/render-landmark-details.py'
dest.parent.mkdir(parents=True,exist_ok=True)
dest.write_text(src,encoding='utf-8')
if '--prepare-only' not in sys.argv:
    subprocess.run([sys.executable,str(dest)],cwd=ROOT,check=True)
else:
    print(dest)
