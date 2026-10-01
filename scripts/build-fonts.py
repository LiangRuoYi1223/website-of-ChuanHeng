"""Reproduce local WOFF2 shards from pinned official open-source fonts.

Build-only requirements: fonttools[woff]==4.59.2. No website runtime dependency.
Run with --download-only to fetch and inspect upstream files, otherwise build.
"""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import argparse
import hashlib
import json
import logging
import sys
import urllib.request

PROJECT = Path(__file__).resolve().parent.parent
ROOT = PROJECT / "public" / "fonts"
CACHE = PROJECT / "artifacts" / "runtime" / "fonts"
if (CACHE / "_build-tools").exists():
    sys.path.insert(0, str(CACHE / "_build-tools"))

SOURCES = [
    {
        "key": "source-han-sans-cn", "family": "Chuanheng Han Sans CN", "upstream_family": "Source Han Sans CN", "weight": "400 700",
        "version": "2.005", "repo": "adobe-fonts/source-han-sans",
        "commit": "a4f7cf94edfb9d7ffbdfc4841de276358bd7e0f2",
        "file": "Variable/WOFF2/TTF/Subset/SourceHanSansCN-VF.ttf.woff2",
        "license": "LICENSE.txt", "license_name": "Source-Han-Sans-OFL.txt",
    },
    {
        "key": "source-han-serif-sc", "family": "Chuanheng Han Serif SC", "upstream_family": "Source Han Serif SC", "weight": "400 500",
        "version": "2.003", "repo": "adobe-fonts/source-han-serif",
        "commit": "7889f11bf31170b5d092a083b357c8c8130f89e0",
        "file": "Variable/WOFF2/TTF/SourceHanSerifSC-VF.ttf.woff2",
        "license": "LICENSE.txt", "license_name": "Source-Han-Serif-OFL.txt",
    },
    {
        "key": "dm-sans", "family": "DM Sans", "upstream_family": "DM Sans", "weight": "400 700",
        "version": "official Google Fonts variable release", "repo": "google/fonts",
        "commit": "9710da1eacb3be272583c3224dcb70f9da6eadbb",
        "file": "ofl/dmsans/DMSans%5Bopsz,wght%5D.ttf",
        "license": "ofl/dmsans/OFL.txt", "license_name": "DM-Sans-OFL.txt",
    },
]


def upstream_url(source, path):
    return f"https://raw.githubusercontent.com/{source['repo']}/{source['commit']}/{path}"


def fetch(url, destination):
    if destination.exists():
        return
    request = urllib.request.Request(url, headers={"User-Agent": "Chuanheng-local-font-build/1.0"})
    with urllib.request.urlopen(request, timeout=120) as response:
        data = response.read()
    destination.write_bytes(data)
    print(f"Downloaded {destination.name}: {len(data):,} bytes", flush=True)


def download_sources():
    (CACHE / "_sources").mkdir(parents=True, exist_ok=True)
    tasks = []
    for source in SOURCES:
        source["source_url"] = upstream_url(source, source["file"])
        source["license_url"] = upstream_url(source, source["license"])
        source["source_path"] = CACHE / "_sources" / (source["key"] + (".ttf" if source["key"] == "dm-sans" else ".woff2"))
        tasks.extend([(source["source_url"], source["source_path"]), (source["license_url"], ROOT / source["license_name"])])
    with ThreadPoolExecutor(max_workers=4) as executor:
        list(executor.map(lambda item: fetch(*item), tasks))


def unicode_range(codepoints):
    points = sorted(codepoints)
    ranges = []
    if not points:
        return ""
    start = last = points[0]
    for point in points[1:]:
        if point == last + 1:
            last = point
        else:
            ranges.append(f"U+{start:X}" if start == last else f"U+{start:X}-{last:X}")
            start = last = point
    ranges.append(f"U+{start:X}" if start == last else f"U+{start:X}-{last:X}")
    return ",".join(ranges)


def inspect_source(source):
    from fontTools.ttLib import TTFont
    with TTFont(source["source_path"]) as font:
        names = {str(key): font["name"].getDebugName(key) for key in [1, 2, 4, 5, 6, 16, 17]}
        axes = [{"tag": axis.axisTag, "min": axis.minValue, "default": axis.defaultValue, "max": axis.maxValue} for axis in font["fvar"].axes]
        print(json.dumps({"font": source["key"], "names": names, "axes": axes, "mapped_codepoints": len(font.getBestCmap())}, ensure_ascii=False), flush=True)


def rename_modified_font(font, source):
    if source["key"] == "dm-sans":
        return False
    # Source is an Adobe Reserved Font Name. Rename derivative family/PS/unique
    # names while retaining copyright, trademark, license and upstream metadata.
    changed = False
    for record in font["name"].names:
        if record.nameID not in {1, 3, 4, 6, 16, 18, 20, 21, 25} and record.nameID < 256:
            continue
        original = record.toUnicode()
        value = original.replace("Source Han", "Chuanheng Han").replace("SourceHan", "ChuanhengHan").replace("思源黑体", "川衡网页黑体").replace("思源宋体", "川衡网页宋体")
        changed = changed or value != original
        record.string = value.encode(record.getEncoding(), errors="replace")
    return changed


def build():
    from fontTools.ttLib import TTFont
    from fontTools import subset
    import fontTools
    logging.getLogger("fontTools").setLevel(logging.ERROR)
    # Common content is a first-load optimization only. All other source codepoints
    # remain available in separate shards, so future copy needs no font rebuild.
    common = set(range(0x20, 0x100))
    for extension in ["*.tsx", "*.ts"]:
        for path in (PROJECT / "src").rglob(extension):
            common.update(map(ord, path.read_text(encoding="utf-8")))
    css = ["/* Local official open-source web fonts. See public/fonts/SOURCE.md. */\n"]
    manifest = {"generator": f"fontTools {fontTools.__version__}", "chunk_unicode_block_size": 512, "fonts": []}
    for source in SOURCES:
        directory = ROOT / source["key"]
        directory.mkdir(exist_ok=True)
        raw_path = CACHE / "_sources" / (source["key"] + "-decoded.ttf")
        with TTFont(source["source_path"]) as upstream:
            original_cmap = upstream.getBestCmap()
            all_points = set(original_cmap)
            version = upstream["name"].getDebugName(5)
            source_names = {str(key): upstream["name"].getDebugName(key) for key in [1, 2, 4, 5, 6, 16, 17]}
            axes = [{"tag": axis.axisTag, "min": axis.minValue, "default": axis.defaultValue, "max": axis.maxValue} for axis in upstream["fvar"].axes]
            if not raw_path.exists():
                upstream.flavor = None
                upstream.save(raw_path)
        if source["key"] == "dm-sans":
            groups = [("full", all_points)]
        else:
            core_points = all_points & common
            groups = [("core", core_points)]
            remaining = all_points - core_points
            for block in sorted({point // 512 for point in remaining}):
                points = {point for point in remaining if point // 512 == block}
                groups.append((f"u{block * 512:05x}", points))
        covered = set()
        shards = []
        for index, (name, points) in enumerate(groups):
            file_name = f"{source['key']}-{name}.woff2"
            destination = directory / file_name
            with TTFont(raw_path, lazy=True) as font:
                options = subset.Options()
                options.flavor = "woff2"
                options.name_IDs = ["*"]
                options.name_legacy = True
                options.name_languages = ["*"]
                options.layout_features = ["*"]
                options.notdef_glyph = True
                options.notdef_outline = True
                options.recommended_glyphs = True
                options.recalc_timestamp = False
                subsetter = subset.Subsetter(options=options)
                subsetter.populate(unicodes=points)
                subsetter.subset(font)
                rename_modified_font(font, source)
                font.flavor = "woff2"
                font.save(destination)
            with TTFont(destination) as result:
                actual = set(result.getBestCmap())
                if actual != points:
                    raise RuntimeError(f"Character coverage mismatch in {file_name}")
                if "fvar" not in result:
                    raise RuntimeError(f"Weight axis missing in {file_name}")
            covered.update(actual)
            relative = f"{source['key']}/{file_name}"
            ranges = unicode_range(points)
            css.append(f"@font-face {{\n  font-family: '{source['family']}';\n  font-style: normal;\n  font-weight: {source['weight']};\n  font-display: swap;\n  src: url('/fonts/{relative}') format('woff2');\n  unicode-range: {ranges};\n}}\n")
            shards.append({"file": relative, "bytes": destination.stat().st_size, "codepoints": len(points), "unicode_range": ranges, "sha256": hashlib.sha256(destination.read_bytes()).hexdigest()})
            print(f"{source['key']}: {index + 1}/{len(groups)} {name} {destination.stat().st_size:,} bytes", flush=True)
        if covered != all_points:
            raise RuntimeError(f"Coverage lost for {source['family']}")
        manifest["fonts"].append({"family": source["family"], "upstream_family": source["upstream_family"], "weight": source["weight"], "source_url": source["source_url"], "license_url": source["license_url"], "source_version": version, "source_names": source_names, "source_sha256": hashlib.sha256(source["source_path"].read_bytes()).hexdigest(), "axes": axes, "original_codepoints": len(all_points), "output_codepoints": len(covered), "coverage_equal": True, "shards": shards})
    (PROJECT / "src" / "fonts.css").write_text("\n".join(css), encoding="utf-8")
    (ROOT / "MANIFEST.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("All font coverage verified; src/fonts.css written.", flush=True)


def verify_and_repair_metadata():
    from fontTools.ttLib import TTFont
    manifest_path = ROOT / "MANIFEST.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    for font_record, source in zip(manifest["fonts"], SOURCES):
        coverage = set()
        for shard in font_record["shards"]:
            path = ROOT / shard["file"]
            with TTFont(path, lazy=True, recalcBBoxes=False, recalcTimestamp=False) as font:
                if rename_modified_font(font, source):
                    font.save(path)
            with TTFont(path, lazy=True) as font:
                coverage.update(font.getBestCmap())
                for name in font["name"].names:
                    if (name.nameID in {1, 3, 4, 6, 16, 18, 20, 21, 25} or name.nameID >= 256) and "Source" in name.toUnicode():
                        raise RuntimeError(f"Reserved font name remains in {path.name}")
                if "fvar" not in font:
                    raise RuntimeError(f"Real variable axes missing in {path.name}")
            shard["bytes"] = path.stat().st_size
            shard["sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
        with TTFont(source["source_path"]) as original:
            if coverage != set(original.getBestCmap()):
                raise RuntimeError(f"Coverage mismatch in {source['family']}")
        font_record["coverage_equal"] = True
        font_record["renamed_metadata_verified"] = True
        font_record["total_woff2_bytes"] = sum(shard["bytes"] for shard in font_record["shards"])
        print(f"Verified {source['family']}: {len(coverage):,} characters, {len(font_record['shards'])} WOFF2 files", flush=True)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--download-only", action="store_true")
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()
    download_sources()
    if args.verify_only:
        verify_and_repair_metadata()
    elif args.download_only:
        for source in SOURCES:
            inspect_source(source)
    else:
        build()
        verify_and_repair_metadata()

