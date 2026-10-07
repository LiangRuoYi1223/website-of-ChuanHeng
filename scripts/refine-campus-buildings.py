"""Create v2 landmark architecture inputs while preserving source geography.

Photograph-derived architecture remains explicitly approximate; this script
does not overwrite the first campus config or the user's open Blender scene.
"""
import copy
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'artifacts/mountain-prep/python-tools'))
from pyproj import Transformer
from shapely.geometry import shape, mapping, box
from shapely.ops import transform, unary_union
from shapely.affinity import affine_transform

FORWARD = Transformer.from_crs(4326, 32649, always_xy=True).transform
BACK = Transformer.from_crs(32649, 4326, always_xy=True).transform

def uv_shape(feature, origin):
    e, n = origin
    return affine_transform(transform(FORWARD, shape(feature['geometry'])),
                            [.6,.8,.8,-.6,-.6*e-.8*n,-.8*e+.6*n])

def geo(geometry, origin):
    return mapping(transform(BACK, affine_transform(geometry, [.6,.8,.8,-.6,*origin])))

def part(fid, name, geom, origin, height, levels, offset=0, **details):
    assert not geom.is_empty and geom.area>.5
    return {'id':fid,'name':name,'geometry':geo(geom,origin),'height_m':height,
            'levels':levels,'base_offset_m':offset,'detail':details}

def main():
    old = json.loads((ROOT/'docs/campus-model/buildings.json').read_text(encoding='utf-8'))
    config = copy.deepcopy(old)
    config['schema_version']=2
    config['model_version']=2
    config['site']['render']={'width':2200,'height':1400}
    buildings={f['id']:f for f in config['features']}
    for f in config['features']:
        if f['role']=='landmark':
            f['detail'].update(facade_mode='recessed',wall_thickness_m=.55,
                               glazing_recess_m=.22,frame_depth_m=.22,
                               parapet_m=.60)
            f['confidence']['facade']='Photo-derived architectural vocabulary, approximate dimensions and window layout; not surveyed reconstruction'

    science=buildings['relation/18716462']
    science['detail'].update(facade_mode='curtain',window_spacing_m=3.4,
                            window_size_m=[2.65,3.95],frame_width_m=.23,
                            frame_depth_m=.45,wall_thickness_m=.60,
                            glazing_recess_m=.18,mullion_width_m=.075,
                            clerestory_height_m=1.2,parapet_m=.65)
    for p in science['parts']:
        if p['levels']==9:
            p['detail']={**science['detail'],'window_spacing_m':2.15,
                         'window_size_m':[1.65,3.95],'frame_width_m':.12,
                         'frame_depth_m':.20,'clerestory_height_m':1.2}
    science['height_status']+='；第二版加入实体幕墙框、凹入玻璃和顶层矮窗带，尺寸按照片估算'

    for fid in ['way/695571961','way/695571962']:
        f=buildings[fid]
        f['detail'].update(facade_mode='recessed',window_spacing_m=3.5,
                           window_size_m=[2.3,1.3],frame_width_m=.10,
                           frame_depth_m=.12,glazing_recess_m=.28,
                           parapet_m=.45,terrace_railing=True,
                           railing_height_m=1.0)
        f['height_status']+='；第二版宽横凹窗、坡屋顶压顶与细栏杆为照片估算'

    business=buildings['way/703098307']
    origin=(807946.523,2502159.773)
    original=uv_shape(business,origin)
    west=original.intersection(box(-20,-20,130,15.3))
    east=original.intersection(box(-20,54.5,130,110))
    bridge=original.difference(unary_union([west,east]))
    assert original.symmetric_difference(unary_union([west,east,bridge])).area<.001
    parts=[]
    for key,foot in [('white-wing',west),('glass-wing',east)]:
        mode='recessed' if key=='white-wing' else 'curtain'
        detail={**business['detail'],'facade_mode':mode,'window_spacing_m':2.8 if mode=='recessed' else 1.75,
                'window_size_m':[1.05,3.0] if mode=='recessed' else [1.30,3.5],
                'frame_width_m':.12,'frame_depth_m':.28 if mode=='recessed' else .16,
                'ground_pilotis_height_m':4.1,'parapet_m':.45,
                'terrace_railing':True,'railing_height_m':1.1}
        parts.append(part('business:'+key+':lower','商学院翼楼与底层柱廊',foot,origin,13.8,3,**detail))
        upper=foot.buffer(-1.10,join_style=2)
        assert upper.area>150
        detail={**detail,'ground_pilotis_height_m':0,'terrace_railing':False,'parapet_m':.60}
        parts.append(part('business:'+key+':upper','商学院退台上部两层',upper,origin,9.2,2,13.8,**detail))
    parts.append(part('business:bridge-paving','桥下地面平台',bridge,origin,.5,1,
                      windows=False,facade_mode='solid',roof='flat',parapet_m=0))
    parts.append(part('business:low-glass-bridge','低玻璃连桥及支柱',bridge,origin,5,1,7,
                      **{**business['detail'],'facade_mode':'curtain','window_spacing_m':3.8,
                         'window_size_m':[3.05,3.65],'frame_width_m':.15,
                         'frame_depth_m':.25,'parapet_m':.4,'terrace_railing':True,
                         'railing_height_m':1.1,'support_columns':True,
                         'support_column_width_m':.65,'support_spacing_m':6,
                         'support_base_offset_m':-6.5}))
    business['parts']=parts
    business['height_partition_estimated']=True
    business['height_status']='官方地上五层；两翼最高23米、连桥梁底7米/顶12米及1.1米退台为照片估算。上部两层叠在13.8米翼楼上，桥下保留开放空间与实体支柱。'

    zhihua=buildings['way/703098306']
    origin=(807882.199,2502210.284)
    original=uv_shape(zhihua,origin)
    high=original.intersection(box(-5,40,25,65))
    low=original.difference(high)
    assert high.area>150 and low.area>500
    assert original.symmetric_difference(unary_union([high,low])).area<.001
    common={**zhihua['detail'],'facade_mode':'recessed','window_spacing_m':3.0,
            'window_size_m':[1.05,2.9],'glazing_recess_m':.3,'frame_depth_m':.3,
            'frame_width_m':.10,'parapet_m':.60,'ground_pilotis_height_m':3.7}
    zhihua['parts']=[part('zhihua:high-end','五层高端块（地理分区估算）',high,origin,22.5,5,
                         **{**common,'clerestory_height_m':1.1}),
                    part('zhihua:low-wings','较低长翼及开放柱廊',low,origin,14.2,3,**common)]
    zhihua['height_partition_estimated']=True
    zhihua['height_status']='官方主楼五层；高端块22.5米/较低长翼14.2米、底层柱廊及具体高端块地理分区均按公开照片估算，非施工图。'

    yidan=buildings['way/710848316']
    yidan['detail'].update(facade_mode='scattered_recessed',facade_rows=9,
                          window_spacing_m=4.2,window_size_m=[2.3,.70],
                          glazing_recess_m=.26,frame_depth_m=.08,frame_width_m=.07,
                          vertical_ribs_spacing_m=2.8,vertical_rib_width_m=.14,
                          vertical_rib_depth_m=.18,glazed_end_side='north',
                          glazed_end_mullion_spacing_m=1.8,
                          terrace_railing=True,railing_height_m=1.1,parapet_m=.35)
    yidan['height_status']+='；第二版橙面竖肋、九行错落凹窗和北端通高玻璃按照片估算，窗行不代表楼层'

    config['reference_limits'].append('V2 increases physical architectural detail, while exact surveyed elevations, full facade/window plans and many secondary building roof details remain unavailable.')
    out=ROOT/'docs/campus-model-v2'
    out.mkdir(parents=True,exist_ok=True)
    (out/'buildings.json').write_text(json.dumps(config,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    audit={'version':2,'source_building_features':len(config['features']),
           'all_top_level_source_footprints_unchanged':all(a['geometry']==b['geometry'] for a,b in zip(old['features'],config['features'])),
           'business_ground_plan_partition_coverage':'exact; source wings/bridge preserved; upper two storeys inset1.1m',
           'zhihua_partition_coverage':'exact; photographed high-end geographic position remains estimated',
           'terrain_modified':False,'previous_model_outputs_modified':False,
           'landmark_physical_detail':'recessed glazing, volumetric columns and frames, parapets, terrace railings, business low bridge and setbacks, Yidan multirow windows and full-height glass end'}
    assert audit['all_top_level_source_footprints_unchanged']
    (out/'building-input-audit.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(audit,ensure_ascii=False))

if __name__=='__main__':
    main()
