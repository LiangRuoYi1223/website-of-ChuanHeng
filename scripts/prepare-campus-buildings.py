"""Create reproducible campus modelling inputs from downloaded source geometry.

This writes source footprints unchanged. Landmark height partitions are explicitly
estimated; no terrain deformation or campus building positions are invented.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "artifacts/mountain-prep/python-tools"))
from pyproj import Transformer
from shapely.geometry import shape, mapping, box
from shapely.ops import transform, unary_union

REF = ROOT / "artifacts/campus-model/references"
DOC = ROOT / "docs/campus-model"

def read(name):
    return json.loads((REF / name).read_text(encoding="utf-8"))

def source(url, title):
    return {"url": url, "title": title}

OFFICIAL_MAP = source("https://icm.sustech.edu.cn/map/", "南科大 ICM 校园地图：建筑身份及位置核对")
FOOTPRINTS = read("sustech-campus-building-footprints-wgs84.geojson")
FORWARD = Transformer.from_crs(4326, 32649, always_xy=True).transform
BACK = Transformer.from_crs(32649, 4326, always_xy=True).transform

def partition(feature, centre, width, depth, tall_height, tall_levels, title):
    """Partition the actual footprint; estimated corner never changes coverage."""
    original = transform(FORWARD, shape(feature["geometry"]))
    x, y = FORWARD(*centre)
    tall = original.intersection(box(x-width/2, y-depth/2, x+width/2, y+depth/2))
    low = original.difference(tall)
    assert tall.area > 100 and low.area > 100
    assert original.symmetric_difference(unary_union([low, tall])).area < .001
    feature["parts"] = [
        {"id": feature["id"]+":low-wings", "name": "低层翼楼",
         "geometry": mapping(transform(BACK, low)), "height_m": feature["height_m"], "levels": feature["levels"]},
        {"id": feature["id"]+":height-partition", "name": title,
         "geometry": mapping(transform(BACK, tall)), "height_m": tall_height, "levels": tall_levels},
    ]
    feature["height_partition_estimated"] = True
    feature["height_status"] += "；高低体量分区位置与尺寸为照片/卫星判读估算，非建筑施工图"

def make():
    features = []
    for raw in FOOTPRINTS["features"]:
        p, g = raw["properties"], raw["geometry"]
        t = p.get("tags", {})
        levels = int(float(t.get("building:levels", 4)))
        name = t.get("name:zh-Hans") or t.get("name:zh") or t.get("name") or "校园建筑 " + str(p["osm_id"])
        f = {"id": raw["id"], "name": name, "role": "building", "geometry": g,
             "levels": levels, "height_m": round(levels*3.6, 2),
             "material_style": "light-stone", "wall_color": [.70,.69,.64],
             "roof_color": [.30,.33,.32], "detail": {"roof": "flat", "windows": True,
                 "window_spacing_m": 3.8, "window_size_m": [1.55,1.65]},
             "confidence": {"footprint": "OSM polygon; official campus map/satellite alignment checked",
                            "height": "OSM storeys where tagged; otherwise estimated four storeys",
                            "facade": "illustrative repetition, not surveyed windows"},
             "height_status": "OSM层数×3.6米估高" if "building:levels" in t else "缺少层数资料：暂估4层×3.6米",
             "sources": [source(p["osm_url"], "OpenStreetMap 实际建筑轮廓及可用层数"), OFFICIAL_MAP],
             "source_tags": t, "source_category": p["category"]}
        if t.get("building") in ("roof", "shed", "garage"):
            f.update(height_m=4.5, levels=1, height_status="附属设施估高4.5米")
        if "宿舍" in name or "公寓" in name:
            f["wall_color"] = [.76,.74,.66]
        features.append(f)
    by_id = {f["id"]: f for f in features}

    science = by_id["relation/18716462"]
    science.update(name="理学院", role="landmark", height_m=23.5, levels=5,
                   height_status="官方公开地上5–9层；首版低翼23.5米/高楼42.5米为层高估算",
                   wall_color=[.76,.74,.64], roof_color=[.40,.45,.43],
                   material_style="glass-academic")
    science["sources"] += [source("https://newshub.sustech.edu.cn/html/202304/43745.html", "理学院：两栋L形建筑"),
                           source("https://gao.sustech.edu.cn/uploads/202202/15103704_32883.pdf", "校园设施简报：理学院地上5–9层")]
    science["detail"].update(window_spacing_m=2.9, window_size_m=[2.2,3.05], frame_color=[.76,.74,.64])
    partition(science, [113.99438,22.59770], 56, 55, 42.5, 9, "理学院高层端部（分区估算）")

    for fid, name, height, levels, rise in [
        ("way/695571961","工学院南楼",42.3,9,12),
        ("way/695571962","工学院北楼",46.8,10,14)]:
        f = by_id[fid]
        f.update(name=name, role="landmark", height_m=height, levels=levels,
                 height_status="官方最高建筑高度与地上层数；斜屋顶高差按照片估算",
                 material_style="warm-concrete", wall_color=[.70,.58,.33], roof_color=[.55,.51,.39],
                 base_wall_color=[.72,.73,.69], base_light_height_m=7.2)
        f["detail"].update(roof="sloped",roof_rise_m=rise,roof_slope_direction=[-1,1],
                           window_spacing_m=3.4,window_size_m=[1.8,2.1],frame_color=[.36,.34,.28])
        f["sources"] += [source("https://coe.sustech.edu.cn/News-Detail-id-271.html", "工学院：南9层最高42.3m、北10层最高46.8m"),
                         source("https://baumschlager-eberle.com/en/work/projects/projekte-details/school-of-engineering-sustc/", "建筑设计机构：外墙与坡屋顶参考（不采用其错误GPS）")]

    business = by_id["way/703098307"]
    business.update(name="商学院",role="landmark",height_m=23,levels=5,
                    wall_color=[.84,.84,.78],material_style="glass-academic",
                    height_status="官方地上5层、地下2层；地上总高23米估算，地下室不建")
    business["detail"].update(window_spacing_m=3.4,window_size_m=[2.5,2.9],frame_color=[.84,.84,.78])
    business["sources"] += [source("https://business.sustech.edu.cn/web/news_detail.php?id=25", "商学院官方：地上五层及建筑照片")]

    zhihua = by_id["way/703098306"]
    zhihua.update(name="智华楼",role="landmark",height_m=22.5,levels=5,
                  wall_color=[.86,.86,.81],roof_color=[.45,.48,.46],
                  height_status="官方/OSM地上5层；总高22.5米估算；原第三教学楼于2026年命名智华楼")
    zhihua["detail"].update(window_spacing_m=2.7,window_size_m=[1.25,2.75],frame_color=[.70,.72,.69])
    zhihua["sources"] += [source("https://newshub.sustech.edu.cn/html/202208/42555.html", "第三教学楼建筑参考"),
                         source("https://newshub.sustech.edu.cn/html/202601/47208.html", "智华楼官方命名信息")]

    base = by_id["relation/12480428"]
    base.update(name="南科大中心 · 共用首层",height_m=4.5,levels=1,wall_color=[.70,.64,.55],
                height_status="OSM共用一层基座；首层4.5米估算；保留原轮廓的7个院落孔洞")
    base["detail"]["window_size_m"] = [2.1,2.8]
    centre_source = source("https://architecturestudio.fr/projets/shz7/", "南科大中心设计机构：建筑分部及共享基座参考")
    base["sources"].append(centre_source)
    for fid in ["way/710848314","way/710848316","way/710848317","way/710848322"]:
        f = by_id[fid]
        total_levels = 4 if fid == "way/710848316" else f["levels"]
        total_height = 20 if fid == "way/710848316" else total_levels*4.1
        f.update(base_parent_id=base["id"],base_parent_offset_m=4.5,
                 levels=total_levels-1,height_m=round(total_height-4.5,2),
                 official_or_osm_total_storeys_including_shared_base=total_levels,
                 height_status="地上总层数包含共享首层；部件从4.5米基座顶起建，总高度为层高估算",
                 wall_color=[.62,.46,.34],roof_color=[.50,.39,.29])
        f["sources"].append(centre_source)
        f["detail"].update(roof="sloped",roof_rise_m=3.5,roof_slope_direction=[-.6,.8])
    yidan = by_id["way/710848316"]
    yidan.update(name="一丹图书馆",role="landmark",material_style="orange-library",
                 wall_color=[.76,.29,.10],roof_color=[.63,.25,.105],
                 height_status="官方总4层（包含共用首层），总高20米估算：基座4.5米+部件15.5米；非OSM误标5层")
    yidan["detail"].update(roof_rise_m=4.5,roof_slope_direction=[-.5,1],window_pattern="scattered",
                          window_spacing_m=4.2,window_size_m=[2.3,.90],frame_color=[.40,.25,.18])
    yidan["sources"] += [source("https://www.sustech.edu.cn/10th/news/39486.html", "一丹图书馆官方：4层与橙红色建筑照片"),
                       source("https://lib.sustech.edu.cn/kjbj/list.htm", "图书馆空间布局")]

    boundary = shape(read("sustech-campus-official-raw.geojson")["features"][0]["geometry"])
    campus_clip = transform(FORWARD,boundary).buffer(30)
    paths = []
    context = read("sustech-campus-context-wgs84.geojson")
    for raw in context["features"]:
        p, t = raw["properties"], raw["properties"].get("tags", {})
        if raw["geometry"]["type"] != "LineString" or p.get("category") not in ("road_or_path","water"):
            continue
        clipped = transform(FORWARD,shape(raw["geometry"])).intersection(campus_clip)
        lines = [clipped] if clipped.geom_type == "LineString" else [g for g in getattr(clipped,"geoms",[]) if g.geom_type=="LineString"]
        lines = [g for g in lines if g.length>2]
        if not lines:
            continue
        geom = lines[0] if len(lines)==1 else unary_union(lines)
        highway = t.get("highway", "")
        water = p["category"] == "water"
        kind = "water" if water else "walkway" if highway in ("footway","path","steps","pedestrian","cycleway") else "road"
        width = 12 if water and t.get("waterway")=="river" else 6 if water else 2.5 if kind=="walkway" else 10 if highway in ("primary","secondary","tertiary") else 6
        paths.append({"id":str(raw.get("id",p.get("osm_id"))),"name":t.get("name", "校园水系" if water else "校园道路"),
                      "geometry":mapping(transform(BACK,geom)),"kind":kind,"width_m":width,
                      "width_status":"first-version estimated width; centreline from source",
                      "sources":[source(p.get("osm_url","https://www.openstreetmap.org/copyright"),"OpenStreetMap 中心线；按官方校界裁剪")]})

    config = {"schema_version":1,"attribution":"Campus footprints and paths © OpenStreetMap contributors, ODbL 1.0; https://www.openstreetmap.org/copyright. Official campus map, photos and Esri satellite imagery used for reference only.",
              "site":{"id":"sustech","name":"南方科技大学","projected_crs":"EPSG:32649",
                      "terrain_blend":"output/blender-terrain-v2/campus_validation.blend",
                      "terrain_metadata":"output/terrain-v2/campus/campus_metadata.json",
                      "terrain_npy":"output/terrain-v2/campus/campus_elevation_float32.npy",
                      "reference_points":{"gate":[113.99450,22.59564],"campus_center":[113.996,22.603]},
                      "render":{"width":1800,"height":1200},
                      "camera_views":{"gate_inward":{"eye_height_m":7,"target_height_m":18,"lens_mm":25}},
                      "gate_model":{"center_wgs84":[113.99450,22.59564],"inward_bearing_deg":345,
                                    "canopy_width_m":24,"canopy_depth_m":7,"canopy_height_m":3.4,
                                    "wall_width_m":8,"wall_height_m":9,"wall_thickness_m":.5,"wall_side":"east",
                                    "stone_color":[.70,.70,.66],"canopy_color":[.035,.045,.045],
                                    "sources":[OFFICIAL_MAP,source("https://icm.sustech.edu.cn/map/img/gate1.jpg","一号门官方照片")],
                                    "confidence":"官方门址；尺寸、内向方位与灰石墙/黑雨棚体量为照片估算"}},
              "features":features,"paths":paths,
              "labels":[{"building_id":fid,"text":by_id[fid]["name"]} for fid in ["relation/18716462","way/695571961","way/695571962","way/703098307","way/703098306","way/710848316"]],
              "reference_limits":["Footprints are public map outlines, not survey-certified architectural plans.","Official map is schematic; WGS84 OSM/ICM coordinates establish placement.","Satellite imagery capture date is unknown; no satellite/photo textures are embedded.","No change to source DTM geometry; predicted 30m DTM requires separate foundations.","Current model is exterior campus massing with illustrative facade details, not interior/BIM reconstruction."]}
    DOC.mkdir(parents=True,exist_ok=True)
    (DOC/"buildings.json").write_text(json.dumps(config,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    audit = {"building_features":len(features),"source_geometry_equal_for_all_features":all(f["geometry"]==r["geometry"] for f,r in zip(features,FOOTPRINTS["features"])),
             "source_footprints_sha256":hashlib.sha256((REF/"sustech-campus-building-footprints-wgs84.geojson").read_bytes()).hexdigest(),
             "road_or_path_features":sum(p["kind"]!="water" for p in paths),"water_line_features":sum(p["kind"]=="water" for p in paths),
             "coordinate_crs":"EPSG:4326 to EPSG:32649; no GCJ shift", "science_part_coverage_equal_to_original":True,
             "shared_base_child_features":4,"official_yidan_total_storeys":4,"website_changed":False}
    assert audit["source_geometry_equal_for_all_features"]
    (DOC/"building-input-audit.json").write_text(json.dumps(audit,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(json.dumps(audit,ensure_ascii=False))

if __name__ == "__main__":
    make()
