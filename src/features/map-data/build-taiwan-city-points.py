"""Reduce official NLSC county/city boundaries to offline representative points.

Uses only the Python standard library. No downloaded boundary archive is retained.
Run this script before build-city-catalog.mjs when refreshing Taiwan data.
"""

import hashlib
import io
import json
from pathlib import Path
import struct
import sys
from urllib.request import urlopen, Request
from urllib.parse import quote
import zipfile


SOURCE_URL = "https://maps.nlsc.gov.tw/download/縣市界線(TWD97經緯度).zip"
OUTPUT = Path(__file__).resolve().parent / "taiwan-city-points.json"


def read_dbf(raw, encoding):
    record_count = struct.unpack_from("<I", raw, 4)[0]
    header_size, record_size = struct.unpack_from("<HH", raw, 8)
    fields = []
    offset = 32
    while raw[offset] != 13:
        descriptor = raw[offset:offset + 32]
        name = descriptor[:11].split(b"\0")[0].decode("ascii")
        fields.append((name, descriptor[16]))
        offset += 32
    rows = []
    for index in range(record_count):
        start = header_size + index * record_size
        if raw[start:start + 1] == b"*":
            raise ValueError("Unexpected deleted DBF record")
        cursor = start + 1
        row = {}
        for name, size in fields:
            row[name] = raw[cursor:cursor + size].strip(b" \0").decode(encoding)
            cursor += size
        rows.append(row)
    return rows


def read_shp(raw):
    if struct.unpack_from(">I", raw, 0)[0] != 9994:
        raise ValueError("Not a shapefile")
    rows = []
    offset = 100
    while offset < len(raw):
        size = struct.unpack_from(">I", raw, offset + 4)[0] * 2
        record = raw[offset + 8:offset + 8 + size]
        if struct.unpack_from("<I", record, 0)[0] != 5:
            raise ValueError("Expected 2D polygon shapefile records")
        part_count, point_count = struct.unpack_from("<II", record, 36)
        parts = list(struct.unpack_from(f"<{part_count}I", record, 44)) + [point_count]
        points_start = 44 + part_count * 4
        points = [struct.unpack_from("<dd", record, points_start + index * 16) for index in range(point_count)]
        rows.append([points[parts[index]:parts[index + 1]] for index in range(part_count)])
        offset += 8 + size
    return rows


def ring_centroid(ring):
    area = x_weight = y_weight = 0.0
    for point, following in zip(ring, ring[1:] + ring[:1]):
        weight = point[0] * following[1] - following[0] * point[1]
        area += weight
        x_weight += (point[0] + following[0]) * weight
        y_weight += (point[1] + following[1]) * weight
    if abs(area) < 1e-12:
        raise ValueError("Degenerate polygon")
    return area / 2, (x_weight / (3 * area), y_weight / (3 * area))


def point_inside(point, ring):
    x, y = point
    inside = False
    for first, second in zip(ring, ring[1:] + ring[:1]):
        if (first[1] > y) != (second[1] > y):
            crossing = first[0] + (y - first[1]) * (second[0] - first[0]) / (second[1] - first[1])
            if x < crossing:
                inside = not inside
    return inside


def representative_point(rings):
    # Choose the largest ring: detached small islands must not pull the point offshore.
    ring = max(rings, key=lambda candidate: abs(ring_centroid(candidate)[0]))
    _, center = ring_centroid(ring)
    if point_inside(center, ring):
        return center, "largest-ring-centroid"
    # Concave county boundaries can have an exterior centroid. Select the midpoint
    # of the widest interior interval along its latitude instead.
    latitude = center[1]
    intersections = []
    for first, second in zip(ring, ring[1:] + ring[:1]):
        if (first[1] > latitude) != (second[1] > latitude):
            intersections.append(first[0] + (latitude - first[1]) * (second[0] - first[0]) / (second[1] - first[1]))
    intersections.sort()
    intervals = list(zip(intersections[::2], intersections[1::2]))
    if not intervals:
        raise ValueError("Cannot find polygon interior representative point")
    left, right = max(intervals, key=lambda interval: interval[1] - interval[0])
    point = ((left + right) / 2, latitude)
    if not point_inside(point, ring):
        raise ValueError("Representative point is outside polygon")
    return point, "largest-ring-interior-scanline"


if len(sys.argv) == 3 and sys.argv[1] == "--archive":
    # Allows an archive downloaded with the platform's trusted TLS client.
    archive_bytes = Path(sys.argv[2]).read_bytes()
else:
    request = Request(quote(SOURCE_URL, safe=":/()"), headers={"User-Agent": "Chuanheng-offline-city-catalog/1.0"})
    with urlopen(request, timeout=60) as response:
        archive_bytes = response.read()
with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
    shp_name = next(name for name in archive.namelist() if name.lower().endswith(".shp"))
    basename = shp_name[:-4]
    cpg_name = next((name for name in archive.namelist() if name.lower() == f"{basename}.cpg".lower()), None)
    encoding = archive.read(cpg_name).decode("ascii").strip() if cpg_name else "big5"
    if encoding == "950":
        encoding = "big5"
    dbf_name = next(name for name in archive.namelist() if name.lower() == f"{basename}.dbf".lower())
    metadata = read_dbf(archive.read(dbf_name), encoding)
    geometry = read_shp(archive.read(shp_name))
    prj_name = next(name for name in archive.namelist() if name.lower() == f"{basename}.prj".lower())
    projection = archive.read(prj_name).decode("ascii").strip()
    if not any(name in projection for name in ("TWD97", "TWD_1997")) or "GEOGCS" not in projection or "PROJCS" in projection:
        raise ValueError("Expected TWD97 geographic longitude/latitude source")
if len(metadata) != len(geometry) or len(metadata) != 22:
    raise ValueError(f"Expected 22 matched county/city polygons; got {len(metadata)}, {len(geometry)}")
points = []
for properties, rings in zip(metadata, geometry):
    point, method = representative_point(rings)
    points.append({
        "countyCode": properties["COUNTYCODE"],
        "countyName": properties["COUNTYNAME"],
        "longitude": round(point[0], 6),
        "latitude": round(point[1], 6),
        "method": method,
    })
points.sort(key=lambda point: point["countyCode"])
snapshot = {
    "retrievedDate": "2026-10-05",
    "url": SOURCE_URL,
    "sha256": hashlib.sha256(archive_bytes).hexdigest(),
    "bytes": len(archive_bytes),
    "provider": "內政部國土測繪中心 (NLSC)",
    "license": "政府資料開放授權條款－第1版",
    "coordinateSystem": "TWD97 geographic longitude/latitude (EPSG:3824)",
    "sourceFile": shp_name,
    "projection": projection,
    "features": points,
}
OUTPUT.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"Generated {len(points)} Taiwan county/city representative points.")
