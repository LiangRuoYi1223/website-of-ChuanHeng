"""Verify the saved campus refinement without editing its source BLEND.

The regular-Python driver runs fresh Blender processes. The first saves an
isolated verification copy, reopens it, and exports the selected source-labelled
assets. The second imports that GLB in a factory-clean scene. Baseline terrain
and path geometry come from the independently recorded v2 build. Texture images
must be packed in BLEND and embedded in GLB, and all glTF texture references are
resolved. This certifies files and geometry, not a user's GPU viewport or an
architectural survey. Use --no-export when the producer already exported GLB.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone, timedelta
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_V2_SHA = "21797b160f9f388511095e6d2cbc0f92218ff1f99c311c9bf25828e2e1ebec86"
V2_BLEND = ROOT / "output/campus-model-v2/sustech_campus_v2.blend"
V2_REPORT = ROOT / "output/campus-model-v2/reports/build-save.json"


def require(value, message):
    if not value:
        raise RuntimeError(message)


def stamp():
    return datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="seconds")


def record(path):
    path = Path(path).resolve()
    require(path.is_relative_to(ROOT), "Verification artifacts must stay inside project")
    return {"path": path.relative_to(ROOT).as_posix(), "bytes": path.stat().st_size,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}


def save_json(path, value):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def load_builder():
    spec = importlib.util.spec_from_file_location("campus_builder", ROOT / "scripts/build-sustech-campus.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def clean_property(value):
    if hasattr(value, "to_dict"):
        return {k: clean_property(v) for k, v in value.to_dict().items()}
    if hasattr(value, "to_list"):
        return [clean_property(v) for v in value.to_list()]
    if isinstance(value, dict):
        return {k: clean_property(v) for k, v in value.items()}
    return value


def image_state(image):
    packed = bool(image.packed_file or image.packed_files)
    return {"name": image.name, "size_px": list(image.size), "packed": packed,
            "source": image.source, "channels": image.channels,
            "colorspace": image.colorspace_settings.name}


def material_state(mat):
    if not mat.use_nodes:
        return {"name": mat.name, "principled": False, "images": []}
    nodes = mat.node_tree.nodes
    shader = next((node for node in nodes if node.type == "BSDF_PRINCIPLED"), None)
    textures = sorted([image_state(node.image) for node in nodes if node.type == "TEX_IMAGE" and node.image],
                      key=lambda item: item["name"])
    values = {}
    image_roles = {}
    if shader:
        for name in ("Base Color", "Roughness", "Metallic", "IOR", "Transmission Weight", "Coat Weight", "Alpha"):
            if name in shader.inputs:
                sock = shader.inputs[name]
                val = sock.default_value
                values[name] = {"value": list(val) if hasattr(val, "__iter__") else float(val),
                                "linked": bool(sock.is_linked)}
        for name in ("Base Color", "Roughness", "Metallic", "Normal", "Transmission Weight"):
            if name not in shader.inputs:
                continue
            pending = [link.from_node for link in shader.inputs[name].links]
            visited, found = set(), set()
            while pending:
                node = pending.pop()
                if node.as_pointer() in visited:
                    continue
                visited.add(node.as_pointer())
                if node.type == "TEX_IMAGE" and node.image:
                    found.add(node.image.name)
                pending.extend(link.from_node for socket in node.inputs for link in socket.links)
            if found:
                image_roles[name] = sorted(found)
    return {"name": mat.name, "principled": bool(shader), "values": values, "images": textures,
            "image_roles": image_roles}


def state(bpy, builder, inspect_topology=False):
    import numpy as np
    result = {}
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH" or not obj.get("export_asset", False):
            continue
        asset_id = obj.get("asset_id")
        require(asset_id and asset_id not in result, "Exported mesh missing or duplicates asset_id")
        mesh = obj.data
        coordinates = np.empty(len(mesh.vertices) * 3, dtype=np.float32)
        mesh.vertices.foreach_get("co", coordinates)
        coordinates = coordinates.reshape(-1, 3)
        require(len(coordinates), f"Empty mesh: {asset_id}")
        matrix = np.asarray([list(row) for row in obj.matrix_world])
        world = (np.c_[coordinates, np.ones(len(coordinates))] @ matrix.T)[:, :3]
        require(np.isfinite(world).all(), f"Nonfinite coordinates: {asset_id}")
        mesh.calc_loop_triangles()
        triangles = np.asarray([list(t.vertices) for t in mesh.loop_triangles], dtype=np.int64)
        require(len(triangles), f"Mesh without triangles: {asset_id}")
        double_area = np.linalg.norm(np.cross(world[triangles[:, 1]] - world[triangles[:, 0]],
                                             world[triangles[:, 2]] - world[triangles[:, 0]]), axis=1)
        require((double_area > 1e-8).all(), f"Degenerate triangle: {asset_id}")
        used_materials = {poly.material_index for poly in mesh.polygons}
        materials = [material_state(mat) for index, mat in enumerate(mesh.materials) if mat and index in used_materials]
        properties = {key: clean_property(value) for key, value in obj.items() if key != "_RNA_UI"}
        item = {"name": obj.name, "vertices": len(coordinates), "triangles": len(triangles),
                "bounds_min_m": world.min(axis=0).tolist(), "bounds_max_m": world.max(axis=0).tolist(),
                "geometry_sha256": builder.mesh_geometry_hash(obj),
                "uv_layers": len(mesh.uv_layers), "materials": materials,
                "source_properties": properties}
        if inspect_topology:
            import bmesh
            bm = bmesh.new()
            bm.from_mesh(mesh)
            item["topology"] = {"boundary_edges": sum(edge.is_boundary for edge in bm.edges),
                                "multiple_face_edges": sum(len(edge.link_faces) > 2 for edge in bm.edges),
                                "wire_edges": sum(edge.is_wire for edge in bm.edges)}
            bm.free()
        result[asset_id] = item
    require(result, "No campus assets selected for export")
    return result


def compare(before, after, exact=False):
    require(set(before) == set(after), "Exported asset IDs changed")
    for asset_id, expected in before.items():
        actual = after[asset_id]
        require(expected["triangles"] == actual["triangles"], f"Triangle count changed: {asset_id}")
        require(expected["source_properties"] == actual["source_properties"], f"Attribution/extras changed: {asset_id}")
        for key in ("bounds_min_m", "bounds_max_m"):
            require(max(abs(a - b) for a, b in zip(expected[key], actual[key])) < .003,
                    f"World bounds changed: {asset_id}")
        require(actual["uv_layers"] >= min(1, expected["uv_layers"]), f"UV mapping lost: {asset_id}")
        if exact:
            require(actual["geometry_sha256"] == expected["geometry_sha256"], f"Save/reopen altered mesh: {asset_id}")
            require(actual["materials"] == expected["materials"], f"Save/reopen altered materials: {asset_id}")


def check_glb(path, expected):
    raw = Path(path).read_bytes()
    magic, version, length = struct.unpack_from("<4sII", raw)
    require(magic == b"glTF" and version == 2 and length == len(raw), "Invalid GLB container")
    size, kind = struct.unpack_from("<II", raw, 12)
    require(kind == 0x4E4F534A, "GLB JSON chunk absent")
    doc = json.loads(raw[20:20 + size])
    require(all("uri" not in buffer for buffer in doc.get("buffers", [])), "GLB uses an external buffer")
    views = doc.get("bufferViews", [])
    images = doc.get("images", [])
    for image in images:
        require("bufferView" in image and "uri" not in image, "Texture is not embedded into GLB")
        view = views[image["bufferView"]]
        require(view["buffer"] == 0 and view["byteLength"] > 0, "Embedded texture view invalid")
        require(image.get("mimeType") in ("image/png", "image/jpeg", "image/webp", "image/ktx2"), "Unknown texture MIME")
    textures = doc.get("textures", [])
    for texture in textures:
        source = texture.get("source")
        if source is None:
            source = next((x.get("source") for x in texture.get("extensions", {}).values() if "source" in x), None)
        require(isinstance(source, int) and 0 <= source < len(images), "Unresolved glTF texture image")
    slots = []
    def walk(value, prefix):
        if isinstance(value, dict):
            for key, child in value.items():
                if key.endswith("Texture") and isinstance(child, dict) and "index" in child:
                    require(0 <= child["index"] < len(textures), "Unresolved glTF material texture")
                    slots.append(prefix + "." + key)
                walk(child, prefix + "." + key)
        elif isinstance(value, list):
            for index, child in enumerate(value):
                walk(child, f"{prefix}[{index}]")
    walk(doc.get("materials", []), "materials")
    gltf_materials = {material.get("name"): material for material in doc.get("materials", [])}
    expected_materials = {mat["name"]: mat for item in expected.values() for mat in item["materials"]}
    material_checks = []
    for name, mat in expected_materials.items():
        require(name in gltf_materials, f"GLB lost used material: {name}")
        exported = gltf_materials[name]
        pbr = exported.get("pbrMetallicRoughness", {})
        values = mat.get("values", {})
        for socket, key, default in (("Roughness", "roughnessFactor", 1.), ("Metallic", "metallicFactor", 1.)):
            if socket in values and not values[socket]["linked"]:
                require(abs(pbr.get(key, default) - values[socket]["value"]) < 1e-5,
                        f"GLB changed material {socket}: {name}")
        roles = mat.get("image_roles", {})
        if roles.get("Base Color"):
            require("baseColorTexture" in pbr, f"GLB lost colour image map: {name}")
        if roles.get("Roughness") or roles.get("Metallic"):
            require("metallicRoughnessTexture" in pbr, f"GLB lost roughness image map: {name}")
        if roles.get("Normal"):
            require("normalTexture" in exported, f"GLB lost normal image map: {name}")
        if "Transmission Weight" in values and not values["Transmission Weight"]["linked"]:
            transmission = exported.get("extensions", {}).get("KHR_materials_transmission", {}).get("transmissionFactor", 0.)
            require(abs(transmission - values["Transmission Weight"]["value"]) < 1e-5,
                    f"GLB changed glass transmission: {name}")
        material_checks.append({"name": name, "image_roles": roles, "exported_pbr_maps_and_constants_verified": True})
    nodes = {node.get("extras", {}).get("asset_id"): node for node in doc.get("nodes", []) if "mesh" in node}
    require(set(nodes) == set(expected), "GLB lost campus asset IDs")
    for asset_id, item in expected.items():
        node = nodes[asset_id]
        require(node.get("extras") == item["source_properties"], f"GLB changed source extras: {asset_id}")
        primitives = doc["meshes"][node["mesh"]]["primitives"]
        require(all(part.get("mode", 4) == 4 for part in primitives), "GLB primitive is not triangles")
        triangle_count = sum(doc["accessors"][part["indices"]]["count"] // 3 for part in primitives)
        require(triangle_count == item["triangles"], f"GLB changed triangle count: {asset_id}")
        if any(mat["images"] for mat in item["materials"]):
            require(all("TEXCOORD_0" in part["attributes"] for part in primitives), f"Textured GLB mesh has no UV: {asset_id}")
    return {"mesh_nodes": len(nodes), "triangles": sum(item["triangles"] for item in expected.values()),
            "embedded_images": len(images), "textures": len(textures), "material_texture_slots": slots,
            "extensions_used": doc.get("extensionsUsed", []), "self_contained": True,
            "source_extras_exact": True, "all_texture_references_resolved": True,
            "material_checks": material_checks}


def stage(args):
    import bpy
    builder = load_builder()
    work = Path(args.manifest).parent / "reports"
    work.mkdir(parents=True, exist_ok=True)
    if args.stage == "saved-export":
        require(record(V2_BLEND)["sha256"] == args.source_v2_checksum, "Source v2 BLEND changed")
        bpy.ops.wm.open_mainfile(filepath=str(Path(args.blend).resolve()), load_ui=False, use_scripts=False)
        baseline = json.loads(V2_REPORT.read_text(encoding="utf-8"))["assets"]
        before = state(bpy, builder, inspect_topology=True)
        protected = {key: value for key, value in baseline.items()
                     if value["source_properties"].get("component") in ("terrain", "path", "water")}
        for asset_id, source in protected.items():
            require(asset_id in before and before[asset_id]["geometry_sha256"] == source["geometry_sha256"],
                    f"Source DTM/road geometry changed: {asset_id}")
            for key in ("bounds_min_m", "bounds_max_m"):
                require(max(abs(a - b) for a, b in zip(before[asset_id][key], source[key])) < .0001,
                        f"Source DTM/road world transform changed: {asset_id}")
        expected_ids = {item["source_properties"].get("feature_id") for item in baseline.values()
                        if item["source_properties"].get("component") == "body"}
        actual_ids = {item["source_properties"].get("feature_id") for item in before.values()
                      if item["source_properties"].get("component") == "body"}
        require(len(expected_ids) == 113 and expected_ids.issubset(actual_ids), "Source campus building IDs missing")
        all_images = {image["name"]: image for item in before.values() for mat in item["materials"] for image in mat["images"]}
        require(all(image["packed"] for image in all_images.values()), "Export material image not packed into BLEND")
        require(all(min(image["size_px"]) > 0 for image in all_images.values()), "Missing/empty texture image")
        for asset_id, item in before.items():
            if any(mat["images"] for mat in item["materials"]):
                require(item["uv_layers"] > 0, f"Image-textured mesh lacks explicit UVs: {asset_id}")
        temporary_copy = work / "verification-reopen.blend"
        bpy.context.preferences.filepaths.save_version = 0
        bpy.ops.wm.save_as_mainfile(filepath=str(temporary_copy), check_existing=False)
        bpy.ops.wm.open_mainfile(filepath=str(temporary_copy), load_ui=False, use_scripts=False)
        reopened = state(bpy, builder)
        compare(before, reopened, exact=True)
        if not args.no_export:
            bpy.ops.object.select_all(action="DESELECT")
            for obj in bpy.context.scene.objects:
                if obj.type == "MESH" and obj.get("export_asset", False):
                    obj.select_set(True)
                    bpy.context.view_layer.objects.active = obj
            bpy.ops.export_scene.gltf(filepath=str(Path(args.glb).resolve()), export_format="GLB", use_selection=True,
                                      export_yup=True, export_apply=False, export_extras=True, export_cameras=False,
                                      export_lights=False, export_materials="EXPORT")
        glb = check_glb(args.glb, before)
        if all_images:
            require(glb["embedded_images"] > 0 and glb["material_texture_slots"], "BLEND textures did not export to GLB")
        report = {"status": "passed", "stage": args.stage, "assets": before, "glb": glb,
                  "source_v2": record(V2_BLEND), "source_building_features": len(expected_ids),
                  "source_dtm_geometry_sha256": before["terrain:campus"]["geometry_sha256"],
                  "protected_path_objects": len(protected) - 1,
                  "v2_dtm_and_paths_geometry_unchanged": True, "road_clearance_baseline_preserved": True,
                  "save_reopen_geometry_materials_extras_exact": True, "packed_material_images": list(all_images.values()),
                  "new_asset_count": len(set(before) - set(baseline)), "blender_version": bpy.app.version_string}
    else:
        expected = json.loads((work / "saved-export.json").read_text(encoding="utf-8"))["assets"]
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=str(Path(args.glb).resolve()))
        imported = state(bpy, builder)
        compare(expected, imported)
        images = {image["name"]: image for item in imported.values() for mat in item["materials"] for image in mat["images"]}
        require(all(min(image["size_px"]) > 0 for image in images.values()), "GLB image failed to decode")
        glb = check_glb(args.glb, expected)
        if glb["embedded_images"]:
            require(images, "Imported GLB has no material image nodes")
        report = {"status": "passed", "stage": args.stage, "all_asset_ids_bounds_triangles_and_extras_preserved": True,
                  "imported_images": list(images.values()), "glb": glb, "blender_version": bpy.app.version_string}
    report["finished_at"] = stamp()
    save_json(work / (args.stage + ".json"), report)
    print("CAMPUS_V3_VERIFY=" + json.dumps({"status": "passed", "stage": args.stage}), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--blend", default=str(ROOT / "output/campus-model-v3/sustech_campus_v3.blend"))
    parser.add_argument("--glb", default=str(ROOT / "output/campus-model-v3/sustech_campus_v3.glb"))
    parser.add_argument("--source-v2-checksum", default=DEFAULT_V2_SHA)
    parser.add_argument("--manifest", default=str(ROOT / "docs/campus-model-v3/validation.json"))
    parser.add_argument("--blender", default="D:/blender/blender.exe")
    parser.add_argument("--no-export", action="store_true")
    parser.add_argument("--stage", choices=("saved-export", "glb-roundtrip"))
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    args = parser.parse_args(argv)
    if args.stage:
        stage(args)
        return
    for path in (args.blend, args.glb, args.manifest):
        require(Path(path).resolve().is_relative_to(ROOT), "Artifacts must stay inside project")
    require(Path(args.blend).is_file(), "V3 BLEND not ready")
    output = Path(args.manifest)
    logs = ROOT / "artifacts/campus-model-v3/verification-logs"
    logs.mkdir(parents=True, exist_ok=True)
    manifest = {"schema_version": 1, "status": "running", "started_at": stamp(), "stages": []}
    save_json(output, manifest)
    try:
        for stage_name in ("saved-export", "glb-roundtrip"):
            command = [args.blender, "--background", "--factory-startup", "--python-exit-code", "1", "--python",
                       str(Path(__file__).resolve()), "--", "--stage", stage_name, "--blend", args.blend,
                       "--glb", args.glb, "--manifest", args.manifest, "--source-v2-checksum", args.source_v2_checksum]
            if args.no_export:
                command.append("--no-export")
            log_path = logs / (stage_name + ".log")
            with log_path.open("w", encoding="utf-8") as stream:
                process = subprocess.run(command, cwd=ROOT, stdout=stream, stderr=subprocess.STDOUT, timeout=600)
            require(process.returncode == 0, f"V3 verification failed; see {log_path}")
            report_path = output.parent / "reports" / (stage_name + ".json")
            manifest["stages"].append({"stage": stage_name, "report": record(report_path), "log": record(log_path)})
            save_json(output, manifest)
        saved = json.loads((output.parent / "reports/saved-export.json").read_text(encoding="utf-8"))
        manifest.update({key: saved[key] for key in ("source_building_features", "source_dtm_geometry_sha256",
                        "protected_path_objects", "v2_dtm_and_paths_geometry_unchanged", "road_clearance_baseline_preserved",
                        "save_reopen_geometry_materials_extras_exact", "new_asset_count", "glb")})
        manifest.update(status="passed", finished_at=stamp(), blend=record(args.blend), glb_file=record(args.glb),
                        architectural_survey_claimed=False, user_gpu_viewport_reproduced=False)
        save_json(output, manifest)
        print(json.dumps({"status": "passed", "manifest": record(output),
                          "source_building_features": manifest["source_building_features"],
                          "protected_path_objects": manifest["protected_path_objects"],
                          "new_asset_count": manifest["new_asset_count"],
                          "mesh_nodes": manifest["glb"]["mesh_nodes"],
                          "triangles": manifest["glb"]["triangles"],
                          "embedded_images": manifest["glb"]["embedded_images"]}, ensure_ascii=False, indent=2))
    except Exception as exc:
        manifest.update(status="failed", finished_at=stamp(), error=str(exc))
        save_json(output, manifest)
        raise


if __name__ == "__main__":
    main()
