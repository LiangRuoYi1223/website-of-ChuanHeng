"""Verify Blender against four v2 terrain meshes, retaining their own provenance.

Run with a regular Python interpreter. Every region/stage uses a fresh, isolated
Blender background process; user preferences and existing sessions are untouched.
This produces tool-validation assets, not the continuous narrative world.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone, timedelta
import hashlib
import json
import math
from pathlib import Path
import struct
import subprocess
import sys
import time


ROOT = Path(__file__).resolve().parents[1]
TERRAIN = ROOT / "output" / "terrain-v2"
OUT = ROOT / "output" / "blender-terrain-v2"
REPORTS = OUT / "reports"
REGIONS = ("campus", "tanglang", "wutai", "muztagh_ata")
SAMPLING_M = {"campus": 30, "tanglang": 30, "wutai": 60, "muztagh_ata": 60}
COORD_TOLERANCE_M = 0.002
UV_TOLERANCE = 2e-6
VALIDATION_COLOUR = (0.38, 0.43, 0.47, 1.0)
VALIDATION_ROUGHNESS = 0.86


def relative(path):
    return Path(path).resolve().relative_to(ROOT).as_posix()


def write_json(path, value):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def stamp():
    return datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="seconds")


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def file_record(path):
    return {"path": relative(path), "bytes": path.stat().st_size,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}


def metadata_path(region):
    directory = TERRAIN / region
    for path in (directory / "metadata.json", directory / f"{region}_metadata.json"):
        if path.is_file():
            return path
    raise RuntimeError(f"Terrain v2 metadata is not ready for {region}: {directory}")


def source_path(value, directory):
    path = Path(value)
    candidates = (path,) if path.is_absolute() else (ROOT / path, directory / path)
    for candidate in candidates:
        if candidate.is_file():
            resolved = candidate.resolve()
            require(resolved.is_relative_to(TERRAIN.resolve()), "Source must be inside output/terrain-v2")
            return resolved
    raise RuntimeError(f"Terrain source file missing: {value}")


def provenance(metadata):
    """Do not substitute another region's product, attribution or licence."""
    product = metadata.get("product", metadata.get("source_product", metadata.get("source_dataset")))
    licence = metadata.get("license", metadata.get("license_url"))
    attribution = metadata.get("attribution")
    require(product is not None and product != "", "Missing terrain product identity")
    require(licence is not None and licence != "", "Missing terrain licence")
    require(isinstance(attribution, str) and bool(attribution.strip()), "Missing terrain attribution")
    product_text = product if isinstance(product, str) else json.dumps(product, ensure_ascii=False, sort_keys=True)
    licence_text = licence if isinstance(licence, str) else json.dumps(licence, ensure_ascii=False, sort_keys=True)
    return {"product": product, "product_text": product_text,
            "attribution": attribution, "license": licence, "license_text": licence_text,
            "license_url": metadata.get("license_url", "")}


def read_metadata(region):
    path = metadata_path(region)
    metadata = json.loads(path.read_text(encoding="utf-8"))
    require(metadata.get("region", {}).get("id", region) == region, "Metadata region mismatch")
    require(metadata["mesh"]["sampling_m"] == SAMPLING_M[region], "Unexpected v2 mesh sampling")
    provenance(metadata)
    return metadata, path


def source_data(region):
    import numpy as np
    metadata, meta_path = read_metadata(region)
    path = source_path(metadata["mesh"]["path"], meta_path.parent)
    expected = next((item for item in metadata["outputs"]
                     if source_path(item["path"], meta_path.parent) == path), None)
    require(expected is not None and expected.get("sha256"), "Source OBJ checksum absent")
    require(hashlib.sha256(path.read_bytes()).hexdigest() == expected["sha256"], "Source OBJ hash changed")
    vertices, uvs = [], []
    with path.open(encoding="utf-8") as source:
        for line in source:
            if line.startswith("v "):
                vertices.append([float(value) for value in line.split()[1:4]])
            elif line.startswith("vt "):
                uvs.append([float(value) for value in line.split()[1:3]])
    require(len(vertices) == len(uvs) == metadata["mesh"]["vertices"], "Source array counts mismatch")
    return metadata, path, np.asarray(vertices, dtype=np.float64), np.asarray(uvs, dtype=np.float64)


def source_extras(region, metadata, source):
    origin = metadata["mesh"]["projected_xy_origin_m"]
    require(len(origin) == 2 and all(math.isfinite(float(value)) for value in origin), "Invalid XY origin")
    identity = provenance(metadata)
    return {"region_id": region, "attribution": identity["attribution"],
            "source_product": identity["product_text"], "terrain_license": identity["license_text"],
            "license_url": identity["license_url"], "source_obj": relative(source),
            "source_obj_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
            "metadata_source": relative(metadata_path(region)), "units": "metres",
            "horizontal_crs": metadata["projected_crs"], "vertical_datum": metadata["vertical_datum"],
            "projected_xy_origin_m": list(origin),
            "vertical_origin_m": float(metadata["mesh"].get("vertical_origin_m", metadata.get("vertical_origin_m", 0))),
            "surface_model": metadata.get("surface_model", "unspecified"),
            "scope": "four separate v2 terrain assets; not assembled narrative scene"}


def check_extras(actual, expected):
    for key, value in expected.items():
        require(key in actual, f"Terrain metadata missing: {key}")
        restored = actual[key]
        if isinstance(value, list):
            restored = list(restored)
        require(restored == value, f"Terrain metadata changed: {key}")


def mesh_check(obj, region):
    """Check every vertex and UV loop against source, allowing float32 precision."""
    import numpy as np
    metadata, _, source_vertices, source_uvs = source_data(region)
    mesh = obj.data
    vertices = np.empty(len(mesh.vertices) * 3, dtype=np.float32)
    mesh.vertices.foreach_get("co", vertices)
    vertices = vertices.reshape(-1, 3).astype(np.float64)
    world = np.asarray([list(row) for row in obj.matrix_world], dtype=np.float64)
    positions = (np.c_[vertices, np.ones(len(vertices))] @ world.T)[:, :3]
    require(np.isfinite(positions).all(), "Non-finite mesh coordinates")
    lookup = {(round(x * 100), round(y * 100)): index
              for index, (x, y, _) in enumerate(source_vertices)}
    require(len(lookup) == len(source_vertices), "Source contains duplicate horizontal terrain samples")
    # A shared regional origin can yield fractional coordinates. Search adjacent
    # centimetre buckets so float32 rounding at a bucket edge is not a false fail.
    matched = []
    for x, y, _ in positions:
        key = (round(x * 100), round(y * 100))
        index = lookup.get(key)
        if index is None:
            candidates = [lookup[(key[0] + dx, key[1] + dy)]
                          for dx in (-1, 0, 1) for dy in (-1, 0, 1)
                          if (key[0] + dx, key[1] + dy) in lookup]
            require(len(candidates) == 1, "Cannot match imported vertex to source terrain")
            index = candidates[0]
        matched.append(index)
    source_indices = np.asarray(matched, dtype=np.int64)
    require(len(set(source_indices.tolist())) == len(source_vertices), "Source vertex coverage incomplete")
    position_error = float(np.max(np.abs(positions - source_vertices[source_indices])))
    require(position_error <= COORD_TOLERANCE_M, f"Coordinate error {position_error} exceeds tolerance")
    polygon_sizes = np.empty(len(mesh.polygons), dtype=np.int32)
    mesh.polygons.foreach_get("loop_total", polygon_sizes)
    require((polygon_sizes == 3).all(), "Non-triangular face introduced")
    require(len(mesh.polygons) == metadata["mesh"]["triangles"], "Triangle count changed")
    loop_vertices = np.empty(len(mesh.loops), dtype=np.int32)
    mesh.loops.foreach_get("vertex_index", loop_vertices)
    require(len(mesh.uv_layers) == 1, "Expected one UV layer")
    uvs = np.empty(len(mesh.loops) * 2, dtype=np.float32)
    mesh.uv_layers.active.data.foreach_get("uv", uvs)
    uvs = uvs.reshape(-1, 2)
    uv_error = float(np.max(np.abs(uvs - source_uvs[source_indices[loop_vertices]])))
    require(uv_error <= UV_TOLERANCE, f"UV mismatch {uv_error}")
    triangles = positions[loop_vertices].reshape(-1, 3, 3)
    normals_z = np.cross(triangles[:, 1] - triangles[:, 0], triangles[:, 2] - triangles[:, 0])[:, 2]
    require((normals_z > 0).all(), "Faces flipped or degenerate")
    return {
        "vertices": len(vertices), "unique_source_vertices": len(set(source_indices.tolist())),
        "triangles": len(mesh.polygons), "uv_layers": len(mesh.uv_layers),
        "bounds_min_m": positions.min(axis=0).tolist(), "bounds_max_m": positions.max(axis=0).tolist(),
        "max_coordinate_error_against_obj_m": position_error,
        "coordinate_tolerance_m": COORD_TOLERANCE_M,
        "max_uv_error_against_obj": uv_error, "uv_tolerance": UV_TOLERANCE,
        "all_vertices_and_uv_loops_checked": True, "all_face_normals_positive_z": True,
        "geometry_sha256": hashlib.sha256(vertices.astype(np.float32).tobytes() + loop_vertices.tobytes()).hexdigest(),
        "uv_sha256": hashlib.sha256(uvs.tobytes()).hexdigest(),
    }


def terrain_object(bpy):
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    require(len(meshes) == 1, "Expected exactly one terrain mesh")
    return meshes[0]


def aim_at(obj, target):
    obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()


def setup_preview(bpy, obj, region, check):
    from mathutils import Vector
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1024
    scene.render.resolution_y = 640
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = True
    scene.render.filepath = str(OUT / f"{region}_preview.png")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes.get("Background").inputs["Color"].default_value = (0.18, 0.18, 0.18, 1)
    scene.world.node_tree.nodes.get("Background").inputs["Strength"].default_value = 0.45
    material = bpy.data.materials.new("Validation neutral clay")
    material.use_nodes = True
    material.diffuse_color = VALIDATION_COLOUR
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = material.diffuse_color
    bsdf.inputs["Roughness"].default_value = VALIDATION_ROUGHNESS
    obj.data.materials.clear()
    obj.data.materials.append(material)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    low, high = Vector(check["bounds_min_m"]), Vector(check["bounds_max_m"])
    centre = (low + high) * 0.5
    extent = high - low
    camera_data = bpy.data.cameras.new("Validation camera")
    camera = bpy.data.objects.new("Validation camera", camera_data)
    scene.collection.objects.link(camera)
    camera.location = centre + Vector((0.65, -1.0, 1.05)).normalized() * extent.length * 2.0
    aim_at(camera, centre)
    camera_data.type = "ORTHO"
    camera_data.clip_start = 1.0
    camera_data.clip_end = extent.length * 6.0
    inverse_rotation = camera.rotation_euler.to_matrix().transposed()
    corners = [inverse_rotation @ (Vector((x, y, z)) - centre)
               for x in (low.x, high.x) for y in (low.y, high.y) for z in (low.z, high.z)]
    width = max(v.x for v in corners) - min(v.x for v in corners)
    height = max(v.y for v in corners) - min(v.y for v in corners)
    camera_data.ortho_scale = max(width, height * (1024 / 640)) * 1.12
    scene.camera = camera
    sun_data = bpy.data.lights.new("Validation sun", "SUN")
    sun_data.energy = 3.0
    sun_data.angle = math.radians(12)
    sun = bpy.data.objects.new("Validation sun", sun_data)
    scene.collection.objects.link(sun)
    sun.rotation_euler = tuple(math.radians(value) for value in (35, -25, -35))
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    # Keep editable saved projects convenient to inspect when opened interactively.
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == "VIEW_3D":
                area.spaces.active.clip_end = camera_data.clip_end
                area.spaces.active.region_3d.view_perspective = "CAMERA"


def glb_header_check(path, expected_triangles, expected_extras):
    data = path.read_bytes()
    require(len(data) >= 20, "GLB too short")
    magic, version, length = struct.unpack_from("<4sII", data)
    require(magic == b"glTF" and version == 2 and length == len(data), "Invalid GLB header")
    chunk_length, chunk_kind = struct.unpack_from("<II", data, 12)
    require(chunk_kind == 0x4E4F534A, "GLB first chunk is not JSON")
    document = json.loads(data[20:20 + chunk_length])
    require(document["asset"]["version"] == "2.0", "Not glTF 2.0")
    require(len(document["meshes"]) == 1, "GLB includes unexpected meshes")
    primitives = document["meshes"][0]["primitives"]
    triangles = 0
    for primitive in primitives:
        require(primitive.get("mode", 4) == 4, "GLB mode is not TRIANGLES")
        require("TEXCOORD_0" in primitive["attributes"], "Missing exported UVs")
        triangles += document["accessors"][primitive["indices"]]["count"] // 3
    require(triangles == expected_triangles, "GLB index count changed")
    require(all("uri" not in buffer for buffer in document.get("buffers", [])), "External GLB buffer")
    require(not document.get("images"), "Unexpected texture dependency")
    require(document["asset"].get("copyright") == expected_extras["attribution"], "Missing GLB attribution")
    mesh_nodes = [node for node in document.get("nodes", []) if "mesh" in node]
    require(len(mesh_nodes) == 1, "GLB terrain node count changed")
    check_extras(mesh_nodes[0].get("extras", {}), expected_extras)
    require(len(document.get("materials", [])) == 1, "GLB material count changed")
    pbr = document["materials"][0]["pbrMetallicRoughness"]
    colour = pbr.get("baseColorFactor", [1, 1, 1, 1])
    require(max(abs(a - b) for a, b in zip(colour, VALIDATION_COLOUR)) < 1e-6,
            "GLB base colour changed")
    require(abs(pbr.get("roughnessFactor", 1) - VALIDATION_ROUGHNESS) < 1e-6,
            "GLB roughness changed")
    require(abs(pbr.get("metallicFactor", 1)) < 1e-6, "GLB metallic factor changed")
    return {"glb_version": version, "declared_bytes": length, "primitives": len(primitives),
            "triangles": triangles, "uv_present": True, "self_contained": True,
            "copyright_present": True, "product_license_and_origin_extras_verified": True,
            "coordinate_convention": "glTF Y up; Blender Z up on reimport"}


def stage_main(stage, region):
    import bpy
    import numpy as np
    require(region in REGIONS, "Unknown region")
    OUT.mkdir(parents=True, exist_ok=True)
    REPORTS.mkdir(parents=True, exist_ok=True)
    bpy.ops.preferences.addon_enable(module="io_scene_gltf2")
    metadata, source, _, _ = source_data(region)
    identity = provenance(metadata)
    expected_extras = source_extras(region, metadata, source)
    blend = OUT / f"{region}_validation.blend"
    glb = OUT / f"{region}_validation.glb"
    report = {"region": region, "stage": stage, "started_at": stamp(),
              "blender_version": bpy.app.version_string, "python_version": sys.version,
              "background": bpy.app.background, "source": file_record(source),
              "source_metadata": file_record(metadata_path(region)), "provenance": identity,
              "expected_extras": expected_extras}
    started = time.perf_counter()
    if stage == "import-save":
        bpy.ops.object.select_all(action="SELECT")
        bpy.ops.object.delete(use_global=False)
        result = bpy.ops.wm.obj_import(filepath=str(source), forward_axis="Y", up_axis="Z",
                                      global_scale=1.0, use_split_objects=False,
                                      use_split_groups=False, validate_meshes=True)
        require(result == {"FINISHED"}, "OBJ import failed")
        obj = terrain_object(bpy)
        obj.name = f"Terrain validation - {region}"
        for key, value in expected_extras.items():
            obj[key] = value
        bpy.context.scene["attribution"] = identity["attribution"]
        bpy.context.scene["source_product"] = identity["product_text"]
        bpy.context.scene["terrain_license"] = identity["license_text"]
        check_extras(obj, expected_extras)
        report["mesh_check"] = mesh_check(obj, region)
        setup_preview(bpy, obj, region, report["mesh_check"])
        bpy.context.preferences.filepaths.save_version = 0
        result = bpy.ops.wm.save_as_mainfile(filepath=str(blend), check_existing=False)
        require(result == {"FINISHED"} and blend.is_file(), "BLEND save failed")
        report["blend"] = file_record(blend)
    elif stage == "reopen-export":
        result = bpy.ops.wm.open_mainfile(filepath=str(blend), load_ui=False, use_scripts=False)
        require(result == {"FINISHED"}, "BLEND reopen failed")
        obj = terrain_object(bpy)
        report["mesh_check"] = mesh_check(obj, region)
        previous = json.loads((REPORTS / f"{region}_import-save.json").read_text(encoding="utf-8"))
        require(report["mesh_check"]["geometry_sha256"] == previous["mesh_check"]["geometry_sha256"],
                "Saved mesh geometry changed on reopening")
        require(report["mesh_check"]["uv_sha256"] == previous["mesh_check"]["uv_sha256"],
                "Saved mesh UVs changed on reopening")
        check_extras(obj, expected_extras)
        require(bpy.context.scene.unit_settings.scale_length == 1.0, "Unit scale changed")
        report["saved_geometry_and_uv_exactly_preserved"] = True
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        result = bpy.ops.export_scene.gltf(filepath=str(glb), export_format="GLB", use_selection=True,
                    export_yup=True, export_apply=False, export_extras=True,
                    export_cameras=False, export_lights=False, export_materials="EXPORT",
                    export_copyright=identity["attribution"])
        require(result == {"FINISHED"} and glb.is_file(), "GLB export failed")
        report["glb_check"] = glb_header_check(glb, metadata["mesh"]["triangles"], expected_extras)
        report["glb"] = file_record(glb)
        render_start = time.perf_counter()
        result = bpy.ops.render.render(write_still=True)
        require(result == {"FINISHED"}, "Render failed")
        preview = OUT / f"{region}_preview.png"
        require(preview.is_file(), "Render PNG missing")
        # Reload the on-disk PNG rather than trusting only the in-memory render.
        image = bpy.data.images.load(str(preview), check_existing=False)
        require(tuple(image.size) == (1024, 640), "Render size mismatch")
        pixels = np.empty(1024 * 640 * 4, dtype=np.float32)
        image.pixels.foreach_get(pixels)
        pixels = pixels.reshape(-1, 4)
        mask = pixels[:, 3] > 0.5
        coverage = float(mask.mean())
        require(0.08 < coverage < 0.9, "Terrain not framed correctly")
        rgb_std = float(pixels[mask, :3].std())
        # Campus is a much flatter, smaller crop than the old combined region.
        require(rgb_std > 0.005, "Rendered terrain has no visible shading variation")
        report["render"] = {"engine": bpy.context.scene.render.engine, "size_px": [1024, 640],
            "seconds": round(time.perf_counter() - render_start, 3),
            "foreground_pixel_fraction": coverage, "foreground_rgb_std": rgb_std,
            "foreground_rgb_std_minimum": 0.005,
            "disk_png_reloaded_and_checked": True, "preview": file_record(preview)}
    elif stage == "glb-roundtrip":
        bpy.ops.object.select_all(action="SELECT")
        bpy.ops.object.delete(use_global=False)
        result = bpy.ops.import_scene.gltf(filepath=str(glb))
        require(result == {"FINISHED"}, "GLB import failed")
        obj = terrain_object(bpy)
        report["mesh_check"] = mesh_check(obj, region)
        check_extras(obj, expected_extras)
        require(len(obj.data.materials) == 1 and obj.data.materials[0].use_nodes, "GLB material missing")
        bsdf = obj.data.materials[0].node_tree.nodes.get("Principled BSDF")
        require(bsdf is not None, "GLB Principled shader missing")
        colour = list(bsdf.inputs["Base Color"].default_value)
        roughness = float(bsdf.inputs["Roughness"].default_value)
        metallic = float(bsdf.inputs["Metallic"].default_value)
        require(max(abs(a - b) for a, b in zip(colour, VALIDATION_COLOUR)) < 1e-6,
                "Roundtrip material base colour changed")
        require(abs(roughness - VALIDATION_ROUGHNESS) < 1e-6, "Roundtrip roughness changed")
        require(abs(metallic) < 1e-6, "Roundtrip metallic factor changed")
        report["material_check"] = {"base_colour_rgba": colour, "roughness": roughness, "metallic": metallic,
                                    "values_match_export_source": True}
        report["glb_check"] = glb_header_check(glb, metadata["mesh"]["triangles"], expected_extras)
        report["material_and_metadata_preserved"] = True
        report["glb"] = file_record(glb)
    else:
        raise RuntimeError("Unknown stage")
    report["elapsed_seconds"] = round(time.perf_counter() - started, 3)
    report["finished_at"] = stamp()
    report["status"] = "passed"
    write_json(REPORTS / f"{region}_{stage}.json", report)
    print("BLENDER_VALIDATION_STAGE=" + json.dumps({"region": region, "stage": stage, "status": "passed"}), flush=True)


def driver_main(blender, recheck_roundtrip=False):
    executable = Path(blender).resolve()
    require(executable.is_file(), "Blender executable not found")
    sources = []
    for region in REGIONS:
        metadata, meta_path = read_metadata(region)
        source = source_path(metadata["mesh"]["path"], meta_path.parent)
        sources.append({"region": region, "metadata": file_record(meta_path),
                        "mesh": file_record(source), "provenance": provenance(metadata),
                        "sampling_m": metadata["mesh"]["sampling_m"]})
    logs = ROOT / "artifacts" / "mountain-prep" / "blender-terrain-v2"
    logs.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    manifest_path = ROOT / "docs" / "mountain-preparation" / "terrain-v2-blender-validation.json"
    manifest = {"started_at": stamp(), "timezone": "Asia/Shanghai", "blender_executable": str(executable),
                "scope": "OBJ import, BLEND save/reopen, GLB export/reimport, EEVEE still render",
                "terrain_version": 2, "regions": list(REGIONS), "sources": sources,
                "campus_reference_check": "skipped at explicit user request on 2026-10-05",
                "user_preferences_saved": False, "assembled_narrative_model_created": False,
                "website_modified": False, "status": "running", "stages": [], "outputs": []}
    if recheck_roundtrip:
        previous = json.loads(manifest_path.read_text(encoding="utf-8"))
        require(previous["status"] == "passed", "Initial verification must pass before targeted recheck")
        manifest = previous
        manifest["status"] = "running"
        manifest["material_recheck_started_at"] = stamp()
        manifest["verification_refinement"] = "GLB PBR colour and roughness explicitly compared after reimport"
    write_json(manifest_path, manifest)
    for region in REGIONS:
        for stage in (("glb-roundtrip",) if recheck_roundtrip else ("import-save", "reopen-export", "glb-roundtrip")):
            command = [str(executable), "--background", "--factory-startup", "--python-exit-code", "1",
                       "--python", str(Path(__file__).resolve()), "--", "--stage", stage, "--region", region]
            print(f"START {region}: {stage}", flush=True)
            started = time.perf_counter()
            log = logs / f"{region}_{stage}.log"
            try:
                with log.open("w", encoding="utf-8") as stream:
                    process = subprocess.run(command, cwd=ROOT, stdout=stream, stderr=subprocess.STDOUT,
                                             timeout=300, check=False)
                require(process.returncode == 0, f"Blender failed (exit {process.returncode}); see {relative(log)}")
                report_path = REPORTS / f"{region}_{stage}.json"
                report = json.loads(report_path.read_text(encoding="utf-8"))
                require(report["status"] == "passed", "Stage report not passed")
                manifest["stages"] = [entry for entry in manifest["stages"]
                                      if (entry["region"], entry["stage"]) != (region, stage)]
                manifest["stages"].append({"region": region, "stage": stage, "return_code": process.returncode,
                    "elapsed_seconds": round(time.perf_counter() - started, 3),
                    "fresh_blender_process": True, "report": relative(report_path), "log": relative(log)})
                write_json(manifest_path, manifest)
                print(f"PASS {region}: {stage} ({time.perf_counter() - started:.1f}s)", flush=True)
            except Exception as error:
                manifest["status"] = "failed"
                manifest["failure"] = {"region": region, "stage": stage, "error": str(error), "log": relative(log)}
                write_json(manifest_path, manifest)
                print(log.read_text(encoding="utf-8", errors="replace")[-7000:], flush=True)
                raise
    manifest["blender_version"] = report["blender_version"]
    manifest["python_version"] = report["python_version"]
    manifest["outputs"] = []
    for region in REGIONS:
        for suffix in ("validation.blend", "validation.glb", "preview.png"):
            manifest["outputs"].append(file_record(OUT / f"{region}_{suffix}"))
        for stage in ("import-save", "reopen-export", "glb-roundtrip"):
            manifest["outputs"].append(file_record(REPORTS / f"{region}_{stage}.json"))
    manifest["finished_at"] = stamp()
    manifest["status"] = "passed"
    write_json(manifest_path, manifest)
    print("ALL FOUR V2 TERRAIN BLENDER VALIDATION STAGES PASSED", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--blender", default="D:/blender/blender.exe")
    parser.add_argument("--stage", choices=("import-save", "reopen-export", "glb-roundtrip"))
    parser.add_argument("--recheck-roundtrip", action="store_true", help="Recheck existing GLBs without resaving or rerendering")
    parser.add_argument("--region", choices=REGIONS)
    arguments = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    args = parser.parse_args(arguments)
    if args.stage:
        require(args.region is not None, "--region is required with --stage")
        stage_main(args.stage, args.region)
    else:
        driver_main(args.blender, args.recheck_roundtrip)
