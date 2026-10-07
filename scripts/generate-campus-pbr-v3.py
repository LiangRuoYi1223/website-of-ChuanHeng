"""Deterministic, periodic campus material maps; no reference photo pixels.

The maps contain understated small surface variation. Architectural panel joints
remain explicit model geometry, rather than coarse dark lines in these maps.
Base colour PNGs use sRGB, roughness/normal PNGs use Non-Color in Blender.
"""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "artifacts/mountain-prep/python-tools"))
import numpy as np
from PIL import Image

OUT = ROOT / "output/campus-model-v3/textures"
SIZE = 1024
MATERIALS = {
    "stone": {"rgb": [188, 184, 172], "roughness": .78, "tile_m": 2., "amplitude": 4.0, "height_m": .0012},
    "cladding": {"rgb": [180, 77, 43], "roughness": .61, "tile_m": 2., "amplitude": 2.7, "height_m": .00045},
    "paint": {"rgb": [214, 214, 205], "roughness": .67, "tile_m": 2., "amplitude": 1.8, "height_m": .00025},
    "roof": {"rgb": [70, 78, 79], "roughness": .72, "tile_m": 3., "amplitude": 3.0, "height_m": .0006},
    "paving": {"rgb": [163, 164, 151], "roughness": .86, "tile_m": 2., "amplitude": 5.5, "height_m": .0015},
    "bark": {"rgb": [93, 86, 70], "roughness": .91, "tile_m": 1., "amplitude": 7.0, "height_m": .0028},
    "foliage": {"rgb": [74, 98, 58], "roughness": .79, "tile_m": 1., "amplitude": 7.5, "height_m": .0003},
    "ground": {"rgb": [101, 112, 78], "roughness": .94, "tile_m": 6., "amplitude": 7.0, "height_m": .0018},
}


def smooth_periodic(rng, sx, sy=None):
    sy = sx if sy is None else sy
    fy = np.fft.fftfreq(SIZE)[:, None]
    fx = np.fft.fftfreq(SIZE)[None, :]
    weight = np.exp(-2 * np.pi ** 2 * ((sx * fx) ** 2 + (sy * fy) ** 2))
    noise = np.fft.ifft2(np.fft.fft2(rng.standard_normal((SIZE, SIZE))) * weight).real
    noise = (noise - noise.mean()) / max(float(noise.std()), 1e-8)
    return np.clip(noise, -3., 3.) / 3.


def write_image(path, value, mode=None):
    pixels = np.uint8(np.clip(np.rint(value), 0, 255))
    Image.fromarray(pixels, mode=mode).save(path, optimize=True)
    return {"path": path.relative_to(ROOT).as_posix(), "bytes": path.stat().st_size,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "resolution_px": [SIZE, SIZE]}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = {"schema_version": 1, "generator": "scripts/generate-campus-pbr-v3.py", "resolution_px": [SIZE, SIZE],
                "license": "Original deterministic procedural material maps generated for this project; no photo pixels used",
                "normal_convention": "+X right, +Y up tangent-space OpenGL; use Non-Color and Normal Map node",
                "basecolor_colorspace": "sRGB", "roughness_colorspace": "Non-Color", "material_categories": {}}
    for name, spec in MATERIALS.items():
        seed = int.from_bytes(hashlib.sha256(("campus-v3:" + name).encode()).digest()[:8], "little")
        rng = np.random.default_rng(seed)
        fine = smooth_periodic(rng, 1.3)
        grain = smooth_periodic(rng, 5.5)
        broad = smooth_periodic(rng, 35.)
        height_noise = .56 * fine + .31 * grain + .13 * broad
        colour_noise = .22 * fine + .38 * grain + .40 * broad
        if name == "bark":
            striation = smooth_periodic(rng, 3., 80.)
            height_noise = .65 * striation + .20 * grain + .15 * fine
            colour_noise = .7 * striation + .3 * broad
        elif name == "stone":
            vertical_grain = smooth_periodic(rng, 4., 24.)
            colour_noise = .35 * vertical_grain + .65 * colour_noise
            height_noise = .25 * vertical_grain + .75 * height_noise
        elif name == "foliage":
            soft_patches = smooth_periodic(rng, 18.)
            colour_noise = .7 * soft_patches + .3 * grain
            height_noise = .75 * grain + .25 * fine
        colour = np.asarray(spec["rgb"], dtype=float)[None, None, :] + colour_noise[:, :, None] * spec["amplitude"]
        # Tiny hue variation avoids one flat swatch while preserving site palette.
        colour += broad[:, :, None] * np.asarray([.7, .4, -.3])[None, None, :]
        roughness = (spec["roughness"] + .025 * colour_noise + .012 * fine) * 255.
        height = height_noise * spec["height_m"]
        step = spec["tile_m"] / SIZE
        dx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) / (2 * step)
        dy = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) / (2 * step)
        vectors = np.stack((-dx, dy, np.ones_like(dx)), axis=2)
        vectors /= np.linalg.norm(vectors, axis=2)[:, :, None]
        normal = (vectors * .5 + .5) * 255.
        maps = {"basecolor": write_image(OUT / (name + "_basecolor.png"), colour),
                "normal": write_image(OUT / (name + "_normal.png"), normal),
                "roughness": write_image(OUT / (name + "_roughness.png"), roughness)}
        item = {**spec, "seed": seed, "maps": maps, "tileable": True,
                "tile_size_m": [spec["tile_m"], spec["tile_m"]], "metallic": 0.,
                "basecolor": maps["basecolor"]["path"], "normal": maps["normal"]["path"],
                "roughness_map": maps["roughness"]["path"],
                "height_detail_is_estimated": True, "joints_baked_into_maps": False}
        manifest["material_categories"][name] = item
        print(f"Generated {name}: {spec['tile_m']} m periodic tile; 3 maps", flush=True)
    (OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("Material pack: " + str(OUT / "manifest.json"), flush=True)


if __name__ == "__main__":
    main()
