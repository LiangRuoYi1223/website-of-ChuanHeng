"""Prepare four region terrains from a verified v2 download manifest.

The city regions share one projected master grid. All processing preserves the
documented orthometric heights; no glacier thickness or surveyed DTM is inferred.
This script never downloads data or invokes Blender.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import math
import os
import sys
from contextlib import ExitStack
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "artifacts/mountain-prep/python-tools"))
os.environ.setdefault("MPLCONFIGDIR", str(ROOT / "artifacts/mountain-prep/matplotlib-cache"))

import numpy as np
import rasterio
from rasterio.io import MemoryFile
from rasterio.merge import merge
from rasterio.transform import from_origin, array_bounds
from rasterio.warp import reproject, transform_bounds, Resampling
from rasterio.windows import Window, from_bounds, transform as window_transform
from pyproj import CRS, Transformer
from PIL import Image
import matplotlib
matplotlib.use("Agg")
from matplotlib import pyplot as plt
from matplotlib.colors import LightSource
from matplotlib.font_manager import FontProperties

OUT = ROOT / "output/terrain-v2"
DOCS = ROOT / "docs/mountain-preparation"
NODATA = -9999.0
FONT_PATH = Path("C:/Windows/Fonts/msyh.ttc")
FONT = FontProperties(fname=str(FONT_PATH)) if FONT_PATH.is_file() else FontProperties()


def relative(path):
    return Path(path).resolve().relative_to(ROOT).as_posix()


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def record(path):
    return {"path": relative(path), "bytes": Path(path).stat().st_size, "sha256": sha256(path)}


def write_json(path, data):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def stats(a):
    valid = np.isfinite(a) & (a != NODATA)
    values = a[valid]
    if not values.size:
        raise ValueError("No valid elevation samples")
    return {"shape_rows_columns": list(a.shape), "valid_samples": int(valid.sum()),
            "invalid_samples": int((~valid).sum()), "min_m": float(values.min()),
            "max_m": float(values.max()), "mean_m": float(values.mean()),
            "percentiles_m": {str(p): float(np.percentile(values, p)) for p in [1, 5, 50, 95, 99]}}


def require_complete(a, label):
    s = stats(a)
    if s["invalid_samples"]:
        raise ValueError(f"{label}: {s['invalid_samples']} unresolved nodata/nonfinite samples")
    if s["min_m"] < -500 or s["max_m"] > 9000:
        raise ValueError(f"{label}: elevation outside plausible global land range")
    return s


def effective_scaling(src, entry):
    # The verified effective scale can correct an incorrectly tagged COG band.
    # Metadata, manifest and effective scales are never multiplied together.
    scale = float(entry.get("effective_scale", entry.get("scale", src.scales[0])))
    offset = float(entry.get("effective_offset", entry.get("offset", src.offsets[0])))
    if not np.isfinite(scale) or not np.isfinite(offset) or scale == 0:
        raise ValueError(f"Invalid scale/offset: {entry['id']}")
    return scale, offset


def scaled_read(src, entry, window=None):
    raw = src.read(1, window=window, masked=True)
    scale, offset = effective_scaling(src, entry)
    values = np.asarray(raw.data, dtype=np.float64) * scale + offset
    invalid = np.ma.getmaskarray(raw) | ~np.isfinite(values)
    values[invalid] = NODATA
    return values.astype(np.float32)


def source_path(entry):
    return ROOT / entry["local_path"]


def validate_sources(entries):
    reports = []
    for entry in entries:
        path = source_path(entry)
        digest = sha256(path)
        if digest != entry["sha256"]:
            raise ValueError(f"Source SHA256 mismatch: {entry['id']}")
        with rasterio.open(path) as src:
            if src.count != 1 or not src.crs:
                raise ValueError(f"Expected a one-band georeferenced raster: {entry['id']}")
            if entry.get("crs") and src.crs != rasterio.crs.CRS.from_user_input(entry["crs"]):
                raise ValueError(f"Source CRS differs from download manifest: {entry['id']}")
            if src.crs.to_epsg() != 4326 or src.transform.b or src.transform.d or src.transform.a <= 0 or src.transform.e >= 0:
                raise ValueError("Native mosaicking expects north-up WGS84 source grids")
            scale, offset = effective_scaling(src, entry)
            count = invalid = blocks = 0
            low, high, total = math.inf, -math.inf, 0.0
            # Stream all local source blocks rather than allocating a world raster.
            for _, window in src.block_windows(1):
                values = scaled_read(src, entry, window)
                valid = np.isfinite(values) & (values != NODATA)
                samples = values[valid]
                count += samples.size
                invalid += int((~valid).sum())
                blocks += 1
                if samples.size:
                    low, high = min(low, float(samples.min())), max(high, float(samples.max()))
                    total += float(samples.astype(np.float64).sum())
            if not count or low < -500 or high > 9000:
                raise ValueError(f"Invalid scaled source elevations: {entry['id']}")
            reports.append({"id": entry["id"], **record(path), "product": entry["product"],
                "all_local_raster_blocks_decoded": True, "blocks_decoded": blocks,
                "crs": str(src.crs), "bounds": list(src.bounds), "transform": list(src.transform),
                "shape_rows_columns": [src.height, src.width], "dtype": src.dtypes[0],
                "nodata": src.nodata, "mask_flags": [str(flag) for flag in src.mask_flag_enums[0]],
                "intrinsic_scale": src.scales[0], "intrinsic_offset": src.offsets[0],
                "applied_scale": scale, "applied_offset": offset, "tags": src.tags(),
                "scale_interpretation": entry.get("scale_interpretation", "native documented scale/offset"),
                "valid_samples": count, "invalid_samples_outside_or_inside_requested_AOI": invalid,
                "min_m": low, "max_m": high, "mean_m": total / count,
                "vertical_datum": entry["vertical_datum"], "attribution": entry["attribution"],
                "license_url": entry["license_url"]})
        print(f"Validated source: {entry['id']} ({blocks} blocks; scale={scale}; offset={offset})", flush=True)
    return reports


def snap_native(bounds, transform):
    rx, ry = transform.a, -transform.e
    return [transform.c + math.floor((bounds[0] - transform.c) / rx + 1e-9) * rx,
            transform.f + math.floor((bounds[1] - transform.f) / ry + 1e-9) * ry,
            transform.c + math.ceil((bounds[2] - transform.c) / rx - 1e-9) * rx,
            transform.f + math.ceil((bounds[3] - transform.f) / ry - 1e-9) * ry]


def enclosing_window(bounds, transform, shape=None):
    w = from_bounds(*bounds, transform=transform)
    left, top = math.floor(w.col_off + 1e-7), math.floor(w.row_off + 1e-7)
    right = math.ceil(w.col_off + w.width - 1e-7)
    bottom = math.ceil(w.row_off + w.height - 1e-7)
    if shape:
        top, left = max(0, top), max(0, left)
        bottom, right = min(shape[0], bottom), min(shape[1], right)
    if bottom <= top or right <= left:
        raise ValueError("Empty raster window")
    return Window(left, top, right - left, bottom - top)


def crop_native(a, transform, bounds):
    window = enclosing_window(bounds, transform)
    r, c, h, w = map(int, [window.row_off, window.col_off, window.height, window.width])
    if r < 0 or c < 0 or r + h > a.shape[0] or c + w > a.shape[1]:
        raise ValueError("Native mosaic does not cover requested crop")
    return a[r:r+h, c:c+w].copy(), window_transform(window, transform)


def native_mosaic(bounds, entries, padding):
    padded = [bounds[0]-padding, bounds[1]-padding, bounds[2]+padding, bounds[3]+padding]
    with ExitStack() as stack:
        originals = [stack.enter_context(rasterio.open(source_path(e))) for e in entries]
        anchor = originals[0].transform
        aligned = snap_native(padded, anchor)
        rx, ry = originals[0].res
        memory_sources = []
        geometry = []
        for src, entry in zip(originals, entries):
            if not np.allclose(src.res, (rx, ry), rtol=0, atol=1e-12):
                raise ValueError("Native tile resolutions differ")
            phase_x, phase_y = (src.transform.c-anchor.c)/rx, (src.transform.f-anchor.f)/ry
            if abs(phase_x-round(phase_x)) > 1e-6 or abs(phase_y-round(phase_y)) > 1e-6:
                raise ValueError("Native tile pixel centres are not aligned")
            intersection = [max(aligned[0], src.bounds.left), max(aligned[1], src.bounds.bottom),
                            min(aligned[2], src.bounds.right), min(aligned[3], src.bounds.top)]
            if intersection[2] <= intersection[0] or intersection[3] <= intersection[1]:
                continue
            window = enclosing_window(intersection, src.transform, (src.height, src.width))
            values = scaled_read(src, entry, window)
            memory = stack.enter_context(MemoryFile())
            target = stack.enter_context(memory.open(driver="GTiff", count=1, dtype="float32",
                height=values.shape[0], width=values.shape[1], crs=src.crs,
                transform=window_transform(window, src.transform), nodata=NODATA))
            target.write(values, 1)
            memory_sources.append(target)
            geometry.append({"source_id": entry["id"], "bounds": list(src.bounds),
                             "pixel_origin_phase_relative_to_anchor": [phase_x, phase_y]})
        if not memory_sources:
            raise ValueError("No source intersects requested AOI")
        expanded, transform = merge(memory_sources, bounds=aligned, res=(rx, ry),
                                     nodata=NODATA, dtype="float32", method="first")
        a = expanded[0]
    return a, transform, geometry


def native_checks(a, transform, entries):
    checked = 0
    with ExitStack() as stack:
        sources = [(stack.enter_context(rasterio.open(source_path(e))), e) for e in entries]
        for row in np.linspace(0, a.shape[0]-1, 15, dtype=int):
            for col in np.linspace(0, a.shape[1]-1, 15, dtype=int):
                lon, lat = transform * (col+.5, row+.5)
                source, entry = next((s, e) for s, e in sources if
                    s.bounds.left <= lon < s.bounds.right and s.bounds.bottom <= lat < s.bounds.top)
                value = next(source.sample([(lon, lat)], masked=True))[0]
                if np.ma.is_masked(value):
                    raise ValueError("Native check hits a masked source cell")
                scale, offset = effective_scaling(source, entry)
                expected = np.float32(float(value)*scale + offset)
                if not np.isclose(expected, a[row, col], rtol=0, atol=1e-5):
                    raise ValueError("Native crop shifted or source scale/offset applied incorrectly")
                checked += 1
    return {"source_cells_checked": checked, "all_equal_to_scaled_original_source_cells": True,
            "all_equal_to_original_source_cells": True, "comparison_units": "scaled metres"}


def seam_checks(a, transform, entries):
    results = []
    with ExitStack() as stack:
        sources = [stack.enter_context(rasterio.open(source_path(e))) for e in entries]
        for i, first in enumerate(sources):
            for second in sources[i+1:]:
                if abs(first.bounds.right-second.bounds.left) < 1e-9 or abs(second.bounds.right-first.bounds.left) < 1e-9:
                    left, right = sorted((first, second), key=lambda src: src.bounds.left)
                    col = int(round((left.bounds.right-transform.c)/transform.a))
                    if 0 < col < a.shape[1]:
                        values = np.abs(a[:, col]-a[:, col-1])
                        valid = (a[:, col] != NODATA) & (a[:, col-1] != NODATA) & np.isfinite(values)
                        values = values[valid]
                        results.append({"orientation": "east-west", "join_longitude": left.bounds.right,
                            "grid_gap_degrees": right.bounds.left-left.bounds.right,
                            "valid_neighbor_pairs": int(values.size),
                            "median_neighbor_height_difference_m": float(np.median(values)) if values.size else None,
                            "p95_neighbor_height_difference_m": float(np.percentile(values, 95)) if values.size else None})
                elif abs(first.bounds.top-second.bounds.bottom) < 1e-9 or abs(second.bounds.top-first.bounds.bottom) < 1e-9:
                    south, north = sorted((first, second), key=lambda src: src.bounds.bottom)
                    row = int(round((south.bounds.top-transform.f)/transform.e))
                    if 0 < row < a.shape[0]:
                        values = np.abs(a[row]-a[row-1])
                        valid = (a[row] != NODATA) & (a[row-1] != NODATA) & np.isfinite(values)
                        values = values[valid]
                        results.append({"orientation": "north-south", "join_latitude": south.bounds.top,
                            "grid_gap_degrees": north.bounds.bottom-south.bounds.top,
                            "valid_neighbor_pairs": int(values.size),
                            "median_neighbor_height_difference_m": float(np.median(values)) if values.size else None,
                            "p95_neighbor_height_difference_m": float(np.percentile(values, 95)) if values.size else None})
    return results


def projected_bounds(bounds, crs, resolution):
    b = transform_bounds("EPSG:4326", crs, *bounds, densify_pts=41)
    return [math.floor(b[0]/resolution)*resolution, math.floor(b[1]/resolution)*resolution,
            math.ceil(b[2]/resolution)*resolution, math.ceil(b[3]/resolution)*resolution]


def build_grid(spec, entries, resolution, padding):
    native, transform, geometry = native_mosaic(spec["bounds_wgs84"], entries, padding)
    core, core_transform = crop_native(native, transform, spec["bounds_wgs84"])
    require_complete(core, "Native AOI")
    west, south, east, north = projected_bounds(spec["bounds_wgs84"], spec["projected_crs"], resolution)
    width, height = round((east-west)/resolution), round((north-south)/resolution)
    dst_transform = from_origin(west, north, resolution, resolution)
    projected = np.full((height, width), NODATA, dtype=np.float32)
    reproject(native, projected, src_transform=transform, src_crs="EPSG:4326", src_nodata=NODATA,
        dst_transform=dst_transform, dst_crs=spec["projected_crs"], dst_nodata=NODATA,
        resampling=Resampling.bilinear, num_threads=2)
    require_complete(projected, "Projected AOI")
    return {"native": native, "native_transform": transform, "projected": projected,
            "transform": dst_transform, "bounds": [west, south, east, north],
            "origin_xy": [(west+east)/2, (south+north)/2], "geometry": geometry,
            "entries": entries, "projected_crs": spec["projected_crs"]}


def attribution_for(entries):
    return "\n".join(dict.fromkeys(e["attribution"] for e in entries))


def write_tif(path, a, transform, crs, attribution, vertical_datum, processing, point="Area"):
    with rasterio.open(path, "w", driver="GTiff", height=a.shape[0], width=a.shape[1],
        count=1, dtype="float32", crs=crs, transform=transform, nodata=NODATA,
        tiled=True, blockxsize=256, blockysize=256, compress="deflate", predictor=3) as dst:
        dst.write(a.astype(np.float32), 1)
        dst.scales = (1.0,)
        dst.offsets = (0.0,)
        dst.update_tags(AREA_OR_POINT=point, VERTICAL_DATUM=vertical_datum,
            VERTICAL_UNITS="metres", ATTRIBUTION=attribution, PROCESSING=processing)
    with rasterio.open(path) as src:
        if src.crs != rasterio.crs.CRS.from_user_input(crs) or src.transform != transform or src.nodata != NODATA:
            raise ValueError("GeoTIFF spatial metadata roundtrip mismatch")
        if src.scales != (1.0,) or src.offsets != (0.0,):
            raise ValueError("Derived GeoTIFF must contain metre values at scale 1, offset 0")
        if not np.array_equal(src.read(1), a.astype(np.float32)):
            raise ValueError("GeoTIFF pixels changed during serialization")


def write_obj(path, a, transform, step_m, origin_xy, attribution):
    stride_float = step_m/transform.a
    if stride_float < 1 or abs(stride_float-round(stride_float)) > 1e-9:
        raise ValueError("Mesh sampling must be a positive integer multiple of raster spacing")
    stride = round(stride_float)
    rows = np.unique(np.append(np.arange(0, a.shape[0], stride), a.shape[0]-1))
    cols = np.unique(np.append(np.arange(0, a.shape[1], stride), a.shape[1]-1))
    if len(rows) < 2 or len(cols) < 2:
        raise ValueError("Mesh requires two rows and columns")
    origin_x, origin_y = origin_xy
    x = transform.c+(cols+.5)*transform.a-origin_x
    y = transform.f+(rows+.5)*transform.e-origin_y
    elevations = a[np.ix_(rows, cols)].ravel()
    with path.open("w", encoding="utf-8", newline="\n") as stream:
        for line in attribution.splitlines():
            stream.write(f"# {line}\n")
        stream.write(f"# Units metres; X east, Y north, Z EGM2008; vertical exaggeration 1.\n")
        stream.write(f"# Projected XY origin: {origin_x:.3f} {origin_y:.3f}; vertical origin: 0.\n")
        stream.write(f"# Open terrain surface, not watertight. Sampling {step_m} m.\no {path.stem}\n")
        for row, yy in zip(rows, y):
            for col, xx in zip(cols, x):
                stream.write(f"v {xx:.3f} {yy:.3f} {a[row, col]:.3f}\n")
        for row in rows:
            for col in cols:
                stream.write(f"vt {(col+.5)/a.shape[1]:.8f} {1-(row+.5)/a.shape[0]:.8f}\n")
        for row in range(len(rows)-1):
            for col in range(len(cols)-1):
                nw = row*len(cols)+col+1
                ne, sw, se = nw+1, nw+len(cols), nw+len(cols)+1
                stream.write(f"f {nw}/{nw} {sw}/{sw} {ne}/{ne}\nf {ne}/{ne} {sw}/{sw} {se}/{se}\n")
    vertices, uvs, faces, face_uvs = [], [], [], []
    with path.open(encoding="utf-8") as stream:
        for line in stream:
            fields = line.split()
            if fields and fields[0] == "v":
                vertices.append([float(v) for v in fields[1:]])
            elif fields and fields[0] == "vt":
                uvs.append([float(v) for v in fields[1:]])
            elif fields and fields[0] == "f":
                faces.append([int(v.split("/")[0])-1 for v in fields[1:]])
                face_uvs.append([int(v.split("/")[1])-1 for v in fields[1:]])
    vertices, faces, uvs, face_uvs = map(np.asarray, (vertices, faces, uvs, face_uvs))
    expected_faces = 2*(len(rows)-1)*(len(cols)-1)
    if len(vertices) != len(rows)*len(cols) or len(faces) != expected_faces or len(uvs) != len(vertices):
        raise ValueError("OBJ topology count mismatch")
    if faces.min() < 0 or faces.max() >= len(vertices) or not np.array_equal(faces, face_uvs):
        raise ValueError("OBJ face/UV index mismatch")
    expected_uvs = np.column_stack([np.tile((cols+.5)/a.shape[1], len(rows)),
                                  np.repeat(1-(rows+.5)/a.shape[0], len(cols))])
    uv_error = float(np.max(np.abs(uvs-expected_uvs)))
    if uv_error > 6e-9:
        raise ValueError("OBJ UVs are not raster pixel centres")
    normals = np.cross(vertices[faces[:, 1]]-vertices[faces[:, 0]], vertices[faces[:, 2]]-vertices[faces[:, 0]])
    if not np.isfinite(vertices).all() or np.any(normals[:, 2] <= 0):
        raise ValueError("OBJ contains nonfinite, inverted or degenerate geometry")
    height_error = float(np.max(np.abs(vertices[:, 2]-elevations)))
    expected_xy = np.column_stack([np.tile(x, len(rows)), np.repeat(y, len(cols))])
    xy_error = float(np.max(np.abs(vertices[:, :2]-expected_xy)))
    if height_error > .0006 or xy_error > .0006:
        raise ValueError("OBJ coordinate serialization error")
    return {"path": relative(path), "vertices": len(vertices), "triangles": len(faces),
        "uv_coordinates": len(uvs), "uv_mapping": "original raster pixel centres",
        "uv_heightmap_alignment_verified": True, "sampling_m": step_m, "open_surface": True,
        "axis_convention": {"X": "east", "Y": "north", "Z": "up"},
        "projected_xy_origin_m": list(origin_xy), "vertical_origin_m": 0, "units": "metres",
        "grid_rows_columns": [len(rows), len(cols)], "sampled_elevation_min_m": float(elevations.min()),
        "sampled_elevation_max_m": float(elevations.max()), "max_serialization_height_error_m": height_error,
        "max_serialization_xy_error_m": xy_error, "max_uv_error": uv_error,
        "topology_verified": True, "all_triangle_normals_positive_z": True}


def reference_checks(region, a, transform, origin_xy):
    forward = Transformer.from_crs("EPSG:4326", region["projected_crs"], always_xy=True)
    controls = []
    for point in region.get("reference_points", []):
        x, y = forward.transform(point["lon"], point["lat"])
        col, row = math.floor((x-transform.c)/transform.a), math.floor((y-transform.f)/transform.e)
        if not (0 <= row < a.shape[0] and 0 <= col < a.shape[1]):
            raise ValueError(f"Reference point outside region: {point['name']}")
        item = {**point, "projected_x_m": x, "projected_y_m": y, "within_crop": True,
                "nearest_raster_elevation_m": float(a[row, col]),
                "local_mesh_xyz_m": [x-origin_xy[0], y-origin_xy[1], float(a[row, col])]}
        if point.get("peak_window_radius_m"):
            radius_m = point["peak_window_radius_m"]
            cells = math.ceil(radius_m/transform.a)
            r0, r1 = max(0, row-cells), min(a.shape[0], row+cells+1)
            c0, c1 = max(0, col-cells), min(a.shape[1], col+cells+1)
            xx = transform.c+(np.arange(c0, c1)+.5)*transform.a
            yy = transform.f+(np.arange(r0, r1)+.5)*transform.e
            mask = (xx[None, :]-x)**2+(yy[:, None]-y)**2 <= radius_m**2
            item["nearby_peak_max_m"] = float(a[r0:r1, c0:c1][mask].max())
            item["nearby_peak_search_shape"] = "projected circle, raster pixel centres"
        controls.append(item)
    return controls


def map_plot(ax, a, transform, region, controls):
    dx, dy = transform.a, abs(transform.e)
    extent = [0, a.shape[1]*dx/1000, 0, a.shape[0]*dy/1000]
    shaded = LightSource(azdeg=315, altdeg=45).shade(a, cmap=plt.get_cmap("terrain"),
        vert_exag=1, dx=dx, dy=dy, blend_mode="soft")
    ax.imshow(shaded, extent=extent, origin="upper", interpolation="nearest")
    interval = 50 if region["id"] in ("campus", "tanglang") else 250
    levels = np.arange(math.ceil(float(a.min())/interval)*interval, float(a.max()), interval)
    if levels.size:
        xx = (np.arange(a.shape[1])+.5)*dx/1000
        yy = (a.shape[0]-np.arange(a.shape[0])-.5)*dy/1000
        ax.contour(xx, yy, a, levels=levels, colors="black", linewidths=.35, alpha=.35)
    for point in controls:
        px = (point["projected_x_m"]-transform.c)/1000
        py = (point["projected_y_m"]-(transform.f+a.shape[0]*transform.e))/1000
        ax.plot(px, py, "o", color="white", markeredgecolor="black", markersize=4)
        ax.annotate(point["name"].split("（")[0], (px, py), xytext=(4, 4), textcoords="offset points",
            fontproperties=FONT, fontsize=8, bbox={"facecolor": "white", "alpha": .7, "edgecolor": "none"})
    ax.set_title(region["name"], fontproperties=FONT, fontsize=14)
    ax.set_xlabel("East / km")
    ax.set_ylabel("North / km")
    ax.set_aspect("equal")
    ax.text(.97, .97, "N ↑", transform=ax.transAxes, ha="right", va="top", fontsize=11,
            bbox={"facecolor": "white", "alpha": .8, "edgecolor": "none"})


def diagnostic_old_dsm(region, a, transform, directory, attribution, vertical_datum):
    old_id = "campus_tanglang" if region["id"] in ("campus", "tanglang") else region["id"]
    old = ROOT / "output/terrain" / old_id / f"{old_id}_dsm_utm30m.tif"
    result = {"meaning": "old DSM minus new terrain; diagnostic only, not measured canopy/building height",
              "status": "unavailable", "outputs": [], "differences_do_not_gate_processing": True}
    if not old.is_file():
        result["reason"] = "Old DSM unavailable; no terrain validation skipped"
        return result
    with rasterio.open(old) as src:
        old_a = src.read(1, masked=True)
        source = np.asarray(old_a.filled(NODATA), dtype=np.float32)
        compared = np.full(a.shape, NODATA, dtype=np.float32)
        reproject(source, compared, src_transform=src.transform, src_crs=src.crs, src_nodata=NODATA,
            dst_transform=transform, dst_crs=region["projected_crs"], dst_nodata=NODATA,
            resampling=Resampling.bilinear, num_threads=2)
        old_datum = src.tags().get("VERTICAL_DATUM", "unverified")
    valid = (compared != NODATA) & (a != NODATA) & np.isfinite(compared) & np.isfinite(a)
    result.update({"old_source": record(old), "old_vertical_datum_tag": old_datum,
                   "comparison_valid_pixels": int(valid.sum()), "comparison_invalid_pixels": int((~valid).sum())})
    if not valid.any():
        result["reason"] = "No common valid pixels"
        return result
    delta = np.full(a.shape, NODATA, dtype=np.float32)
    delta[valid] = compared[valid]-a[valid]
    path = directory / f"{region['id']}_old_dsm_minus_new_terrain.tif"
    write_tif(path, delta, transform, region["projected_crs"], attribution, vertical_datum,
              "diagnostic DSM-new difference; not an independent vegetation-height measurement")
    values = delta[valid]
    result.update({"status": "reported", "statistics": stats(delta),
        "positive_fraction": float((values > 0).mean()), "negative_fraction": float((values < 0).mean()),
        "absolute_difference_p95_m": float(np.percentile(np.abs(values), 95)),
        "warning": "Source prediction, dates, masks and interpolation can differ; do not interpret as exact removed object heights."})
    png = directory / f"{region['id']}_old_dsm_minus_new_terrain.png"
    limit = max(1.0, float(np.percentile(np.abs(values), 98)))
    fig, ax = plt.subplots(figsize=(8, 6), layout="constrained")
    display = np.ma.array(delta, mask=~valid)
    image = ax.imshow(display, cmap="RdBu_r", vmin=-limit, vmax=limit, origin="upper",
        extent=[0, a.shape[1]*transform.a/1000, 0, a.shape[0]*abs(transform.e)/1000])
    ax.set_title(region["name"] + " · 旧 DSM − 新地形", fontproperties=FONT, fontsize=13)
    ax.set_xlabel("East / km")
    ax.set_ylabel("North / km")
    fig.colorbar(image, ax=ax, label="Difference / m")
    fig.text(.02, .01, "Diagnostic only: difference is not surveyed canopy/building height.", fontsize=8)
    fig.savefig(png, dpi=150)
    plt.close(fig)
    result["outputs"] = [record(path), record(png)]
    return result


def prepare_region(region, grid, resolution):
    directory = OUT / region["id"]
    directory.mkdir(parents=True, exist_ok=True)
    entries = grid["entries"]
    attribution = attribution_for(entries)
    datums = list(dict.fromkeys(e["vertical_datum"] for e in entries))
    if len(datums) != 1:
        raise ValueError("Different vertical datums cannot be mixed by relabelling")
    vertical_datum = datums[0]
    west, south, east, north = projected_bounds(region["bounds_wgs84"], region["projected_crs"], resolution)
    master = grid["transform"]
    col, row = round((west-master.c)/resolution), round((master.f-north)/resolution)
    width, height = round((east-west)/resolution), round((north-south)/resolution)
    if row < 0 or col < 0 or row+height > grid["projected"].shape[0] or col+width > grid["projected"].shape[1]:
        raise ValueError("Region projected rectangle lies outside its master grid")
    a = grid["projected"][row:row+height, col:col+width].copy()
    transform = window_transform(Window(col, row, width, height), master)
    s = require_complete(a, region["id"])
    geographic, geo_transform = crop_native(grid["native"], grid["native_transform"], region["bounds_wgs84"])
    geo_stats = require_complete(geographic, "Region native crop")
    native_check = native_checks(geographic, geo_transform, entries)
    kind = "dtm" if region["is_dtm"] else "dsm"
    native_path = directory / f"{region['id']}_{kind}_native_wgs84.tif"
    tif_path = directory / f"{region['id']}_{kind}_utm30m.tif"
    source_point_tags = []
    for e in entries:
        with rasterio.open(source_path(e)) as src:
            source_point_tags.append(src.tags().get("AREA_OR_POINT", "Area"))
    if len(set(source_point_tags)) != 1:
        raise ValueError("Sources have conflicting pixel interpretation tags")
    processing = f"{region['surface_model']}; native scale/offset decoded; bilinear horizontal reprojection; no vertical correction"
    write_tif(native_path, geographic, geo_transform, "EPSG:4326", attribution, vertical_datum,
              processing, source_point_tags[0])
    write_tif(tif_path, a, transform, region["projected_crs"], attribution, vertical_datum, processing)
    npy = directory / f"{region['id']}_elevation_float32.npy"
    np.save(npy, a)
    if not np.array_equal(np.load(npy), a):
        raise ValueError("NPY pixels changed during serialization")
    lo, hi = s["min_m"], s["max_m"]
    if hi <= lo:
        raise ValueError("Flat height range cannot be normalized")
    normalized = np.rint((a-lo)/(hi-lo)*65535).astype(np.uint16)
    png = directory / f"{region['id']}_height16.png"
    Image.fromarray(normalized).save(png)
    restored = np.asarray(Image.open(png), dtype=np.float64)/65535*(hi-lo)+lo
    png_error = float(np.max(np.abs(restored-a)))
    quantization_limit = (hi-lo)/65535/2+.002
    if png_error > quantization_limit:
        raise ValueError("Heightmap quantization error exceeds half a code step")
    obj = directory / f"{region['id']}_blockout.obj"
    mesh = write_obj(obj, a, transform, region["mesh_sampling_m"], grid["origin_xy"], attribution)
    controls = reference_checks(region, a, transform, grid["origin_xy"])
    inverse = Transformer.from_crs(region["projected_crs"], "EPSG:4326", always_xy=True)
    peak_row, peak_col = np.unravel_index(np.argmax(a), a.shape)
    peak_x, peak_y = transform*(peak_col+.5, peak_row+.5)
    peak_lon, peak_lat = inverse.transform(peak_x, peak_y)
    licenses = list(dict.fromkeys(e["license_url"] for e in entries))
    metadata = {"schema_version": 2, "region": region, "product": region["product"],
        "surface_model": region["surface_model"], "source_ids": region["source_ids"],
        "source_tiles": [e.get("tile", e["id"]) for e in entries],
        "source_rasters": [{key: e.get(key) for key in ("id", "product", "local_path", "sha256", "crs",
                           "vertical_datum", "scale", "offset", "effective_scale", "effective_offset",
                           "scale_interpretation", "attribution", "license_url")} for e in entries],
        "source_crs": "EPSG:4326", "vertical_datum": vertical_datum, "vertical_units": "metres",
        "vertical_correction_m": 0, "vertical_origin_m": 0, "vertical_exaggeration": 1,
        "is_dtm": region["is_dtm"],
        "dtm_status": "machine-learning predicted, not a locally surveyed DTM" if region["is_dtm"] else "not DTM; retained ice/snow surface",
        "buildings_and_vegetation_removed": None if region["is_dtm"] else False,
        "object_removal_status": "predicted bare-earth reduction; residuals possible" if region["is_dtm"] else "not removed; original acquired surface retained",
        "is_subglacial_bedrock": False,
        "processing": ["source SHA256 and full local block decoding", "masked native scale/offset decoding",
            "native pixel-grid-aligned mosaic", "native AOI crop", "one bilinear reprojection to master 30m grid",
            "integer-pixel master-grid region crop", "16-bit heightmap", "local XY / absolute EGM2008 Z OBJ"],
        "projected_crs": region["projected_crs"], "projected_bounds_m": [west, south, east, north],
        "projected_transform": list(transform), "resolution_m": resolution,
        "geographic_crop_actual_bounds_wgs84": list(array_bounds(*geographic.shape, geo_transform)),
        "geographic_crop_statistics": geo_stats, "projected_statistics": s,
        "projected_extent_km": [(east-west)/1000, (north-south)/1000],
        "grid": {"rows": height, "columns": width, "resolution_m": resolution,
            "master_id": region.get("master_grid", region["id"]), "window_in_master_row_col_height_width": [row, col, height, width],
            "master_projected_bounds_m": grid["bounds"], "master_projected_xy_origin_m": grid["origin_xy"],
            "coordinate_units": "metres"},
        "grid_join_checks": seam_checks(geographic, geo_transform, entries),
        "native_grid_alignment_check": native_check, "reference_checks": controls,
        "maximum_sample_location": {"lon": peak_lon, "lat": peak_lat, "height_m": hi,
                                    "meaning": "highest sample in crop, not a surveyed summit"},
        "heightmap": {"path": relative(png), "zero_m": lo, "one_m": hi,
            "decode": "elevation_m = pixel/65535 * (one_m-zero_m) + zero_m", "row_zero": "north",
            "colour_space": "Non-Color / linear data", "mesh_pixel_center_extent_m": [(width-1)*resolution, (height-1)*resolution],
            "max_roundtrip_error_m": png_error, "quantization_limit_m": quantization_limit},
        "mesh": mesh, "attribution": attribution, "license_url": licenses[0], "license_urls": licenses,
        "limits": region["limits"]+["30m reprojection does not add terrain detail.", "Reference positions are approximate coverage checks, not survey controls.",
            "No buildings, glacier thickness, near-field rock details or narrative layout are constructed here."], "outputs": []}
    map_path = directory / f"{region['id']}_map.png"
    fig, ax = plt.subplots(figsize=(9, 8), layout="constrained")
    map_plot(ax, a, transform, region, controls)
    fig.text(.02, .01, f"30 m UTM | {region['surface_model']} | EGM2008 | no vertical correction", fontsize=8)
    fig.savefig(map_path, dpi=150)
    plt.close(fig)
    surface = directory / f"{region['id']}_surface.png"
    stride = max(1, math.ceil(max(a.shape)/180))
    rr, cc = np.mgrid[0:height:stride, 0:width:stride]
    fig = plt.figure(figsize=(10, 7), layout="constrained")
    ax = fig.add_subplot(111, projection="3d")
    ax.plot_surface((cc+.5)*resolution/1000, (height-rr-.5)*resolution/1000,
                    a[::stride, ::stride]/1000, cmap="terrain", linewidth=0, rcount=180, ccount=180)
    ax.set_box_aspect(((east-west)/1000, (north-south)/1000, (hi-lo)/1000))
    ax.set_title(region["name"], fontproperties=FONT, fontsize=15)
    ax.set_xlabel("East / km")
    ax.set_ylabel("North / km")
    ax.set_zlabel("Elevation / km")
    ax.view_init(elev=35, azim=-125)
    fig.text(.02, .02, "Terrain data preview | vertical exaggeration 1x | no scene modelling", fontsize=8)
    fig.savefig(surface, dpi=150)
    plt.close(fig)
    diagnostic = diagnostic_old_dsm(region, a, transform, directory, attribution, vertical_datum)
    metadata["old_dsm_comparison"] = diagnostic
    paths = [native_path, tif_path, npy, png, obj, map_path, surface]
    metadata["outputs"] = [record(path) for path in paths]+diagnostic["outputs"]
    write_json(directory / f"{region['id']}_metadata.json", metadata)
    print(f"Prepared {region['id']}: {width} x {height}, {lo:.1f}–{hi:.1f} m; {mesh['triangles']} triangles", flush=True)
    return metadata, a, transform, controls


def overlap_check(first, second):
    meta_a, a, ta, _ = first
    meta_b, b, tb, _ = second
    if meta_a["projected_crs"] != meta_b["projected_crs"]:
        raise ValueError("Shared-city region CRS differs")
    bounds_a, bounds_b = meta_a["projected_bounds_m"], meta_b["projected_bounds_m"]
    west, south = max(bounds_a[0], bounds_b[0]), max(bounds_a[1], bounds_b[1])
    east, north = min(bounds_a[2], bounds_b[2]), min(bounds_a[3], bounds_b[3])
    if west >= east or south >= north:
        raise ValueError("City regions require a nonempty shared overlap")
    wa, wb = enclosing_window([west, south, east, north], ta), enclosing_window([west, south, east, north], tb)
    def take(array, window):
        r, c, h, w = map(int, [window.row_off, window.col_off, window.height, window.width])
        return array[r:r+h, c:c+w]
    aa, bb = take(a, wa), take(b, wb)
    if aa.shape != bb.shape or not np.array_equal(aa, bb):
        raise ValueError("City overlapping elevations differ")
    if meta_a["mesh"]["projected_xy_origin_m"] != meta_b["mesh"]["projected_xy_origin_m"]:
        raise ValueError("City meshes do not share their projected origin")
    return {"regions": [meta_a["region"]["id"], meta_b["region"]["id"]],
        "projected_overlap_bounds_m": [west, south, east, north], "shape_rows_columns": list(aa.shape),
        "pixels_compared": int(aa.size), "all_overlap_pixels_exactly_equal": True,
        "maximum_difference_m": 0, "shared_projected_xy_origin_m": meta_a["mesh"]["projected_xy_origin_m"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--regions", default=str(DOCS / "terrain-v2-regions.json"))
    parser.add_argument("--downloads", default=str(DOCS / "terrain-v2-download-manifest.json"))
    args = parser.parse_args()
    config = json.loads(Path(args.regions).read_text(encoding="utf-8"))
    downloads = json.loads(Path(args.downloads).read_text(encoding="utf-8"))
    if downloads.get("status") != "complete":
        raise ValueError("Download manifest must be complete before processing")
    entries = downloads["sources"]
    index = {e["id"]: e for e in entries}
    if len(index) != len(entries):
        raise ValueError("Duplicate source IDs")
    resolution = int(config["projected_raster_resolution_m"])
    if resolution != 30:
        raise ValueError("This v2 workflow expects a 30m projected grid")
    OUT.mkdir(parents=True, exist_ok=True)
    report_path = DOCS / "terrain-v2-processing-manifest.json"
    report = {"schema_version": 2, "status": "running", "download_manifest": relative(args.downloads),
              "region_configuration": relative(args.regions), "regions": [], "outputs": []}
    write_json(report_path, report)
    try:
        raw_checks = validate_sources(entries)
        for region in config["regions"]:
            if any(source_id not in index for source_id in region["source_ids"]):
                raise ValueError(f"Missing sources for region {region['id']}")
        grids = {}
        for name, spec in config.get("master_grids", {}).items():
            selected = [index[source_id] for source_id in spec["source_ids"]]
            grids[name] = build_grid(spec, selected, resolution, config["source_padding_degrees"])
        results = []
        for region in config["regions"]:
            selected = [index[source_id] for source_id in region["source_ids"]]
            if region.get("master_grid"):
                grid = grids[region["master_grid"]]
                if grid["projected_crs"] != region["projected_crs"] or [e["id"] for e in grid["entries"]] != region["source_ids"]:
                    raise ValueError("Region differs from its declared master source/CRS")
            else:
                grid = build_grid(region, selected, resolution, config["source_padding_degrees"])
            results.append(prepare_region(region, grid, resolution))
        by_id = {result[0]["region"]["id"]: result for result in results}
        city_check = overlap_check(by_id["campus"], by_id["tanglang"])
        for region_id in ("campus", "tanglang"):
            by_id[region_id][0]["shared_city_grid_check"] = city_check
            write_json(OUT / region_id / f"{region_id}_metadata.json", by_id[region_id][0])
        fig, axes = plt.subplots(2, 2, figsize=(16, 13), layout="constrained")
        for ax, (meta, a, transform, controls) in zip(axes.ravel(), results):
            map_plot(ax, a, transform, meta["region"], controls)
        fig.suptitle("川衡 · 四区地形数据检查", fontproperties=FONT, fontsize=22)
        atlas = OUT / "terrain-overview.png"
        fig.savefig(atlas, dpi=150)
        plt.close(fig)
        now = datetime.now(timezone.utc)
        attributions = "\n\n".join(dict.fromkeys(e["attribution"] for e in entries))
        attribution_path = OUT / "ATTRIBUTION.txt"
        attribution_path.write_text(attributions + "\n\n" + "\n".join(dict.fromkeys(e["license_url"] for e in entries))
            + "\n\nDerived products: scaled native crops, horizontal reprojections, heightmaps and terrain meshes.\n", encoding="utf-8")
        report.update({"status": "complete", "processed_at_utc": now.isoformat(),
            "processed_at_asia_shanghai": now.astimezone(timezone(timedelta(hours=8))).isoformat(),
            "source_raster_checks": raw_checks, "shared_city_grid_check": city_check,
            "regions": [r[0] for r in results], "overview": relative(atlas),
            "outputs": [record(atlas), record(attribution_path)], "attribution": attributions,
            "python": sys.version, "python_executable": sys.executable, "gdal_version": rasterio.__gdal_version__,
            "dependencies": {name: importlib.metadata.version(name) for name in ["numpy", "rasterio", "pyproj", "matplotlib", "Pillow"]},
            "limits": ["GEDTM30 is globally predicted bare earth, not a locally surveyed DTM.",
                "Copernicus retains glacier/snow surface and does not expose subglacial bedrock.",
                "30m reprojection does not add topographic detail; terrain meshes are open surfaces.",
                "No Blender process, assembled narrative world, buildings or website integration is created here."]})
        write_json(report_path, report)
    except Exception as error:
        report.update({"status": "failed", "failure": {"type": type(error).__name__, "message": str(error)}})
        write_json(report_path, report)
        raise
    print(f"Complete: {report_path}", flush=True)


if __name__ == "__main__":
    main()
