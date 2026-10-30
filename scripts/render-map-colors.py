"""Render native projected geography into repeatable map-theme comparison PNGs.

Run: python scripts/render-map-colors.py
Requires Pillow. The script reads existing M/L/Z paths without reprojecting,
simplifying, or inventing geographic boundaries. All rings use even-odd fill.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from PIL import Image, ImageChops, ImageColor, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "public" / "design"
FONT_DIR = ROOT / "public" / "fonts" / "harmonyos-sans-sc"
SUPERSAMPLE = 3
SHEET_SIZE = (1800, 1300)
CARD_SIZE = (834, 526)
BRAND_ORANGE = "#F47735"
BACKGROUND = "#090909"


def font(size: float, bold: bool = False) -> ImageFont.FreeTypeFont:
    weight = "Bold" if bold else "Regular"
    return ImageFont.truetype(
        str(FONT_DIR / f"HarmonyOS_Sans_SC_{weight}.ttf"),
        round(size * SUPERSAMPLE),
    )


def box(values):
    return tuple(round(value * SUPERSAMPLE) for value in values)


def text(draw, xy, value, size, fill, bold=False, anchor="lt"):
    draw.text(box(xy), str(value), font=font(size, bold), fill=fill, anchor=anchor)


def parse_rings(path: str):
    """Parse the source's explicit M/L/Z commands, preserving every vertex."""
    if set(re.findall(r"[A-Za-z]", path)) - {"M", "L", "Z"}:
        raise ValueError("Only the source's M/L/Z path commands are supported")
    tokens = re.findall(r"[MLZ]|[-+]?(?:\d*\.)?\d+", path)
    rings, points = [], []
    index = 0
    while index < len(tokens):
        command = tokens[index]
        index += 1
        if command == "Z":
            if points:
                if len(points) < 3:
                    raise ValueError("A geographic ring has fewer than 3 vertices")
                rings.append(points)
                points = []
        elif command in {"M", "L"}:
            if command == "M" and points:
                raise ValueError("Source path contains an unclosed ring")
            if index + 1 >= len(tokens):
                raise ValueError("Source path contains an incomplete point")
            points.append((float(tokens[index]), float(tokens[index + 1])))
            index += 2
        else:
            raise ValueError(f"Unexpected path token: {command}")
    if points:
        raise ValueError("Source path is missing its final close command")
    if not rings:
        raise ValueError("Source path contains no polygon rings")
    return rings


def short_name(name: str) -> str:
    for suffix in ["壮族自治区", "维吾尔自治区", "回族自治区", "自治区", "特别行政区"]:
        name = name.replace(suffix, "")
    return re.sub(r"[省市]$", "", name)


def render_map(card, theme, geography, province_rings, inset_rings):
    draw = ImageDraw.Draw(card)
    frame = geography["inset"]["frame"]
    all_points = [point for rings in province_rings + inset_rings for ring in rings for point in ring]
    # Fit complete, existing geometry and its inset frame using one uniform scale.
    # This only removes source-canvas whitespace; projected coordinates are intact.
    min_x = min(point[0] for point in all_points) - 26
    min_y = min(point[1] for point in all_points) - 7
    max_x = max(frame["x"] + frame["width"], max(point[0] for point in all_points)) + 15
    max_y = max(frame["y"] + frame["height"] + 22, max(point[1] for point in all_points)) + 2
    region = (28, 72, CARD_SIZE[0] - 28, 424)
    scale = min((region[2] - region[0]) / (max_x - min_x), (region[3] - region[1]) / (max_y - min_y))
    offset_x = region[0] + ((region[2] - region[0]) - (max_x - min_x) * scale) / 2 - min_x * scale
    offset_y = region[1] + ((region[3] - region[1]) - (max_y - min_y) * scale) / 2 - min_y * scale

    def project(point):
        return (round((offset_x + point[0] * scale) * SUPERSAMPLE),
                round((offset_y + point[1] * scale) * SUPERSAMPLE))

    def polygon(rings, fill, stroke):
        transformed = [[project(point) for point in ring] for ring in rings]
        mask = Image.new("1", card.size, 0)
        for ring in transformed:
            ring_mask = Image.new("1", card.size, 0)
            ImageDraw.Draw(ring_mask).polygon(ring, fill=1)
            mask = ImageChops.logical_xor(mask, ring_mask)
        card.paste(ImageColor.getrgb(fill), (0, 0), mask)
        outline = ImageDraw.Draw(card)
        for ring in transformed:
            outline.line(ring + [ring[0]], fill=stroke, width=round(.8 * SUPERSAMPLE), joint="curve")

    for rings in province_rings:
        polygon(rings, theme["land"], theme["border"])

    # The inset coordinates already share the main projected coordinate system.
    frame_box = [project((frame["x"], frame["y"])), project((frame["x"] + frame["width"], frame["y"] + frame["height"]))]
    draw.rounded_rectangle(frame_box, radius=round(2 * SUPERSAMPLE), fill=theme["background"], outline=theme["chrome"], width=round(.8 * SUPERSAMPLE))
    for rings in inset_rings:
        polygon(rings, theme["land"], theme["border"])

    # Label callouts only move text; province geometry and label anchors stay native.
    callouts = {
        "110000": (641, 211), "120000": (664, 241), "310000": (735, 358),
        "810000": (665, 513), "820000": (614, 539), "710000": (739, 467),
        "460000": (544, 579),
    }
    draw = ImageDraw.Draw(card)
    for province in geography["provinces"]:
        anchor = tuple(province["label"])
        label = callouts.get(province["adcode"], anchor)
        if label != anchor:
            draw.line([project(anchor), project(label)], fill=theme["border"], width=max(1, round(.55 * SUPERSAMPLE)))
        draw.text(project(label), short_name(province["name"]), font=font(11), fill=theme["label"], anchor="mm", stroke_width=round(.8 * SUPERSAMPLE), stroke_fill=theme["background"])
    draw.text(project((frame["x"] + frame["width"] / 2, frame["y"] + frame["height"] + 16)), geography["inset"]["title"], font=font(10), fill=theme["label"], anchor="mm")


def render_card(theme, geography, province_rings, inset_rings):
    card = Image.new("RGB", box(CARD_SIZE), theme["background"])
    draw = ImageDraw.Draw(card)
    draw.rounded_rectangle(box((0, 0, CARD_SIZE[0] - 1, CARD_SIZE[1] - 1)), radius=18 * SUPERSAMPLE, outline=theme["chrome"], width=SUPERSAMPLE)
    draw.rounded_rectangle(box((26, 23, 63, 60)), radius=8 * SUPERSAMPLE, fill=theme["panel"], outline=theme["chrome"], width=SUPERSAMPLE)
    text(draw, (44.5, 41.5), theme["letter"], 20, theme["text"], True, "mm")
    text(draw, (77, 28), theme["name"], 25, theme["text"], True)
    text(draw, (CARD_SIZE[0] - 27, 38), "川衡足迹 / 配色样本", 11, theme["muted"], anchor="rt")
    render_map(card, theme, geography, province_rings, inset_rings)
    draw = ImageDraw.Draw(card)
    draw.line(box((26, 438, CARD_SIZE[0] - 26, 438)), fill=theme["chrome"], width=SUPERSAMPLE)
    tokens = [("背景", "background"), ("陆地", "land"), ("省界", "border"), ("文字", "label")]
    for index, (label, key) in enumerate(tokens):
        x = 28 + index * 195
        draw.rounded_rectangle(box((x, 452, x + 34, 469)), radius=3 * SUPERSAMPLE, fill=theme[key], outline=theme["chrome"], width=SUPERSAMPLE)
        text(draw, (x + 44, 452), label, 11, theme["muted"])
        text(draw, (x + 75, 452), theme[key].upper(), 11, theme["label"])
    description = theme["description"].replace("。", "；").rstrip("；") + "。"
    text(draw, (28, 489), description, 14, theme["muted"])
    clip = Image.new("L", card.size, 0)
    ImageDraw.Draw(clip).rounded_rectangle(box((0, 0, CARD_SIZE[0] - 1, CARD_SIZE[1] - 1)), radius=18 * SUPERSAMPLE, fill=255)
    result = Image.new("RGB", card.size, BACKGROUND)
    result.paste(card, (0, 0), clip)
    return result


def main():
    themes = json.loads((ROOT / "src" / "map" / "map-themes.json").read_text(encoding="utf-8"))
    geography = json.loads((ROOT / "src" / "map" / "geography.json").read_text(encoding="utf-8"))
    if len(themes) != 4 or {theme["letter"] for theme in themes} != set("ABCD"):
        raise ValueError("Expected the existing four themes A/B/C/D")
    if geography["fillRule"] != "evenodd" or len(geography["provinces"]) != 34:
        raise ValueError("Expected complete 34-province, even-odd geography")
    province_rings = [parse_rings(item["path"]) for item in geography["provinces"]]
    inset_rings = [parse_rings(item["path"]) for item in geography["inset"]["paths"]]
    if not inset_rings:
        raise ValueError("The existing South China Sea inset must be included")

    OUTPUT.mkdir(parents=True, exist_ok=True)
    sheet = Image.new("RGB", box(SHEET_SIZE), BACKGROUND)
    draw = ImageDraw.Draw(sheet)
    text(draw, (52, 32), "川衡足迹 · 地图配色", 35, "#F4F4F4", True)
    text(draw, (53, 88), "同一地理底图，比较黑灰、暖灰、森林绿与雪山蓝。", 16, "#A6A6A6")
    text(draw, (1748, 53), "A — D / 选择你更喜欢的方向", 13, "#8E8E8E", anchor="rt")
    for index, theme in enumerate(sorted(themes, key=lambda item: item["letter"])):
        card = render_card(theme, geography, province_rings, inset_rings)
        card.resize(CARD_SIZE, Image.Resampling.LANCZOS).save(OUTPUT / f"map-color-{theme['letter']}.png", optimize=True)
        x = 52 + (index % 2) * 862
        y = 137 + (index // 2) * 554
        sheet.paste(card, box((x, y)))

    # The only orange point is a footer legend, never a fabricated activity point.
    draw = ImageDraw.Draw(sheet)
    draw.ellipse(box((55, 1252, 65, 1262)), fill=BRAND_ORANGE)
    text(draw, (78, 1248), "品牌橙保持不变 · 此处圆点不表示活动地点", 13, "#B8B8B8")
    text(draw, (1748, 1250), "34 个省级区域 + 南海诸岛附图 · 未添加活动标记", 12, "#818181", anchor="rt")
    destination = OUTPUT / "map-color-samples.png"
    sheet.resize(SHEET_SIZE, Image.Resampling.LANCZOS).save(destination, optimize=True)
    print(f"Rendered {len(geography['provinces'])} provinces and {len(inset_rings)} inset paths in all 4 themes.")
    print(f"Preserved {sum(map(len, province_rings)) + sum(map(len, inset_rings))} source rings with even-odd fill.")
    print(destination)


if __name__ == "__main__":
    main()
