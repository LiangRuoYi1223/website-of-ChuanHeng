"""Build a source-labelled campus on the preserved v2 DTM in Blender 5.2.

Regular-Python driver: use the bundled Python 3.12 runtime. Blender subprocesses
use their own NumPy and do not load the project's cp312 geospatial packages.
Input: docs/campus-model/buildings.json. Accepts flat records or GeoJSON Features.
Features require id/name/geometry and height_m or levels, with confidence/sources.
Polygon holes remain courtyards. Optional parts describe actual wings, podiums
and bridges; a part has its own geometry/height_m/base_offset_m/detail. Nothing
is cloned to stand in for an unspecified building. Generated facade repetition
is illustrative and recorded as such, rather than claimed as a survey.
Site references accept gate/campus_center WGS84 [lon, lat]. Paths are supplied
LineStrings with width_m; no campus roads or architectural details are invented.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import hashlib
import json
import math
from pathlib import Path
import struct
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output/campus-model"
DOCS = ROOT / "docs/campus-model"
LOGS = ROOT / "artifacts/campus-model/logs"
CONFIG = DOCS / "buildings.json"
PREPARED = OUT / "campus-prepared.json"
BLEND = OUT / "sustech_campus.blend"
GLB = OUT / "sustech_campus.glb"
STAGES = ("build-save", "reopen-export-render", "glb-roundtrip")
CAMERAS = ("campus_aerial", "gate_inward", "campus_overview_labeled")
MATERIALS = {
    "light-stone": ((0.74, 0.72, 0.65, 1), 0.82, 0),
    "warm-concrete": ((0.64, 0.57, 0.47, 1), 0.86, 0),
    "glass-academic": ((0.62, 0.66, 0.65, 1), 0.70, 0),
    "orange-library": ((0.67, 0.30, 0.13, 1), 0.85, 0),
    "wall": ((0.74, 0.72, 0.65, 1), 0.82, 0),
    "roof": ((0.24, 0.28, 0.29, 1), 0.84, 0),
    "glass": ((0.12, 0.21, 0.26, 1), 0.30, 0.15),
    "frame": ((0.25, 0.28, 0.29, 1), 0.48, 0.25),
    "foundation": ((0.46, 0.46, 0.41, 1), 0.96, 0),
    "road": ((0.16, 0.18, 0.18, 1), 0.94, 0),
    "walkway": ((0.58, 0.57, 0.52, 1), 0.93, 0),
    "water": ((0.14, 0.26, 0.30, 1), 0.36, 0),
    "terrain": ((0.23, 0.30, 0.20, 1), 1.0, 0),
    "label": ((0.025, 0.035, 0.035, 1), 0.9, 0),
    "label-background": ((0.92, 0.94, 0.88, 1), 1.0, 0),
}


def require(value, message):
    if not value:
        raise RuntimeError(message)


def relative(path):
    return Path(path).resolve().relative_to(ROOT).as_posix()


def record(path):
    path = Path(path)
    return {"path": relative(path), "bytes": path.stat().st_size,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def stamp():
    return datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="seconds")


def configure_outputs(output_dir, docs_dir, model_stem):
    """Every driver subprocess uses the same explicitly selected artifact tree."""
    global OUT, DOCS, LOGS, PREPARED, BLEND, GLB
    OUT, DOCS = ROOT / output_dir, ROOT / docs_dir
    require(OUT.resolve().is_relative_to(ROOT) and DOCS.resolve().is_relative_to(ROOT),
            "Campus outputs must stay inside the project")
    require(Path(model_stem).name == model_stem, "Model stem must be a simple filename")
    LOGS = ROOT / "artifacts" / OUT.name / "logs"
    PREPARED = OUT / "campus-prepared.json"
    BLEND, GLB = OUT / (model_stem + ".blend"), OUT / (model_stem + ".glb")


def props(feature):
    return {**feature.get("properties", {}),
            **{key: value for key, value in feature.items() if key not in ("properties", "type")}}


def area(ring):
    return sum(p[0] * q[1] - q[0] * p[1] for p, q in zip(ring, ring[1:] + ring[:1])) / 2


def inside_ring(x, y, ring):
    inside = False
    for p, q in zip(ring, ring[1:] + ring[:1]):
        if (p[1] > y) != (q[1] > y) and x < (q[0] - p[0]) * (y - p[1]) / (q[1] - p[1]) + p[0]:
            inside = not inside
    return inside


def inside_polygon(x, y, rings):
    return inside_ring(x, y, rings[0]) and not any(inside_ring(x, y, ring) for ring in rings[1:])


def densify(ring, spacing=8.0, closed=True):
    points = []
    pairs = zip(ring, ring[1:] + ring[:1]) if closed else zip(ring, ring[1:])
    for p, q in pairs:
        steps = max(1, math.ceil(math.dist(p[:2], q[:2]) / spacing))
        points.extend([[p[0] + (q[0] - p[0]) * n / steps,
                        p[1] + (q[1] - p[1]) * n / steps] for n in range(steps)])
    if not closed:
        points.append(list(ring[-1][:2]))
    return points


class Ground:
    """Sample the existing terrain's NW/SW/NE and NE/SW/SE triangles."""
    def __init__(self, values, transform, origin):
        self.values, self.transform, self.origin = values, transform, origin

    def sample(self, x, y):
        a = self.values
        t = self.transform
        col = (x + self.origin[0] - t[2]) / t[0] - 0.5
        row = (y + self.origin[1] - t[5]) / t[4] - 0.5
        require(-0.001 <= col <= a.shape[1] - 1.0 + .001 and
                -0.001 <= row <= a.shape[0] - 1.0 + .001, "Geometry lies outside terrain sample centres")
        col, row = max(0.0, min(col, a.shape[1] - 1.0)), max(0.0, min(row, a.shape[0] - 1.0))
        c, r = min(int(col), a.shape[1] - 2), min(int(row), a.shape[0] - 2)
        fx, fy = col - c, row - r
        nw, ne, sw, se = (float(a[r, c]), float(a[r, c + 1]),
                          float(a[r + 1, c]), float(a[r + 1, c + 1]))
        if fx + fy <= 1:
            z = nw + fx * (ne - nw) + fy * (sw - nw)
        else:
            z = se + (1 - fx) * (sw - se) + (1 - fy) * (ne - se)
        require(math.isfinite(z) and z > -9000, "Invalid DTM elevation")
        return z

    def ring(self, ring):
        """Insert grid/diagonal crossings so skirt edges follow exact DTM planes."""
        t, origin = self.transform, self.origin
        result = []
        for p, q in zip(ring, ring[1:] + ring[:1]):
            c0, c1 = [(point[0] + origin[0] - t[2]) / t[0] - .5 for point in (p, q)]
            r0, r1 = [(point[1] + origin[1] - t[5]) / t[4] - .5 for point in (p, q)]
            count = max(1, math.ceil(math.dist(p, q) / 8))
            parameters = {n / count for n in range(count)}
            for low, high in ((c0, c1), (r0, r1), (c0 + r0, c1 + r1)):
                if abs(high - low) > 1e-9:
                    for crossing in range(math.floor(min(low, high)) + 1, math.ceil(max(low, high))):
                        parameter = (crossing - low) / (high - low)
                        if 1e-8 < parameter < 1 - 1e-8:
                            parameters.add(parameter)
            previous = None
            for parameter in sorted(parameters):
                if previous is None or parameter - previous > 1e-7:
                    point = [p[0] + parameter * (q[0] - p[0]), p[1] + parameter * (q[1] - p[1])]
                    if not result or math.dist(point, result[-1]) > .001:
                        result.append(point)
                    previous = parameter
        if len(result) > 1 and math.dist(result[0], result[-1]) <= .001:
            result.pop()
        return result


def ground_from_prepared(prepared):
    import numpy as np
    a = np.load(ROOT / prepared["terrain"]["npy"]["path"])
    return Ground(a, prepared["terrain"]["transform"], prepared["terrain"]["origin_m"])


def path_surface_patches(lines, width, ground):
    """Clip the buffered road to each original DTM triangle, not a coarse ribbon.

    All retained patch edges are within one affine height plane. Thus its
    rendered triangles have the same clearance at vertices and interiors.
    """
    from shapely.geometry import LineString, Polygon, box
    from shapely.ops import unary_union
    region = unary_union([LineString(line).buffer(width / 2, cap_style=2, join_style=2)
                          for line in lines if len(line) >= 2])
    require(not region.is_empty and region.is_valid, "Invalid buffered path")
    t, origin, values = ground.transform, ground.origin, ground.values
    x0, y0 = t[2] + .5 * t[0] - origin[0], t[5] + .5 * t[4] - origin[1]
    xmin, ymin, xmax, ymax = region.bounds
    c0 = max(0, math.floor((xmin - x0) / t[0]))
    c1 = min(values.shape[1] - 2, math.floor((xmax - x0) / t[0]))
    r0 = max(0, math.floor(min((ymin - y0) / t[4], (ymax - y0) / t[4])))
    r1 = min(values.shape[0] - 2, math.floor(max((ymin - y0) / t[4], (ymax - y0) / t[4])))
    patches = []

    def retain(geometry):
        if geometry.is_empty:
            return
        if geometry.geom_type in ("MultiPolygon", "GeometryCollection"):
            for item in geometry.geoms:
                retain(item)
        elif geometry.geom_type == "Polygon" and geometry.area > .0001:
            rings = [[[float(x), float(y)] for x, y in geometry.exterior.coords[:-1]]]
            rings.extend([[[float(x), float(y)] for x, y in ring.coords[:-1]] for ring in geometry.interiors])
            for index, ring in enumerate(rings):
                if (area(ring) > 0) != (index == 0):
                    ring.reverse()
            patches.append(rings)

    for row in range(r0, r1 + 1):
        for col in range(c0, c1 + 1):
            nw, ne = (x0 + col * t[0], y0 + row * t[4]), (x0 + (col + 1) * t[0], y0 + row * t[4])
            sw, se = (nw[0], nw[1] + t[4]), (ne[0], ne[1] + t[4])
            if not region.intersects(box(nw[0], se[1], ne[0], nw[1])):
                continue
            for triangle in ((nw, sw, ne), (ne, sw, se)):
                retain(region.intersection(Polygon(triangle)))
    require(patches, "Path does not intersect source terrain")
    actual_area = sum(abs(area(rings[0])) - sum(abs(area(ring)) for ring in rings[1:]) for rings in patches)
    require(abs(actual_area - region.area) < max(.02, region.area * 1e-6), "Road patch coverage differs from buffered source")
    return patches


def prepare(config_path):
    require(sys.version_info[:2] == (3, 12), "Run preparation with the bundled Python 3.12 runtime")
    sys.path.insert(0, str(ROOT / "artifacts/mountain-prep/python-tools"))
    import numpy as np
    from pyproj import Transformer
    config = json.loads(Path(config_path).read_text(encoding="utf-8"))
    site = config.get("site", {})
    meta_path = ROOT / site.get("terrain_metadata", "output/terrain-v2/campus/campus_metadata.json")
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    npy_path = ROOT / site.get("terrain_npy", "output/terrain-v2/campus/campus_elevation_float32.npy")
    terrain_blend = ROOT / site.get("terrain_blend", "output/blender-terrain-v2/campus_validation.blend")
    require(terrain_blend.is_file(), "Validated campus terrain BLEND missing")
    origin = meta["mesh"]["projected_xy_origin_m"]
    require(meta["projected_crs"] == site.get("projected_crs", "EPSG:32649"), "Site and DTM CRS mismatch")
    expected_npy = next(x for x in meta["outputs"] if x["path"] == relative(npy_path))
    require(record(npy_path)["sha256"] == expected_npy["sha256"], "DTM NPY checksum changed")
    a = np.load(npy_path)
    require(np.isfinite(a).all() and not np.any(a == -9999), "DTM contains missing heights")
    ground = Ground(a, meta["projected_transform"], origin)
    transform = Transformer.from_crs("EPSG:4326", meta["projected_crs"], always_xy=True)

    def xy(coord):
        require(len(coord) >= 2 and -180 <= float(coord[0]) <= 180 and -90 <= float(coord[1]) <= 90,
                "Invalid WGS84 coordinates")
        x, y = transform.transform(float(coord[0]), float(coord[1]))
        return [x - origin[0], y - origin[1]]

    def polygons(geometry):
        require(geometry.get("type") in ("Polygon", "MultiPolygon"), "Building must have Polygon/MultiPolygon geometry")
        raw = geometry["coordinates"] if geometry["type"] == "MultiPolygon" else [geometry["coordinates"]]
        result = []
        for poly in raw:
            rings = []
            for index, ring in enumerate(poly):
                points = [xy(point) for point in ring]
                points = [point for index, point in enumerate(points)
                          if index == 0 or math.dist(point, points[index - 1]) > .001]
                if len(points) > 1 and math.dist(points[0], points[-1]) < .001:
                    points.pop()
                require(len(points) >= 3 and abs(area(points)) > 0.1, "Degenerate footprint ring")
                if (area(points) > 0) != (index == 0):
                    points.reverse()
                rings.append(points)
            result.append(rings)
        return result

    def floor(rings):
        samples = [ground.sample(*point) for ring in rings for point in ground.ring(ring)]
        outer = rings[0]
        low = [min(p[i] for p in outer) for i in (0, 1)]
        high = [max(p[i] for p in outer) for i in (0, 1)]
        t = meta["projected_transform"]
        x0, y0 = t[2] + .5 * t[0] - origin[0], t[5] + .5 * t[4] - origin[1]
        col_min, col_max = math.ceil((low[0] - x0) / t[0]), math.floor((high[0] - x0) / t[0])
        row_values = [(y - y0) / t[4] for y in (low[1], high[1])]
        row_min, row_max = math.ceil(min(row_values)), math.floor(max(row_values))
        for col in range(max(0, col_min), min(a.shape[1] - 1, col_max) + 1):
            for row in range(max(0, row_min), min(a.shape[0] - 1, row_max) + 1):
                x, y = x0 + col * t[0], y0 + row * t[4]
                if inside_polygon(x, y, rings):
                    samples.append(float(a[row, col]))
        return max(samples) + .10

    buildings = []
    ids = set()
    for raw in config.get("features", []):
        feature = props(raw)
        require(feature.get("id") and feature.get("name"), "Each building needs id and name")
        feature["id"] = str(feature["id"])
        require(feature["id"] not in ids, "Duplicate building id")
        ids.add(feature["id"])
        require(feature.get("sources"), f"Missing footprint sources: {feature['name']}")
        require(feature.get("confidence") is not None, f"Missing source confidence: {feature['name']}")
        outer_polygons = polygons(feature["geometry"])
        common_base = max(floor(poly) for poly in outer_polygons)
        parts = []
        for part_index, source_part in enumerate(feature.get("parts") or [feature]):
            part = {**feature, **props(source_part)}
            detail = {**feature.get("detail", {}), **part.get("detail", {})}
            for key in ("roof", "roof_rise_m", "roof_slope_direction", "roof_axis_deg", "windows",
                        "window_pattern", "window_spacing_m", "window_size_m", "frame_color",
                        "wall_color", "base_wall_color", "base_light_height_m", "roof_color"):
                if key in part:
                    detail[key] = part[key]
            height = part.get("height_m")
            if height is None:
                require(part.get("levels"), f"Missing height/levels: {feature['name']}")
                height = float(part["levels"]) * float(part.get("floor_height_m", 3.6))
            height = float(height)
            require(math.isfinite(height) and .5 <= height <= 150, "Implausible building height")
            rings_list = polygons(part["geometry"])
            base_offset = float(part.get("base_offset_m", 0))
            for polygon_index, rings in enumerate(rings_list):
                parts.append({"id": str(source_part.get("id", f"part-{part_index}")) + f"-{polygon_index}",
                              "rings": rings, "base_z_m": common_base + base_offset,
                              "height_m": height, "levels": int(part.get("levels") or max(1, round(height / 3.6))),
                              "geometry_source": part["geometry"],
                              "detail": detail,
                              "material_style": part.get("material_style", "light-stone"),
                              "foundation": base_offset < .25})
        platforms = []
        if feature.get("platform"):
            spec = feature["platform"]
            for rings in polygons(spec.get("geometry", feature["geometry"])):
                platforms.append({"rings": rings, "top_z_m": common_base - .02})
        points = [p for part in parts for ring in part["rings"] for p in ring]
        centre = [sum(p[i] for p in points) / len(points) for i in (0, 1)]
        buildings.append({"id": str(feature["id"]), "name": feature["name"], "role": feature.get("role", "building"),
                          "confidence": feature["confidence"], "sources": feature["sources"],
                          "height_status": feature.get("height_status", "provided estimate; not a local survey"),
                          "geometry_source": feature["geometry"], "parts": parts, "platforms": platforms,
                          "base_parent_id": str(feature["base_parent_id"]) if feature.get("base_parent_id") else None,
                          "base_parent_offset_m": float(feature.get("base_parent_offset_m", 0)),
                          "centre_xy": centre, "base_z_m": common_base,
                          "label": feature.get("label", feature["name"])})
    require(buildings, "Dataset has no campus buildings")
    by_id = {b["id"]: b for b in buildings}
    resolved = set()

    def resolve_base(building, visiting):
        if building["id"] in resolved:
            return
        require(building["id"] not in visiting, "Building base-parent cycle")
        parent_id = building["base_parent_id"]
        if parent_id:
            require(parent_id in by_id, f"Missing base parent: {parent_id}")
            resolve_base(by_id[parent_id], visiting | {building["id"]})
            target = by_id[parent_id]["base_z_m"] + building["base_parent_offset_m"]
            shift = target - building["base_z_m"]
            building["base_z_m"] = target
            for part in building["parts"]:
                part["base_z_m"] += shift
                part["foundation"] = False
            for platform in building["platforms"]:
                platform["top_z_m"] += shift
        resolved.add(building["id"])

    for building in buildings:
        resolve_base(building, set())
    gate_model = None
    if site.get("gate_model"):
        gate_model = dict(site["gate_model"])
        gate_model["centre_xy"] = xy(gate_model["center_wgs84"])
        bearing = math.radians(float(gate_model.get("inward_bearing_deg", 345)))
        gate_model["inward_xy"] = [math.sin(bearing), math.cos(bearing)]
    paths = []
    for index, raw in enumerate(config.get("paths", site.get("paths", []))):
        path = props(raw)
        geometry = path["geometry"]
        require(geometry["type"] in ("LineString", "MultiLineString"), "Paths need line geometries")
        lines = geometry["coordinates"] if geometry["type"] == "MultiLineString" else [geometry["coordinates"]]
        width = float(path.get("width_m", 3 if path.get("kind") == "walkway" else 7))
        require(.5 <= width <= 35, "Implausible path width")
        paths.append({"id": str(path.get("id", index)), "name": path.get("name", "校园道路"),
                      "kind": path.get("kind", "road"), "width_m": width,
                      "lines": [densify([xy(point) for point in line], 5, False) for line in lines],
                      "sources": path.get("sources", [])})
        paths[-1]["surface_patches"] = path_surface_patches(paths[-1]["lines"], width, ground)
        paths[-1]["drape_method"] = "buffered source line clipped to every original DTM triangle"
    references = site.get("reference_points", {})
    gate = references.get("gate", site.get("gate_wgs84", gate_model.get("center_wgs84") if gate_model else None))
    if gate is None:
        candidate = next((b for b in buildings if b["role"] == "gate"), None)
        require(candidate is not None, "Provide site.reference_points.gate for the inward camera")
        gate_xy = candidate["centre_xy"]
    else:
        if isinstance(gate, dict):
            gate = gate.get("coordinates", [gate.get("lon"), gate.get("lat")])
        gate_xy = xy(gate)
    centre_point = references.get("campus_center")
    if isinstance(centre_point, dict):
        centre_point = centre_point.get("coordinates", [centre_point.get("lon"), centre_point.get("lat")])
    campus_xy = xy(centre_point) if centre_point else [sum(b["centre_xy"][i] for b in buildings) / len(buildings) for i in (0, 1)]
    if gate_model:
        inward, centre = gate_model["inward_xy"], gate_model["centre_xy"]
        gate_xy = [centre[i] - inward[i] * float(gate_model.get("camera_outside_m", 40)) for i in (0, 1)]
        campus_xy = [centre[i] + inward[i] * float(gate_model.get("camera_target_inside_m", 180)) for i in (0, 1)]
    selected_labels = config.get("labels")
    label_ids = [str(item.get("building_id", item.get("id"))) if isinstance(item, dict) else str(item)
                 for item in selected_labels] if selected_labels is not None else [b["id"] for b in buildings if b["role"] in ("landmark", "gate")][:14]
    label_text = {str(item["building_id"]): item.get("text") for item in selected_labels or []
                  if isinstance(item, dict) and item.get("building_id") and item.get("text")}
    require(all(item in ids for item in label_ids), "Label refers to an unknown building")
    prepared = {"schema_version": 1, "prepared_at": stamp(), "source_config": record(config_path),
                "site": site, "terrain": {"blend": record(terrain_blend), "metadata": record(meta_path),
                "npy": record(npy_path), "transform": meta["projected_transform"], "origin_m": origin,
                "projected_crs": meta["projected_crs"], "vertical_datum": meta["vertical_datum"],
                "attribution": meta["attribution"], "license_url": meta["license_url"]},
                "buildings": buildings, "paths": paths, "gate_model": gate_model,
                "label_ids": label_ids, "label_text": label_text,
                "camera_refs": {"gate_xy": gate_xy, "gate_ground_m": ground.sample(*gate_xy),
                                "campus_xy": campus_xy, "campus_ground_m": ground.sample(*campus_xy)},
                "copyright": meta["attribution"] + "\n" + str(config.get("attribution", "Campus geometry sources are recorded per building.")),
                "limits": ["DTM is globally predicted rather than locally surveyed.",
                           "Building heights/detail estimates retain confidence and sources.",
                           "Facade repetition is illustrative; footprints/parts follow supplied geometry.",
                           "Original DTM geometry remains intact; foundations/platforms are separate meshes."]}
    write_json(PREPARED, prepared)
    return prepared


def triangulate(rings, ridge=None):
    """Constraint edges prevent any triangle from crossing a courtyard boundary."""
    from mathutils import Vector
    from mathutils.geometry import delaunay_2d_cdt
    points, edges = [], []
    for ring in rings:
        start = len(points)
        points.extend(ring)
        edges.extend((start + n, start + (n + 1) % len(ring)) for n in range(len(ring)))
    if ridge:
        for p, q in ridge:
            start = len(points)
            points.extend((p, q))
            edges.append((start, start + 1))
    verts, _, faces, _, _, _ = delaunay_2d_cdt([Vector(point) for point in points], edges, [], 0, 1e-5, False)
    coordinates = [[float(v.x), float(v.y)] for v in verts]
    retained = []
    for face in faces:
        x = sum(coordinates[i][0] for i in face) / len(face)
        y = sum(coordinates[i][1] for i in face) / len(face)
        if inside_polygon(x, y, rings):
            require(len(face) == 3, "CDT returned a non-triangle")
            if area([coordinates[i] for i in face]) < 0:
                face = list(reversed(face))
            retained.append(list(face))
    expected = abs(area(rings[0])) - sum(abs(area(ring)) for ring in rings[1:])
    actual = sum(abs(area([coordinates[i] for i in face])) for face in retained)
    require(expected > .0001 and abs(actual - expected) <= max(.02, expected * 2e-5),
            f"Footprint triangulation area mismatch: {actual} vs {expected}")
    return coordinates, retained


def pitched_profile(rings, detail, roof_base):
    angle = math.radians(float(detail.get("roof_axis_deg", 0)))
    u, v = (math.cos(angle), math.sin(angle)), (-math.sin(angle), math.cos(angle))
    values = [p[0] * v[0] + p[1] * v[1] for p in rings[0]]
    centre, radius = (max(values) + min(values)) / 2, (max(values) - min(values)) / 2
    rise = float(detail.get("roof_rise_m", min(4.0, radius * .22)))
    require(radius > .1 and 0 < rise < 15, "Invalid pitched roof dimensions")
    intersections = []
    for ring in rings:
        for p, q in zip(ring, ring[1:] + ring[:1]):
            a, b = p[0] * v[0] + p[1] * v[1] - centre, q[0] * v[0] + q[1] * v[1] - centre
            if abs(a) < 1e-7:
                intersections.append(p)
            if a * b < 0:
                t = a / (a - b)
                intersections.append([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])])
    intersections.sort(key=lambda p: p[0] * u[0] + p[1] * u[1])
    ridge = [(p, q) for p, q in zip(intersections, intersections[1:])
             if math.dist(p, q) > .01 and inside_polygon((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, rings)]
    return (lambda x, y: roof_base + rise * max(0.0, 1 - abs(x * v[0] + y * v[1] - centre) / radius)), ridge


def sloped_profile(rings, detail, maximum_roof_z):
    direction = detail.get("roof_slope_direction", [-1, 1])
    require(len(direction) == 2 and math.hypot(*direction) > .001, "Invalid roof slope direction")
    values = [p[0] * direction[0] + p[1] * direction[1] for p in rings[0]]
    low, high = min(values), max(values)
    require(high - low > .1, "Sloped roof direction has no footprint span")
    rise = float(detail.get("roof_rise_m", 4))
    require(0 < rise < 50, "Invalid roof rise")
    return lambda x, y: maximum_roof_z - rise + rise * (x * direction[0] + y * direction[1] - low) / (high - low)


class Builder:
    def __init__(self, bpy, prepared):
        self.bpy, self.prepared = bpy, prepared
        self.ground = ground_from_prepared(prepared)
        self.materials = {}
        self.palette = dict(MATERIALS)
        self.assets = []
        self.foundation_checks = []
        self.path_checks = []

    def collection(self, name, parent=None):
        bpy = self.bpy
        collection = bpy.data.collections.new(name)
        (parent or bpy.context.scene.collection).children.link(collection)
        return collection

    def material(self, style):
        style = style if style in self.palette else "light-stone"
        if style not in self.materials:
            colour, roughness, metallic = self.palette[style]
            material = self.bpy.data.materials.new("校园 · " + style)
            material.use_nodes = True
            material.diffuse_color = colour
            node = material.node_tree.nodes.get("Principled BSDF")
            node.inputs["Base Color"].default_value = colour
            node.inputs["Roughness"].default_value = roughness
            node.inputs["Metallic"].default_value = metallic
            self.materials[style] = material
        return self.materials[style]

    def custom_style(self, name, colour, roughness=.82, metallic=0):
        values = [float(c) for c in colour]
        require(len(values) in (3, 4) and all(math.isfinite(c) for c in values), "Invalid custom wall colour")
        if max(values[:3]) > 1:
            values[:3] = [c / 255 for c in values[:3]]
        if len(values) == 3:
            values.append(1.0)
        require(all(0 <= c <= 1 for c in values), "PBR colour must be 0–1 or 0–255 RGB")
        self.palette[name] = (tuple(values), roughness, metallic)
        return name

    def mesh(self, name, asset_id, vertices, faces, styles, material_indices, collection, extras):
        import bmesh
        bpy = self.bpy
        require(vertices and faces, f"Empty campus mesh: {name}")
        data = bpy.data.meshes.new(name)
        data.from_pydata(vertices, [], faces)
        data.update()
        obj = bpy.data.objects.new(name, data)
        collection.objects.link(obj)
        for style in styles:
            data.materials.append(self.material(style))
        for polygon, index in zip(data.polygons, material_indices):
            polygon.material_index = index
        # GIS overlays can leave sub-millimetre slivers along identical source
        # boundaries. Clean those at 0.1 mm before validating actual float32
        # Blender triangles; the reference geographic geometry remains stored.
        bm = bmesh.new()
        bm.from_mesh(data)
        bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=.0001)
        bmesh.ops.dissolve_degenerate(bm, edges=list(bm.edges), dist=.0001)
        bmesh.ops.triangulate(bm, faces=list(bm.faces))
        degenerate = [face for face in bm.faces if
                      (face.verts[1].co - face.verts[0].co).cross(face.verts[2].co - face.verts[0].co).length <= 1e-7]
        if degenerate:
            bmesh.ops.delete(bm, geom=degenerate, context="FACES")
        bm.to_mesh(data)
        bm.free()
        data.update()
        obj["asset_id"] = asset_id
        obj["export_asset"] = True
        obj["geometry_cleanup_tolerance_m"] = .0001
        for key, value in extras.items():
            obj[key] = value if isinstance(value, (str, int, float, bool)) else json.dumps(value, ensure_ascii=False, sort_keys=True)
        self.assets.append(asset_id)
        return obj

    def volume(self, name, asset_id, rings, lower, upper, styles, collection, extras, ridge=None, wall_band=None, skip_walls=False):
        vertices, faces, material_indices = [], [], []
        if ridge:
            endpoints = [point for segment in ridge for point in segment]
            refined = []
            for ring in rings:
                result = []
                for p, q in zip(ring, ring[1:] + ring[:1]):
                    result.append(p)
                    dx, dy = q[0] - p[0], q[1] - p[1]
                    length2 = dx * dx + dy * dy
                    splits = []
                    for point in endpoints:
                        t = ((point[0] - p[0]) * dx + (point[1] - p[1]) * dy) / length2
                        if 1e-6 < t < 1 - 1e-6 and abs((point[0] - p[0]) * dy - (point[1] - p[1]) * dx) / math.sqrt(length2) < .002:
                            splits.append((t, point))
                    result.extend(point for _, point in sorted(splits, key=lambda item: item[0]))
                refined.append(result)
            rings = refined
        for ring in rings:
            first = len(vertices)
            vertices.extend([[x, y, lower(x, y)] for x, y in ring])
            vertices.extend([[x, y, upper(x, y)] for x, y in ring])
            n = len(ring)
            if wall_band:
                vertices.extend([[x, y, min(wall_band, upper(x, y))] for x, y in ring])
            for i in range(n):
                j = (i + 1) % n
                if skip_walls:
                    continue
                if wall_band and upper(*ring[i]) > wall_band + .01 and upper(*ring[j]) > wall_band + .01:
                    faces.extend(((first + i, first + j, first + 2 * n + j, first + 2 * n + i),
                                  (first + 2 * n + i, first + 2 * n + j, first + n + j, first + n + i)))
                    material_indices.extend((1, 0))
                else:
                    faces.append((first + i, first + j, first + n + j, first + n + i))
                    material_indices.append(1 if wall_band else 0)
        points, triangles = triangulate(rings, ridge)
        for surface, reverse, style_index in ((upper, False, len(styles) - 1), (lower, True, 1 if wall_band else 0)):
            start = len(vertices)
            vertices.extend([[x, y, surface(x, y)] for x, y in points])
            for triangle in triangles:
                faces.append([start + i for i in (list(reversed(triangle)) if reverse else triangle)])
                material_indices.append(style_index)
        return self.mesh(name, asset_id, vertices, faces, styles, material_indices, collection, extras)

    def architectural_facade(self, building, part, collection, extras, prefix, roof, wall_style):
        """Closed 3D wall strips leave genuine openings around recessed glass.

        The source footprint caps are separate; no complete wall hides behind
        these windows. Boxes are merged into one facade mesh for each part.
        Repeated bay widths and component dimensions are explicitly estimates.
        """
        detail, rings = part["detail"], part["rings"]
        mode = detail["facade_mode"]
        require(mode in ("curtain", "recessed", "scattered_recessed"), "Unknown architectural facade mode")
        base, height = part["base_z_m"], part["height_m"]
        levels = int(detail.get("facade_rows", part["levels"]))
        require(1 <= levels <= 40, "Invalid facade row count")
        storey = height / levels
        spacing = float(detail.get("window_spacing_m", 3.5))
        window_width, window_height = [float(v) for v in detail.get("window_size_m", [1.6, 1.8])]
        depth = float(detail.get("wall_depth_m", detail.get("wall_thickness_m", .60)))
        recess = float(detail.get("glazing_recess_m", .25))
        frame_depth = float(detail.get("frame_depth_m", .28))
        pilotis = float(detail.get("ground_pilotis_height_m", 0))
        require(.25 <= depth <= 2 and .05 <= recess < depth and 1 <= spacing <= 12,
                "Invalid physical facade dimensions")
        frame_style = self.custom_style(prefix + ":frame-style", detail["frame_color"], .65, .05) if detail.get("frame_color") else wall_style
        base_style = self.custom_style(prefix + ":base-wall-style", detail["base_wall_color"]) if detail.get("base_wall_color") else wall_style
        styles = [wall_style, "glass", frame_style, base_style]
        vertices, faces, indices = [], [], []
        components = {"wall_boxes": 0, "glass_panels": 0, "frame_boxes": 0}
        edge_origin = edge_tangent = edge_outward = None

        def world(s, d):
            return (edge_origin[0] + edge_tangent[0] * s + edge_outward[0] * d,
                    edge_origin[1] + edge_tangent[1] * s + edge_outward[1] * d)

        def box(s0, s1, d0, d1, z0, z1, material=0, clip_roof=True):
            if s1 - s0 <= .015 or d1 - d0 <= .005:
                return
            low = (lambda x, y, value=z0: value) if not callable(z0) else z0
            high = (lambda x, y, value=z1: value) if not callable(z1) else z1
            # The sloped upper edge can meet a floor within a bay. Split that
            # support interval first rather than generating collapsed boxes.
            if clip_roof:
                threshold = max(low(*world(s, d)) for s in (s0, s1) for d in (d0, d1)) + .025
                roof0 = min(roof(*world(s0, d)) for d in (d0, d1))
                roof1 = min(roof(*world(s1, d)) for d in (d0, d1))
                if max(roof0, roof1) <= threshold:
                    return
                if min(roof0, roof1) <= threshold:
                    cross = s0 + (s1 - s0) * (threshold - roof0) / (roof1 - roof0)
                    if roof0 <= threshold:
                        s0 = cross + .002
                    else:
                        s1 = cross - .002
                    if s1 - s0 <= .015:
                        return
            coordinates = [world(s, d) for d in (d0, d1) for s in (s0, s1)]
            # NW/NE/SW/SE lower and upper, with every face physically thick.
            bottoms = [low(*p) for p in coordinates]
            tops = [min(high(*p), roof(*p)) if clip_roof else high(*p) for p in coordinates]
            if min(t - b for b, t in zip(bottoms, tops)) <= .010:
                return
            start = len(vertices)
            vertices.extend([[*p, z] for p, z in zip(coordinates, bottoms)])
            vertices.extend([[*p, z] for p, z in zip(coordinates, tops)])
            faces.extend(tuple(start + i for i in face) for face in
                         ((0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1),
                          (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)))
            indices.extend([material] * 6)
            components["glass_panels" if material == 1 else "frame_boxes" if material == 2 else "wall_boxes"] += 1

        outer_y = [p[1] for p in rings[0]]
        top_side_y = max(outer_y)
        north_threshold = max(2.0, (max(outer_y) - min(outer_y)) * .13)
        for ring_index, ring in enumerate(rings):
            for edge_index, (p, q) in enumerate(zip(ring, ring[1:] + ring[:1])):
                length = math.dist(p, q)
                if length < .08:
                    continue
                edge_origin = p
                edge_tangent = ((q[0] - p[0]) / length, (q[1] - p[1]) / length)
                edge_outward = (edge_tangent[1], -edge_tangent[0])
                glazed_end = (detail.get("glazed_end_side") == "north" and ring_index == 0 and
                              top_side_y - (p[1] + q[1]) / 2 < north_threshold and edge_outward[1] > .25)
                bay_count = max(1, round(length / (1.8 if glazed_end else spacing)))
                bay = length / bay_count
                for col in range(bay_count):
                    s0, s1 = col * bay, (col + 1) * bay
                    mid = (s0 + s1) / 2
                    edge_top = min(roof(*world(s, 0)) for s in (s0, s1))
                    wall_material = 3 if detail.get("base_wall_color") and edge_top <= base + float(detail.get("base_light_height_m", 5)) else 0
                    if glazed_end:
                        # Library's short end is continuous glass behind silver ribs.
                        box(s0 + .065, s1 - .065, -recess - .045, -recess, base + .18, roof, 1)
                        box(s0, s0 + .13, -depth, frame_depth, base, roof, 2)
                        for row in range(part["levels"] + 1):
                            z = base + row * height / part["levels"]
                            box(s0, s1, -depth, .12, z, z + .17, 2)
                        continue
                    if pilotis > .1:
                        pillar_width = min(.65, bay * .20)
                        box(s0, s0 + pillar_width, -depth, frame_depth, base, base + pilotis, 2)
                    for row in range(levels):
                        floor0, floor1 = base + row * storey, base + (row + 1) * storey
                        floor0 = max(floor0, base + pilotis)
                        if floor1 <= floor0 + .06:
                            continue
                        effective_mode = "curtain" if glazed_end else mode
                        if effective_mode == "curtain":
                            side = min(.22, bay * .10)
                            opening0, opening1 = s0 + side, s1 - side
                            bottom_band, top_band = .58, .32
                            opening_z0 = floor0 + bottom_band
                            opening_z1 = min(floor1 - top_band, edge_top - .25)
                            if row == levels - 1 and detail.get("clerestory_height_m"):
                                opening_z0 = max(opening_z0, opening_z1 - float(detail["clerestory_height_m"]))
                        else:
                            seed = hashlib.sha256(f"{prefix}:{ring_index}:{edge_index}:{row}:{col}".encode()).digest()
                            if effective_mode == "scattered_recessed" and seed[0] < 38:
                                box(s0, s1, -depth, 0, floor0, min(floor1, edge_top), wall_material)
                                continue
                            width = min(window_width, bay - .35)
                            if effective_mode == "scattered_recessed":
                                width = min(bay - .35, width * (.7 + seed[1] / 255 * .65))
                            centre = mid + ((seed[2] / 255 - .5) * min(.45, bay * .1) if effective_mode == "scattered_recessed" else 0)
                            opening0, opening1 = centre - width / 2, centre + width / 2
                            available = floor1 - floor0
                            wh = min(window_height, available - .45)
                            opening_z0 = floor0 + max(.22, (available - wh) * .48)
                            opening_z1 = min(opening_z0 + wh, edge_top - .25)
                        if opening_z1 - opening_z0 <= .20 or opening1 - opening0 <= .20:
                            box(s0, s1, -depth, 0, floor0, floor1, wall_material)
                            continue
                        # Full-depth jambs and spandrels bound an actual empty window hole.
                        box(s0, opening0, -depth, 0, floor0, floor1, wall_material)
                        box(opening1, s1, -depth, 0, floor0, floor1, wall_material)
                        box(opening0, opening1, -depth, 0, floor0, opening_z0, wall_material)
                        box(opening0, opening1, -depth, 0, opening_z1, floor1, wall_material)
                        box(opening0, opening1, -recess - .045, -recess, opening_z0, opening_z1, 1)
                        fw = min(.10 if mode != "curtain" else .085, (opening1 - opening0) * .1)
                        # Actual frame strips have depth and cast independent shadows.
                        box(opening0, opening0 + fw, -recess - .02, .10, opening_z0, opening_z1, 2)
                        box(opening1 - fw, opening1, -recess - .02, .10, opening_z0, opening_z1, 2)
                        box(opening0, opening1, -recess - .02, .10, opening_z0, opening_z0 + fw, 2)
                        box(opening0, opening1, -recess - .02, .10, opening_z1 - fw, opening_z1, 2)
                        if mode == "curtain":
                            box(s0, s0 + min(.27, bay * .14), -depth, frame_depth, floor0, floor1, 2)
                            box(s0, s1, -depth, .22, floor0, floor0 + .23, 2)
                rib_spacing = float(detail.get("vertical_ribs_spacing_m", 0))
                if rib_spacing > .1:
                    rib_width = float(detail.get("vertical_rib_width_m", .14))
                    rib_depth = float(detail.get("vertical_rib_depth_m", .18))
                    for n in range(max(1, round(length / rib_spacing)) + 1):
                        s = min(length, n * rib_spacing)
                        box(max(0, s - rib_width / 2), min(length, s + rib_width / 2), 0, rib_depth,
                            base, roof, 0)
        require(faces, "Architectural facade has no physical geometry")
        self.mesh(building["name"] + " · 实体立面与凹入玻璃", prefix + ":facade", vertices, faces,
                  styles, indices, collection,
                  {**extras, "component": "facade", "architecture_facade": mode,
                   "wall_thickness_m": depth, "glazing_recess_m": recess,
                   "physical_components": components,
                   "detail_status": "reference-based architectural estimate; repeated bays are not surveyed",
                   "no_complete_wall_behind_openings": True})

    def roof_edge_details(self, building, part, collection, extras, prefix, roof, wall_style):
        """Thick parapets and light railings follow every outer/courtyard edge."""
        detail, base = part["detail"], part["base_z_m"]
        parapet = float(detail.get("parapet_m", 0))
        railing = bool(detail.get("terrace_railing", False))
        support = bool(detail.get("support_columns", False))
        if not (parapet > .01 or railing or support):
            return
        vertices, faces, indices = [], [], []
        rail_height = float(detail.get("railing_height_m", 1.1))
        styles = [wall_style, "frame"]

        def beam(p, tangent, outward, s0, s1, d0, d1, lower, upper, material):
            if s1 - s0 < .01 or d1 - d0 < .008:
                return
            points = [[p[0] + tangent[0] * s + outward[0] * d,
                       p[1] + tangent[1] * s + outward[1] * d]
                      for d in (d0, d1) for s in (s0, s1)]
            low = [lower(*xy) for xy in points]
            high = [upper(*xy) for xy in points]
            if min(z1 - z0 for z0, z1 in zip(low, high)) <= .01:
                return
            start = len(vertices)
            vertices.extend([[*xy, z] for xy, z in zip(points, low)])
            vertices.extend([[*xy, z] for xy, z in zip(points, high)])
            faces.extend(tuple(start + i for i in face) for face in
                         ((0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)))
            indices.extend([material] * 6)

        for ring in part["rings"]:
            for p, q in zip(ring, ring[1:] + ring[:1]):
                length = math.dist(p, q)
                if length < .08:
                    continue
                tangent = [(q[i] - p[i]) / length for i in (0, 1)]
                outward = (tangent[1], -tangent[0])
                if parapet > .01:
                    beam(p, tangent, outward, 0, length, -.26, 0, roof,
                         lambda x, y: roof(x, y) + parapet, 0)
                if railing:
                    zbase = lambda x, y: roof(x, y) + parapet + .06
                    for fraction in (.45, 1.0):
                        beam(p, tangent, outward, 0, length, -.10, -.045,
                             lambda x, y, f=fraction: zbase(x, y) + rail_height * f,
                             lambda x, y, f=fraction: zbase(x, y) + rail_height * f + .055, 1)
                    count = max(1, math.ceil(length / 2.5))
                    for n in range(count + 1):
                        s = length * n / count
                        beam(p, tangent, outward, max(0, s - .035), min(length, s + .035), -.11, -.035,
                             zbase, lambda x, y: zbase(x, y) + rail_height + .055, 1)
                if support:
                    column_width = float(detail.get("support_column_width_m", .65))
                    spacing = float(detail.get("support_spacing_m", 6))
                    count = max(1, round(length / spacing))
                    for n in range(count + 1):
                        s = length * n / count
                        lower = base + float(detail.get("support_base_offset_m", -6.5))
                        beam(p, tangent, outward, max(0, s - column_width / 2), min(length, s + column_width / 2),
                             -column_width, 0, lambda x, y, z=lower: z,
                             lambda x, y, z=base + .05: z, 0)
        if faces:
            self.mesh(building["name"] + " · 女儿墙栏杆与结构", prefix + ":roof-details", vertices, faces,
                      styles, indices, collection,
                      {**extras, "component": "architectural-structure", "parapet_m": parapet,
                       "terrace_railing": railing, "support_columns": support,
                       "detail_status": "reference-based estimated roof perimeter and structural dimensions"})

    def windows(self, building, part, collection, extras, prefix, roof):
        detail = part["detail"]
        if not detail.get("windows", False):
            return
        spacing = float(detail.get("window_spacing_m", 3.5))
        width, height = [float(value) for value in detail.get("window_size_m", [1.5, 1.6])]
        require(spacing > width + .2 and 0.3 < width < 5 and 0.3 < height < 5, "Invalid window layout")
        frame_width = float(detail.get("frame_width_m", .10))
        floor_height = part["height_m"] / part["levels"]
        require(height < floor_height - .35, "Windows do not fit storey height")
        vertices, faces, indices = [], [], []
        frame_style = self.custom_style(prefix + ":frame-style", detail["frame_color"], .48, .1) if detail.get("frame_color") else "frame"

        def quad(origin, tangent, s0, s1, z0, z1, material):
            start = len(vertices)
            vertices.extend([[origin[0] + tangent[0] * s, origin[1] + tangent[1] * s, z]
                             for s, z in ((s0, z0), (s1, z0), (s1, z1), (s0, z1))])
            faces.append((start, start + 1, start + 2, start + 3))
            indices.append(material)

        for ring in part["rings"]:
            for p, q in zip(ring, ring[1:] + ring[:1]):
                length = math.dist(p, q)
                count = int((length - .8) / spacing)
                if count <= 0:
                    continue
                tangent = ((q[0] - p[0]) / length, (q[1] - p[1]) / length)
                outward = (tangent[1], -tangent[0])
                origin = (p[0] + outward[0] * .075, p[1] + outward[1] * .075)
                for row in range(part["levels"]):
                    z0 = part["base_z_m"] + row * floor_height + max(.45, (floor_height - height) * .48)
                    z1 = z0 + height
                    for col in range(count):
                        centre = (col + 1) * length / (count + 1)
                        w, z_bottom, z_top = width, z0, z1
                        if detail.get("window_pattern") == "scattered":
                            key = f"{prefix}:{p}:{row}:{col}".encode("utf-8")
                            seed = hashlib.sha256(key).digest()
                            if seed[0] < 38:
                                continue
                            w = min(spacing - .5, width * (.65 + seed[1] / 255 * .9))
                            centre += (seed[2] / 255 - .5) * min(.6, spacing * .15)
                            z_bottom += (seed[3] / 255 - .5) * .35
                            z_top = z_bottom + min(floor_height - .6, height * (.65 + seed[4] / 255 * .6))
                        a, b = centre - w / 2, centre + w / 2
                        local_roof = min(roof(origin[0] + tangent[0] * s, origin[1] + tangent[1] * s) for s in (a, b))
                        if z_top + frame_width > local_roof - .25:
                            continue
                        quad(origin, tangent, a, b, z_bottom, z_top, 0)
                        for s0, s1, t0, t1 in ((a - frame_width, a, z_bottom - frame_width, z_top + frame_width),
                                             (b, b + frame_width, z_bottom - frame_width, z_top + frame_width),
                                             (a, b, z_bottom - frame_width, z_bottom), (a, b, z_top, z_top + frame_width)):
                            quad(origin, tangent, s0, s1, t0, t1, 1)
        if faces:
            self.mesh(building["name"] + " · 窗与窗框", prefix + ":facade", vertices, faces,
                      ["glass", frame_style], indices, collection,
                      {**extras, "component": "facade", "detail_status": "illustrative repetition on source footprint"})

    def buildings(self):
        ordinary = self.collection("校园建筑")
        landmarks = self.collection("重点地标")
        platforms_collection = self.collection("基础与局部地台 · 独立于 DTM")
        for building in self.prepared["buildings"]:
            collection = self.collection(building["name"], landmarks if building["role"] in ("landmark", "gate") else ordinary)
            extras = {"feature_id": building["id"], "building_name": building["name"],
                      "role": building["role"], "confidence": building["confidence"],
                      "sources": building["sources"], "height_status": building["height_status"],
                      "units": "metres", "footprint_status": "supplied geographic footprint",
                      "footprint_wgs84": building["geometry_source"]}
            if building["base_parent_id"]:
                extras["base_parent_id"] = building["base_parent_id"]
                extras["base_parent_offset_m"] = building["base_parent_offset_m"]
            for part in building["parts"]:
                prefix = building["id"] + ":" + part["id"]
                base, roof_base = part["base_z_m"], part["base_z_m"] + part["height_m"]
                detail = part["detail"]
                roof_base -= float(detail.get("parapet_m", 0))
                roof, ridge = (lambda x, y, z=roof_base: z), None
                if detail.get("roof", "flat") == "pitched":
                    roof, ridge = pitched_profile(part["rings"], detail, roof_base)
                elif detail.get("roof", "flat") == "sloped":
                    roof = sloped_profile(part["rings"], detail, roof_base)
                    require(min(roof(*point) for ring in part["rings"] for point in ring) > base + .5,
                            "Roof slope cuts below building base")
                style = self.custom_style(prefix + ":wall-style", detail["wall_color"]) if detail.get("wall_color") else part["material_style"]
                roof_style = self.custom_style(prefix + ":roof-style", detail["roof_color"], .86) if detail.get("roof_color") else "roof"
                styles, wall_band = [style, roof_style], None
                if detail.get("base_wall_color"):
                    lower_style = self.custom_style(prefix + ":base-wall-style", detail["base_wall_color"])
                    band_height = float(detail.get("base_light_height_m", 5))
                    if min(roof(*point) for ring in part["rings"] for point in ring) > base + band_height + .1:
                        styles, wall_band = [style, lower_style, roof_style], base + band_height
                    else:
                        styles = [lower_style, roof_style]
                architectural = detail.get("facade_mode") in ("curtain", "recessed", "scattered_recessed")
                self.volume(building["name"] + " · 建筑体量", prefix + ":body", part["rings"],
                            lambda x, y, z=base: z, roof, styles, collection,
                            {**extras, "component": "body", "part_id": part["id"], "height_m": part["height_m"],
                             "part_footprint_wgs84": part["geometry_source"],
                             "detail_recipe": detail,
                             "levels": part["levels"], "base_z_m": base, "roof_style": detail.get("roof", "flat")},
                            ridge, wall_band, skip_walls=architectural)
                if part["foundation"]:
                    rings = [self.ground.ring(ring) for ring in part["rings"]]
                    lower = lambda x, y: self.ground.sample(x, y) - .20
                    self.volume(building["name"] + " · 接地基础", prefix + ":foundation", rings,
                                lower, lambda x, y, z=base: z, ["foundation"], collection,
                                {**extras, "component": "foundation", "ground_embed_m": .20, "base_z_m": base})
                    values = [self.ground.sample(x, y) for ring in rings for x, y in ring]
                    require(base >= max(values) - .02, "Building floor intersects DTM boundary")
                    self.foundation_checks.append({"asset_id": prefix + ":foundation", "base_z_m": base,
                        "ground_min_m": min(values), "ground_max_m": max(values),
                        "embed_m": .20, "sample_points": sum(len(ring) for ring in rings),
                        "lower_ring_points": [[x, y, lower(x, y)] for ring in rings for x, y in ring]})
                if architectural:
                    self.architectural_facade(building, part, collection, extras, prefix, roof, style)
                else:
                    self.windows(building, part, collection, extras, prefix, roof)
                self.roof_edge_details(building, part, collection, extras, prefix, roof, style)
            for index, platform in enumerate(building["platforms"]):
                self.volume(building["name"] + " · 局部地台", building["id"] + f":platform-{index}",
                            [self.ground.ring(ring) for ring in platform["rings"]],
                            lambda x, y: self.ground.sample(x, y) - .20,
                            lambda x, y, z=platform["top_z_m"]: z, ["walkway"], platforms_collection,
                            {**extras, "component": "platform", "raw_terrain_modified": False})

    def paths(self):
        collection = self.collection("道路与步道")
        for path in self.prepared["paths"]:
            if path.get("surface_patches"):
                vertices, faces = [], []
                for rings in path["surface_patches"]:
                    coordinates, triangles = triangulate(rings)
                    start = len(vertices)
                    vertices.extend([[x, y, self.ground.sample(x, y) + .15] for x, y in coordinates])
                    faces.extend([[start + i for i in triangle] for triangle in triangles])
                asset_id = "path:" + path["id"] + ":surface"
                self.mesh(path["name"], asset_id, vertices, faces,
                          [path["kind"] if path["kind"] in ("walkway", "water") else "road"],
                          [0] * len(faces), collection,
                          {"component": "water" if path["kind"] == "water" else "path", "path_kind": path["kind"],
                           "sources": path["sources"], "width_m": path["width_m"],
                           "drape_method": path["drape_method"], "terrain_clearance_m": .15})
                self.path_checks.append({"asset_id": asset_id, "terrain_clearance_m": .15,
                                         "source_terrain_triangle_patches": len(path["surface_patches"])})
                continue
            for index, line in enumerate(path["lines"]):
                require(len(line) >= 2, "Path line is too short")
                vertices, faces = [], []
                for i, point in enumerate(line):
                    prev, nxt = line[max(0, i - 1)], line[min(len(line) - 1, i + 1)]
                    length = math.dist(prev, nxt)
                    require(length > .01, "Duplicate path coordinates")
                    normal = (-(nxt[1] - prev[1]) / length, (nxt[0] - prev[0]) / length)
                    for sign in (-1, 1):
                        x, y = point[0] + sign * normal[0] * path["width_m"] / 2, point[1] + sign * normal[1] * path["width_m"] / 2
                        vertices.append([x, y, self.ground.sample(x, y) + .08])
                for i in range(len(line) - 1):
                    faces.append((i * 2, i * 2 + 2, i * 2 + 3, i * 2 + 1))
                self.mesh(path["name"], "path:" + path["id"] + f":{index}", vertices, faces,
                          [path["kind"] if path["kind"] in ("walkway", "water") else "road"], [0] * len(faces), collection,
                          {"component": "water" if path["kind"] == "water" else "path", "path_kind": path["kind"],
                           "sources": path["sources"], "width_m": path["width_m"]})

    def gate(self):
        """Reference-based entrance components, separate from the school-name rock."""
        from mathutils import Matrix, Vector
        spec = self.prepared.get("gate_model")
        if not spec:
            return
        bpy = self.bpy
        collection = self.collection("一号门 · 参考照片简模")
        centre, inward = spec["centre_xy"], spec["inward_xy"]
        across = (inward[1], -inward[0])

        def position(u, v):
            return [centre[0] + across[0] * u + inward[0] * v,
                    centre[1] + across[1] * u + inward[1] * v]

        width, depth = float(spec.get("canopy_width_m", 24)), float(spec.get("canopy_depth_m", 7))
        wall_width, wall_height = float(spec.get("wall_width_m", 8)), float(spec.get("wall_height_m", 9))
        thickness, canopy_height = float(spec.get("wall_thickness_m", .5)), float(spec.get("canopy_height_m", 3.4))
        require(width > 2 and depth > 1 and wall_width > 1 and wall_height > canopy_height and thickness > .1,
                "Invalid estimated gate dimensions")
        sign = 1 if spec.get("wall_side", "east") == "east" else -1
        wall_mid = sign * (width / 2 + wall_width / 2)
        canopy_ring = [position(u, v) for u, v in ((-width / 2, -depth / 2), (width / 2, -depth / 2),
                                                  (width / 2, depth / 2), (-width / 2, depth / 2))]
        wall_ring = [position(wall_mid - wall_width / 2 + wall_width * n / 16, -thickness / 2) for n in range(17)]
        wall_ring += [position(wall_mid + wall_width / 2 - wall_width * n / 16, thickness / 2) for n in range(17)]
        wall_ring = self.ground.ring(wall_ring)
        base = max(self.ground.sample(*point) for ring in (canopy_ring, wall_ring) for point in self.ground.ring(ring)) + .10
        stone = self.custom_style("gate1:stone", spec.get("stone_color", [.70, .70, .66]), .88)
        black = self.custom_style("gate1:canopy", spec.get("canopy_color", [.035, .045, .045]), .48, .15)
        extras = {"feature_id": "gate1", "building_name": "一号门", "role": "gate",
                  "confidence": "reference-photo geometry with estimated dimensions",
                  "sources": spec.get("sources", spec.get("source_url", "gate1-icm.jpg")),
                  "dimensions_status": "estimated from reference photographs; not surveyed",
                  "source_gate_spec": spec, "school_name_rock_included": False, "units": "metres"}

        def wall_top(x, y):
            u = (x - centre[0]) * across[0] + (y - centre[1]) * across[1]
            return base + wall_height - .45 * ((u - wall_mid) / (wall_width / 2)) ** 2

        self.volume("一号门 · 弧顶石材标志墙", "gate1:sign-wall", [wall_ring],
                    lambda x, y: self.ground.sample(x, y) - .20, wall_top, [stone], collection,
                    {**extras, "component": "gate-sign-wall"})
        wall_ground = [self.ground.sample(*point) for point in wall_ring]
        self.foundation_checks.append({"asset_id": "gate1:sign-wall", "base_z_m": base,
            "ground_min_m": min(wall_ground), "ground_max_m": max(wall_ground), "embed_m": .20,
            "sample_points": len(wall_ring),
            "lower_ring_points": [[x, y, self.ground.sample(x, y) - .20] for x, y in wall_ring]})
        self.volume("一号门 · 黑色水平雨棚", "gate1:canopy", [canopy_ring],
                    lambda x, y: base + canopy_height - .30, lambda x, y: base + canopy_height,
                    [black], collection, {**extras, "component": "gate-canopy"})
        for index, (u, v) in enumerate(((u, v) for u in (-width * .40, width * .40) for v in (-depth * .32, depth * .32))):
            x, y = position(u, v)
            ring = [[x + .14 * math.cos(n * math.tau / 12), y + .14 * math.sin(n * math.tau / 12)] for n in range(12)]
            self.volume("一号门 · 细柱", f"gate1:column-{index}", [ring],
                        lambda px, py: self.ground.sample(px, py) - .20,
                        lambda px, py: base + canopy_height - .29, [black], collection,
                        {**extras, "component": "gate-column"})
            ground_values = [self.ground.sample(*point) for point in ring]
            self.foundation_checks.append({"asset_id": f"gate1:column-{index}", "base_z_m": base,
                "ground_min_m": min(ground_values), "ground_max_m": max(ground_values), "embed_m": .20,
                "sample_points": len(ring),
                "lower_ring_points": [[px, py, self.ground.sample(px, py) - .20] for px, py in ring]})
        font_path = Path("C:/Windows/Fonts/msyh.ttc")
        curve = bpy.data.curves.new("一号门 · 南方科技大学竖排字", "FONT")
        curve.body, curve.size, curve.space_line = "南\n方\n科\n技\n大\n学", .76, 1.12
        curve.align_x, curve.align_y, curve.extrude = "CENTER", "BOTTOM", .008
        curve.resolution_u = 4
        if font_path.is_file():
            curve.font = bpy.data.fonts.load(str(font_path))
        curve.materials.append(self.material("frame"))
        text = bpy.data.objects.new("一号门 · 南方科技大学竖排字", curve)
        collection.objects.link(text)
        text.location = (*position(wall_mid, -thickness / 2 - .025), base + 1.8)
        text.rotation_euler = Matrix(((across[0], across[1], 0), (0, 0, 1), (-inward[0], -inward[1], 0))).transposed().to_euler()
        bpy.ops.object.select_all(action="DESELECT")
        text.select_set(True)
        bpy.context.view_layer.objects.active = text
        require(bpy.ops.object.convert(target="MESH") == {"FINISHED"}, "Gate lettering mesh conversion failed")
        text = bpy.context.view_layer.objects.active
        text["asset_id"], text["export_asset"] = "gate1:lettering", True
        for key, value in {**extras, "component": "gate-lettering",
                           "lettering_status": "Microsoft YaHei approximation; actual inscription typeface not replicated"}.items():
            text[key] = value if isinstance(value, (str, bool, float, int)) else json.dumps(value, ensure_ascii=False, sort_keys=True)


def aim(obj, point):
    from mathutils import Vector
    obj.rotation_euler = (Vector(point) - obj.location).to_track_quat("-Z", "Y").to_euler()


def camera_and_labels(builder):
    from mathutils import Vector
    bpy, prepared = builder.bpy, builder.prepared
    bpy.context.view_layer.update()
    scene = bpy.context.scene
    helpers = builder.collection("相机与照明")
    bodies = [obj for obj in scene.objects if obj.get("component") == "body"]
    points = [obj.matrix_world @ Vector(corner) for obj in bodies for corner in obj.bound_box]
    low, high = Vector([min(p[i] for p in points) for i in range(3)]), Vector([max(p[i] for p in points) for i in range(3)])
    centre, extent = (low + high) * .5, high - low
    render = prepared["site"].get("render", {})
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = int(render.get("width", 1600))
    scene.render.resolution_y = int(render.get("height", 1000))
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = True
    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (.55, .66, .74, 1)
    background.inputs["Strength"].default_value = .65
    sun_data = bpy.data.lights.new("校园日光", "SUN")
    sun_data.energy, sun_data.angle = 3.0, math.radians(5)
    sun = bpy.data.objects.new("校园日光", sun_data)
    helpers.objects.link(sun)
    sun.rotation_euler = [math.radians(x) for x in (32, -25, -32)]
    cameras = {}
    for name, direction, margin in ((CAMERAS[0], (.55, -.9, 1.05), 1.15), (CAMERAS[2], (.1, -.9, 1.3), 1.35)):
        data = bpy.data.cameras.new(name)
        obj = bpy.data.objects.new(name, data)
        helpers.objects.link(obj)
        obj.location = centre + Vector(direction).normalized() * max(extent.length, 100) * 1.8
        aim(obj, centre)
        data.type = "ORTHO"
        data.clip_start, data.clip_end = 5.0, 12000.0
        inv = obj.rotation_euler.to_matrix().transposed()
        view = [inv @ (point - centre) for point in points]
        width = max(p.x for p in view) - min(p.x for p in view)
        height = max(p.y for p in view) - min(p.y for p in view)
        data.ortho_scale = max(width, height * scene.render.resolution_x / scene.render.resolution_y) * margin
        cameras[name] = obj
    refs = prepared["camera_refs"]
    data = bpy.data.cameras.new(CAMERAS[1])
    gate = bpy.data.objects.new(CAMERAS[1], data)
    helpers.objects.link(gate)
    views = prepared["site"].get("camera_views", {})
    gate_spec = views.get("gate_inward", {})
    gate.location = (*refs["gate_xy"], refs["gate_ground_m"] + float(gate_spec.get("eye_height_m", 7)))
    aim(gate, (*refs["campus_xy"], refs["campus_ground_m"] + float(gate_spec.get("target_height_m", 18))))
    data.lens = float(gate_spec.get("lens_mm", 25))
    data.clip_start, data.clip_end = .5, 3000
    cameras[CAMERAS[1]] = gate
    labels = builder.collection("概览标签 · 不导出到 GLB")
    overview = cameras[CAMERAS[2]]
    font_path = Path("C:/Windows/Fonts/msyh.ttc")
    font = bpy.data.fonts.load(str(font_path)) if font_path.is_file() else None
    size = max(9, overview.data.ortho_scale * .009)
    for building in prepared["buildings"]:
        if building["id"] not in prepared["label_ids"]:
            continue
        curve = bpy.data.curves.new(building["name"] + " · 标签", "FONT")
        curve.body = prepared["label_text"].get(building["id"], building["label"])
        curve.size, curve.align_x, curve.align_y = size, "CENTER", "BOTTOM_BASELINE"
        if font:
            curve.font = font
        obj = bpy.data.objects.new(building["name"] + " · 标签", curve)
        labels.objects.link(obj)
        obj.location = (*building["centre_xy"], max(p["base_z_m"] + p["height_m"] for p in building["parts"]) + 12)
        obj.rotation_euler = overview.rotation_euler
        obj["export_asset"] = False
        curve.materials.append(builder.material("label"))
        bpy.context.view_layer.update()
        box = [Vector(p) for p in obj.bound_box]
        x0, x1 = min(p.x for p in box) - size * .25, max(p.x for p in box) + size * .25
        y0, y1 = min(p.y for p in box) - size * .20, max(p.y for p in box) + size * .20
        verts = [obj.matrix_world @ Vector((x, y, -.05)) for x, y in ((x0, y0), (x1, y0), (x1, y1), (x0, y1))]
        card = builder.mesh(building["name"] + " · 标签底板", "label:" + building["id"], verts,
                            [(0, 1, 2, 3)], ["label-background"], [0], labels,
                            {"component": "label"})
        card["export_asset"] = False
    labels.hide_render = True
    labels.hide_viewport = True
    scene.camera = cameras[CAMERAS[0]]
    scene.unit_settings.system, scene.unit_settings.scale_length = "METRIC", 1.0
    for screen in bpy.data.screens:
        for region in screen.areas:
            if region.type == "VIEW_3D":
                space = region.spaces.active
                space.clip_start, space.clip_end = 10.0, 12000.0
                space.shading.type, space.shading.color_type = "SOLID", "MATERIAL"
                space.shading.show_shadows, space.shading.show_cavity = False, False
                space.region_3d.view_perspective = "ORTHO"
                space.region_3d.view_location = centre
                space.region_3d.view_rotation = cameras[CAMERAS[0]].rotation_euler.to_quaternion()
                space.region_3d.view_distance = cameras[CAMERAS[0]].data.ortho_scale * .85
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = None
    return cameras, labels


def mesh_geometry_hash(obj):
    import numpy as np
    mesh = obj.data
    vertices = np.empty(len(mesh.vertices) * 3, dtype=np.float32)
    mesh.vertices.foreach_get("co", vertices)
    loops = np.empty(len(mesh.loops), dtype=np.int32)
    mesh.loops.foreach_get("vertex_index", loops)
    return hashlib.sha256(vertices.tobytes() + loops.tobytes()).hexdigest()


def material_state(material):
    node = material.node_tree.nodes.get("Principled BSDF") if material.use_nodes else None
    require(node is not None, "PBR material has no Principled shader")
    return {"base_colour": list(node.inputs["Base Color"].default_value),
            "roughness": float(node.inputs["Roughness"].default_value),
            "metallic": float(node.inputs["Metallic"].default_value)}


def json_property(value):
    if hasattr(value, "to_list"):
        return value.to_list()
    if hasattr(value, "to_dict"):
        return value.to_dict()
    return value


def snapshot(bpy):
    import numpy as np
    result = {}
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH" or not obj.get("export_asset", False):
            continue
        key = obj.get("asset_id")
        require(key and key not in result, "Missing or duplicate campus asset id")
        mesh = obj.data
        co = np.empty(len(mesh.vertices) * 3, dtype=np.float32)
        mesh.vertices.foreach_get("co", co)
        co = co.reshape(-1, 3)
        matrix = np.asarray([list(row) for row in obj.matrix_world])
        world = (np.c_[co, np.ones(len(co))] @ matrix.T)[:, :3]
        require(len(co) and np.isfinite(world).all(), "Empty/non-finite campus asset")
        mesh.calc_loop_triangles()
        triangles = np.asarray([list(t.vertices) for t in mesh.loop_triangles], dtype=np.int64)
        normals = np.cross(world[triangles[:, 1]] - world[triangles[:, 0]], world[triangles[:, 2]] - world[triangles[:, 0]])
        require((np.linalg.norm(normals, axis=1) > 1e-7).all(),
                f"Degenerate campus triangle: {key}; min double-area={np.linalg.norm(normals, axis=1).min():.9g}")
        uv = np.empty(len(mesh.loops) * 2, dtype=np.float32) if mesh.uv_layers else np.empty(0, dtype=np.float32)
        if mesh.uv_layers:
            mesh.uv_layers.active.data.foreach_get("uv", uv)
        require(np.isfinite(uv).all(), "Non-finite UV values")
        material_counts = [0] * len(mesh.materials)
        for triangle in mesh.loop_triangles:
            material_counts[mesh.polygons[triangle.polygon_index].material_index] += 1
        materials = [{**material_state(material), "triangles": count}
                     for material, count in zip(mesh.materials, material_counts) if count]
        materials.sort(key=lambda value: (*value["base_colour"], value["roughness"], value["metallic"], value["triangles"]))
        result[key] = {"name": obj.name, "vertices": len(co), "triangles": len(triangles),
                       "bounds_min_m": world.min(axis=0).tolist(), "bounds_max_m": world.max(axis=0).tolist(),
                       "geometry_sha256": mesh_geometry_hash(obj),
                       "uv_sha256": hashlib.sha256(uv.tobytes()).hexdigest(),
                       "uv_layers": len(mesh.uv_layers), "materials": materials,
                       "source_properties": {k: json_property(v) for k, v in obj.items() if k != "_RNA_UI"},
                       "all_coordinates_finite": True, "nondegenerate_triangles": True}
    require(result, "Campus scene has no export assets")
    return result


def compare_snapshots(expected, actual, exact=False):
    require(set(expected) == set(actual), "Campus assets missing or added")
    for key, a in expected.items():
        b = actual[key]
        require(a["triangles"] == b["triangles"], f"Triangle count changed: {key}")
        require(a["source_properties"] == b["source_properties"], f"Source properties changed: {key}")
        for field in ("bounds_min_m", "bounds_max_m"):
            require(max(abs(x - y) for x, y in zip(a[field], b[field])) < .003, f"World bounds changed: {key}")
        require(len(a["materials"]) == len(b["materials"]), f"Material count changed: {key}")
        for x, y in zip(a["materials"], b["materials"]):
            require(max(abs(c - d) for c, d in zip(x["base_colour"], y["base_colour"])) < 1e-6 and
                    abs(x["roughness"] - y["roughness"]) < 1e-6 and abs(x["metallic"] - y["metallic"]) < 1e-6 and
                    x["triangles"] == y["triangles"],
                    f"PBR values changed: {key}")
        require(a["uv_layers"] == b["uv_layers"], f"UV layer count changed: {key}")
        if exact:
            require(a["geometry_sha256"] == b["geometry_sha256"] and a["uv_sha256"] == b["uv_sha256"],
                    f"Geometry/UV changed during save/reopen: {key}")


def check_foundations(bpy, foundation_checks):
    import numpy as np
    objects = {obj.get("asset_id"): obj for obj in bpy.context.scene.objects if obj.type == "MESH"}
    maximum_error = 0.0
    total = 0
    for check in foundation_checks:
        obj = objects[check["asset_id"]]
        co = np.empty(len(obj.data.vertices) * 3, dtype=np.float32)
        obj.data.vertices.foreach_get("co", co)
        matrix = np.asarray([list(row) for row in obj.matrix_world])
        points = (np.c_[co.reshape(-1, 3), np.ones(len(co) // 3)] @ matrix.T)[:, :3]
        lookup = {}
        for x, y, z in points:
            key = (round(x * 100), round(y * 100))
            lookup.setdefault(key, []).append((float(x), float(y), float(z)))
        for x, y, z in check["lower_ring_points"]:
            key = (round(x * 100), round(y * 100))
            candidates = [point for dx in (-1, 0, 1) for dy in (-1, 0, 1)
                          for point in lookup.get((key[0] + dx, key[1] + dy), [])]
            require(candidates, "Foundation ground contact sample missing")
            distance = min(math.hypot(px - x, py - y) for px, py, _ in candidates)
            require(distance < .003, "Foundation XY contact moved")
            # Quantisation buckets only find candidates; a neighbouring source
            # point on a steep edge must not become this point's ground height.
            matching_z = [pz for px, py, pz in candidates if math.hypot(px - x, py - y) < distance + .0005]
            error = abs(min(matching_z) - z)
            require(error < .003, "Foundation no longer follows DTM")
            maximum_error = max(maximum_error, error)
            total += 1
    return {"foundation_objects": len(foundation_checks), "ground_contact_samples": total,
            "maximum_ground_contact_error_m": maximum_error, "ground_embed_m": .20,
            "floors_at_or_above_sampled_dtm": True, "raw_dtm_geometry_preserved": True}


def check_path_clearance(bpy, prepared, expected):
    """Verify actual saved mesh triangle interiors, not just source vertices."""
    from mathutils import Vector
    ground = ground_from_prepared(prepared)
    objects = {obj.get("asset_id"): obj for obj in bpy.context.scene.objects if obj.type == "MESH"}
    reports = []
    for item in expected:
        obj = objects[item["asset_id"]]
        obj.data.calc_loop_triangles()
        low, high, count = math.inf, -math.inf, 0
        for triangle in obj.data.loop_triangles:
            points = [obj.matrix_world @ obj.data.vertices[i].co for i in triangle.vertices]
            samples = points + [sum(points, Vector()) / 3]
            samples.extend((points[n] + points[(n + 1) % 3]) / 2 for n in range(3))
            for point in samples:
                clearance = float(point.z) - ground.sample(float(point.x), float(point.y))
                low, high = min(low, clearance), max(high, clearance)
                count += 1
        require(count and low > .08 and abs(low - .15) < .003 and abs(high - .15) < .003,
                f"Path penetrates or leaves exact DTM plane: {item['asset_id']}: {low:.6f}..{high:.6f}")
        reports.append({**item, "rendered_triangle_samples": count,
                        "minimum_ground_clearance_m": low, "maximum_ground_clearance_m": high,
                        "all_triangle_centroids_edge_midpoints_vertices_clear": True})
    return {"path_objects": len(reports), "reports": reports,
            "rendered_triangle_sample_count": sum(item["rendered_triangle_samples"] for item in reports),
            "all_paths_follow_original_dtm_triangles": True}


def glb_check(expected):
    data = GLB.read_bytes()
    require(len(data) >= 20, "Campus GLB is too short")
    magic, version, length = struct.unpack_from("<4sII", data)
    require(magic == b"glTF" and version == 2 and length == len(data), "Invalid campus GLB")
    size, kind = struct.unpack_from("<II", data, 12)
    require(kind == 0x4E4F534A, "GLB JSON chunk missing")
    document = json.loads(data[20:20 + size])
    require(all("uri" not in b for b in document.get("buffers", [])), "GLB external buffer dependency")
    require(not document.get("images"), "Unexpected campus texture dependency")
    nodes = {n.get("extras", {}).get("asset_id"): n for n in document.get("nodes", []) if "mesh" in n}
    require(set(nodes) == set(expected), "GLB lost an exported campus object")
    for asset_id, state in expected.items():
        node = nodes[asset_id]
        require(node.get("extras") == state["source_properties"], f"GLB source attribution changed: {asset_id}")
        primitives = document["meshes"][node["mesh"]]["primitives"]
        triangles = sum(document["accessors"][p["indices"]]["count"] // 3 for p in primitives)
        require(triangles == state["triangles"], f"GLB triangles changed: {asset_id}")
        require(all(p.get("mode", 4) == 4 for p in primitives), "GLB contains non-triangle primitives")
    return {"version": 2, "mesh_nodes": len(nodes), "triangles": sum(s["triangles"] for s in expected.values()),
            "self_contained": True, "all_asset_ids_sources_and_triangle_counts_verified": True}


def render_views(bpy, prepared):
    import numpy as np
    scene = bpy.context.scene
    labels = bpy.data.collections.get("概览标签 · 不导出到 GLB")
    reports = []
    for name in CAMERAS:
        scene.camera = bpy.data.objects[name]
        if labels:
            labels.hide_render = name != CAMERAS[2]
        path = OUT / (name + ".png")
        scene.render.filepath = str(path)
        started = time.perf_counter()
        require(bpy.ops.render.render(write_still=True) == {"FINISHED"}, "Campus render failed")
        image = bpy.data.images.load(str(path), check_existing=False)
        width, height = scene.render.resolution_x, scene.render.resolution_y
        require(tuple(image.size) == (width, height), "Campus PNG size mismatch")
        pixels = np.empty(width * height * 4, dtype=np.float32)
        image.pixels.foreach_get(pixels)
        pixels = pixels.reshape(-1, 4)
        require(np.isfinite(pixels).all(), "PNG contains non-finite pixels")
        foreground = pixels[:, 3] > .5
        coverage = float(foreground.mean())
        deviation = float(pixels[foreground, :3].std()) if foreground.any() else 0.0
        require(coverage > .10 and deviation > .006, "Campus view is blank or camera misses the scene")
        reports.append({"camera": name, "png": record(path), "size_px": [width, height],
                        "seconds": round(time.perf_counter() - started, 3), "foreground_fraction": coverage,
                        "foreground_rgb_std": deviation, "labels_visible": name == CAMERAS[2]})
    return reports


def stage_main(stage):
    import bpy
    prepared = json.loads(PREPARED.read_text(encoding="utf-8"))
    for key in ("blend", "metadata", "npy"):
        source = prepared["terrain"][key]
        require(record(ROOT / source["path"])["sha256"] == source["sha256"], "Original terrain source changed")
    report = {"stage": stage, "started_at": stamp(), "blender_version": bpy.app.version_string,
              "python_version": sys.version, "background": bpy.app.background, "prepared_input": record(PREPARED)}
    started = time.perf_counter()
    bpy.ops.preferences.addon_enable(module="io_scene_gltf2")
    if stage == "build-save":
        require(bpy.ops.wm.open_mainfile(filepath=str(ROOT / prepared["terrain"]["blend"]["path"]),
                    load_ui=False, use_scripts=False) == {"FINISHED"}, "Campus DTM BLEND load failed")
        meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
        require(len(meshes) == 1, "Expected one original campus terrain mesh")
        terrain = meshes[0]
        original_geometry = mesh_geometry_hash(terrain)
        for obj in list(bpy.context.scene.objects):
            if obj != terrain:
                bpy.data.objects.remove(obj, do_unlink=True)
        builder = Builder(bpy, prepared)
        collection = builder.collection("地形 · 原始 DTM")
        for owner in list(terrain.users_collection):
            owner.objects.unlink(terrain)
        collection.objects.link(terrain)
        terrain.name = "南科大 · 原始预测裸地 DTM"
        terrain["asset_id"], terrain["export_asset"], terrain["component"] = "terrain:campus", True, "terrain"
        terrain["raw_geometry_preserved"] = True
        terrain.data.materials.clear()
        terrain.data.materials.append(builder.material("terrain"))
        builder.buildings()
        builder.paths()
        builder.gate()
        camera_and_labels(builder)
        require(mesh_geometry_hash(terrain) == original_geometry, "Original campus DTM geometry modified")
        states = snapshot(bpy)
        building_ids = {s["source_properties"].get("feature_id") for s in states.values()
                        if s["source_properties"].get("component") == "body"}
        require(building_ids == {b["id"] for b in prepared["buildings"]}, "Dataset building not represented")
        report["assets"] = states
        report["foundations"] = builder.foundation_checks
        report["ground_alignment"] = check_foundations(bpy, builder.foundation_checks)
        report["path_alignment"] = check_path_clearance(bpy, prepared, builder.path_checks)
        report["path_checks"] = builder.path_checks
        report["original_terrain_geometry_sha256"] = original_geometry
        report["building_features"] = len(prepared["buildings"])
        report["object_budget"] = {"mesh_export_objects": len(states), "window_micro_objects": 0,
                                   "facades_aggregated_per_building_part": True}
        bpy.context.scene["campus_model_sources"] = prepared["source_config"]["path"]
        bpy.context.scene["campus_model_limits"] = json.dumps(prepared["limits"], ensure_ascii=False)
        bpy.context.preferences.filepaths.save_version = 0
        bpy.ops.file.pack_all()
        require(bpy.ops.wm.save_as_mainfile(filepath=str(BLEND), check_existing=False) == {"FINISHED"}, "Campus BLEND save failed")
        report["blend"] = record(BLEND)
    elif stage == "reopen-export-render":
        require(bpy.ops.wm.open_mainfile(filepath=str(BLEND), load_ui=False, use_scripts=False) == {"FINISHED"}, "Campus BLEND reopen failed")
        original = json.loads((OUT / "reports/build-save.json").read_text(encoding="utf-8"))
        states = snapshot(bpy)
        compare_snapshots(original["assets"], states, exact=True)
        report["save_reopen_geometry_uv_pbr_and_sources_exact"] = True
        report["ground_alignment"] = check_foundations(bpy, original["foundations"])
        report["path_alignment"] = check_path_clearance(bpy, prepared, original.get("path_checks", []))
        bpy.ops.object.select_all(action="DESELECT")
        for obj in bpy.context.scene.objects:
            if obj.type == "MESH" and obj.get("export_asset", False):
                obj.select_set(True)
                bpy.context.view_layer.objects.active = obj
        require(bpy.ops.export_scene.gltf(filepath=str(GLB), export_format="GLB", use_selection=True,
                    export_yup=True, export_apply=False, export_extras=True, export_cameras=False,
                    export_lights=False, export_materials="EXPORT", export_copyright=prepared["copyright"]) == {"FINISHED"},
                "Campus GLB export failed")
        report["glb_check"] = glb_check(states)
        report["glb"] = record(GLB)
        report["renders"] = render_views(bpy, prepared)
        report["assets"] = states
    elif stage == "glb-roundtrip":
        bpy.ops.object.select_all(action="SELECT")
        bpy.ops.object.delete(use_global=False)
        require(bpy.ops.import_scene.gltf(filepath=str(GLB)) == {"FINISHED"}, "Campus GLB reimport failed")
        original = json.loads((OUT / "reports/build-save.json").read_text(encoding="utf-8"))
        states = snapshot(bpy)
        compare_snapshots(original["assets"], states)
        report["all_asset_counts_bounds_pbr_and_sources_preserved"] = True
        report["ground_alignment"] = check_foundations(bpy, original["foundations"])
        report["path_alignment"] = check_path_clearance(bpy, prepared, original.get("path_checks", []))
        report["glb_check"] = glb_check(original["assets"])
        report["assets"] = states
    else:
        raise RuntimeError("Unknown campus build stage")
    report["status"], report["finished_at"] = "passed", stamp()
    report["elapsed_seconds"] = round(time.perf_counter() - started, 3)
    write_json(OUT / "reports" / (stage + ".json"), report)
    print("CAMPUS_MODEL_STAGE=" + json.dumps({"stage": stage, "status": "passed"}), flush=True)


def driver(config_path, blender, prepare_only=False):
    started = time.perf_counter()
    prepared = prepare(config_path)
    if prepare_only:
        print(f"Prepared {len(prepared['buildings'])} source-labelled campus buildings; Blender not launched.")
        return
    executable = Path(blender)
    require(executable.is_file(), "Installed Blender executable missing")
    LOGS.mkdir(parents=True, exist_ok=True)
    manifest_path = DOCS / "build-validation.json"
    manifest = {"schema_version": 1, "status": "running", "started_at": stamp(), "timezone": "Asia/Shanghai",
                "input": record(config_path), "prepared": record(PREPARED), "terrain_sources": prepared["terrain"],
                "building_features": len(prepared["buildings"]), "blender_executable": str(executable),
                "original_dtm_modified": False, "website_modified": False,
                "limits": prepared["limits"], "stages": [], "outputs": []}
    write_json(manifest_path, manifest)
    for stage in STAGES:
        log = LOGS / (stage + ".log")
        command = [str(executable), "--background", "--factory-startup", "--python-exit-code", "1",
                   "--python", str(Path(__file__).resolve()), "--", "--stage", stage,
                   "--output-dir", relative(OUT), "--docs-dir", relative(DOCS), "--model-stem", BLEND.stem]
        print("START campus: " + stage, flush=True)
        stage_start = time.perf_counter()
        try:
            with log.open("w", encoding="utf-8") as stream:
                process = subprocess.run(command, cwd=ROOT, stdout=stream, stderr=subprocess.STDOUT, timeout=900, check=False)
            require(process.returncode == 0, f"Campus Blender stage failed: {stage}; see {relative(log)}")
            report_path = OUT / "reports" / (stage + ".json")
            report = json.loads(report_path.read_text(encoding="utf-8"))
            require(report["status"] == "passed", "Campus stage report did not pass")
            manifest["stages"].append({"stage": stage, "return_code": 0, "fresh_blender_process": True,
                                       "elapsed_seconds": round(time.perf_counter() - stage_start, 3),
                                       "report": record(report_path), "log": relative(log)})
            write_json(manifest_path, manifest)
            print("PASS campus: " + stage, flush=True)
        except Exception as error:
            manifest["status"], manifest["failure"] = "failed", {"stage": stage, "message": str(error), "log": relative(log)}
            write_json(manifest_path, manifest)
            if log.is_file():
                print(log.read_text(encoding="utf-8", errors="replace")[-8000:], flush=True)
            raise
    manifest["blender_version"] = report["blender_version"]
    for path in (BLEND, GLB, PREPARED, *(OUT / (name + ".png") for name in CAMERAS),
                 *(OUT / "reports" / (stage + ".json") for stage in STAGES)):
        manifest["outputs"].append(record(path))
    manifest["status"], manifest["finished_at"] = "passed", stamp()
    manifest["elapsed_seconds"] = round(time.perf_counter() - started, 3)
    write_json(manifest_path, manifest)
    print("CAMPUS MODEL BUILD AND VALIDATION PASSED", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default=str(CONFIG))
    parser.add_argument("--blender", default="D:/blender/blender.exe")
    parser.add_argument("--prepare-only", action="store_true")
    parser.add_argument("--stage", choices=STAGES)
    parser.add_argument("--output-dir", default="output/campus-model")
    parser.add_argument("--docs-dir", default="docs/campus-model")
    parser.add_argument("--model-stem", default="sustech_campus")
    arguments = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    args = parser.parse_args(arguments)
    configure_outputs(args.output_dir, args.docs_dir, args.model_stem)
    if args.stage:
        stage_main(args.stage)
    else:
        driver(Path(args.config), args.blender, args.prepare_only)
