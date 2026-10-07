"""Reference-informed, approximate tree layout; never alters campus DTM.

Satellite RGB classifies broad green/texture patches, not individually surveyed trees.
Only generated point/layout data are intended for modeling; imagery is not a texture.
"""
from __future__ import annotations
from pathlib import Path
import argparse, datetime, hashlib, json, math, sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'artifacts/mountain-prep/python-tools'))
import numpy as np
from PIL import Image, ImageDraw
from pyproj import Transformer
from shapely.geometry import Point, shape, mapping
from shapely.ops import transform, unary_union
from scipy.ndimage import uniform_filter, binary_opening, binary_closing


def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def provenance(path):
    return {'path':str(path.relative_to(ROOT)).replace('\\','/'),
            'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'bytes':path.stat().st_size}


def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--count',type=int,default=700)
    ap.add_argument('--seed',type=int,default=20261007)
    ap.add_argument('--buildings',default='docs/campus-model-v2/buildings.json')
    ap.add_argument('--output',default='docs/campus-model-v3/vegetation-layout.json')
    args=ap.parse_args()
    source_path=ROOT/'artifacts/campus-model/references/satellite-source.json'
    image_path=ROOT/'artifacts/campus-model/references/sustech_satellite_esri.png'
    boundary_path=ROOT/'artifacts/campus-model/references/sustech-campus-official-raw.geojson'
    footprints_path=ROOT/'artifacts/campus-model/references/sustech-campus-building-footprints-wgs84.geojson'
    terrain_path=ROOT/'output/terrain-v2/campus/campus_elevation_float32.npy'
    terrain_meta_path=ROOT/'output/terrain-v2/campus/campus_metadata.json'
    config_path=ROOT/args.buildings
    meta=read(terrain_meta_path); source=read(source_path); config=read(config_path)
    extent=source['export_metadata']['extent']
    terrain=np.load(terrain_path)
    origin=meta['mesh']['projected_xy_origin_m']; grid=meta['projected_transform']
    rgb=np.asarray(Image.open(image_path).convert('RGB'),dtype=np.float32)
    height,width=rgb.shape[:2]
    assert (width,height)==(source['export_metadata']['width'],source['export_metadata']['height'])
    g=rgb[:,:,1]; r=rgb[:,:,0]; b=rgb[:,:,2]
    # Mild visible-green threshold accommodates shaded canopies and reference color grading.
    excess=2*g-r-b
    raw=(g>=28)&(g>r+2)&(g>b+4)&(excess>12)&(np.max(rgb,axis=2)-np.min(rgb,axis=2)>12)
    raw=binary_closing(binary_opening(raw,iterations=1),iterations=1)
    fraction=uniform_filter(raw.astype(np.float32),size=9)
    luminance=(.2126*r+.7152*g+.0722*b)
    mean=uniform_filter(luminance,size=9)
    std=np.sqrt(np.maximum(0,uniform_filter(luminance*luminance,size=9)-mean*mean))
    # Plain sports-field or manicured lawn is not automatically populated as forest.
    textured=(std>=7)|(mean<77)
    canopy=raw&(fraction>=.42)&textured
    image_x=(extent['xmax']-extent['xmin'])/width
    image_y=(extent['ymax']-extent['ymin'])/height
    wgs_to_utm=Transformer.from_crs('EPSG:4326',meta['region']['projected_crs'],always_xy=True)
    merc_to_utm=Transformer.from_crs('EPSG:3857',meta['region']['projected_crs'],always_xy=True)
    utm_to_wgs=Transformer.from_crs(meta['region']['projected_crs'],'EPSG:4326',always_xy=True)
    def local_geometry(geo):
        def convert(x,y,z=None):
            xx,yy=wgs_to_utm.transform(x,y)
            return np.asarray(xx)-origin[0],np.asarray(yy)-origin[1]
        return transform(convert,shape(geo))
    boundary=unary_union([local_geometry(f['geometry']) for f in read(boundary_path)['features']])
    domain=boundary.buffer(25)
    footprints=unary_union([local_geometry(f['geometry']) for f in read(footprints_path)['features']])
    building_exclusion=footprints.buffer(2.5)
    path_shapes=[]; water_shapes=[]
    for item in config.get('paths',[]):
        line=local_geometry(item['geometry'])
        if line.is_empty:continue
        half=float(item.get('width_m',3))/2+1
        if item.get('kind')=='water':water_shapes.append(line.buffer(half))
        else:path_shapes.append(line.buffer(half))
    # Include real water polygon extents when OSM context provides them.
    context_path=ROOT/'artifacts/campus-model/references/sustech-campus-context-wgs84.geojson'
    for f in read(context_path)['features']:
        props=f.get('properties',{}); tags=props.get('tags',{})
        category=props.get('category','')
        if ('water' in category or tags.get('natural')=='water') and f['geometry']['type'] in ('Polygon','MultiPolygon'):
            water_shapes.append(local_geometry(f['geometry']).buffer(1))
    paths_exclusion=unary_union(path_shapes)
    water_exclusion=unary_union(water_shapes)
    excluded=unary_union([building_exclusion,paths_exclusion,water_exclusion])
    build_area=domain.difference(excluded)
    rows,cols=np.nonzero(canopy)
    east=extent['xmin']+(cols+.5)*image_x
    north=extent['ymax']-(rows+.5)*image_y
    xx,yy=merc_to_utm.transform(east,north)
    xx=np.asarray(xx)-origin[0]; yy=np.asarray(yy)-origin[1]
    from shapely import contains_xy
    valid=contains_xy(build_area,xx,yy)
    rows,cols,xx,yy=rows[valid],cols[valid],xx[valid],yy[valid]
    if len(rows)<args.count:
        raise RuntimeError(f'Insufficient classified green candidates ({len(rows)}) for {args.count} trees')
    rng=np.random.default_rng(args.seed)
    # Weighted sampling emphasizes dense canopies, while the fixed permutation prevents grid rows.
    scores=(fraction[rows,cols]**2)*np.clip(std[rows,cols]/14,.30,1.6)
    priorities=-np.log(np.maximum(rng.random(len(rows)),1e-12))/scores
    order=np.argsort(priorities)
    points=[]; spatial={}; cell=8.
    def ground(x,y):
        col=(x+origin[0]-grid[2])/grid[0]-.5
        row=(y+origin[1]-grid[5])/grid[4]-.5
        if not (0<=col<=terrain.shape[1]-1 and 0<=row<=terrain.shape[0]-1):
            raise ValueError('Vegetation lies outside terrain raster sample centers')
        c=min(int(col),terrain.shape[1]-2); rr=min(int(row),terrain.shape[0]-2)
        fx,fy=col-c,row-rr
        nw,ne,sw,se=map(float,[terrain[rr,c],terrain[rr,c+1],terrain[rr+1,c],terrain[rr+1,c+1]])
        return nw+fx*(ne-nw)+fy*(sw-nw) if fx+fy<=1 else se+(1-fx)*(sw-se)+(1-fy)*(ne-se)
    for idx in order:
        x,y=float(xx[idx]),float(yy[idx]); row,col=int(rows[idx]),int(cols[idx])
        radius=float(rng.uniform(2.1,4.9))
        # Added clearance keeps crown masses away from primary building facade geometry.
        pt=Point(x,y)
        if footprints.distance(pt)<radius+1.2:continue
        key=(math.floor(x/cell),math.floor(y/cell))
        nearby=[j for kx in range(key[0]-2,key[0]+3) for ky in range(key[1]-2,key[1]+3) for j in spatial.get((kx,ky),[])]
        if any(math.hypot(x-points[j]['xy_m'][0],y-points[j]['xy_m'][1]) < max(5.8,.78*(radius+points[j]['crown_radius_m'])) for j in nearby):continue
        longitude,latitude=utm_to_wgs.transform(x+origin[0],y+origin[1])
        h=float(np.clip(radius*2.5+rng.uniform(1.2,4.2),7,16))
        p={'id':f'vegetation-v3-{len(points)+1:04d}','xy_m':[round(x,3),round(y,3)],
           'terrain_z_m':round(ground(x,y),4),'wgs84':[round(longitude,8),round(latitude,8)],
           'crown_radius_m':round(radius,3),'height_m':round(h,3),'rotation_z_rad':round(float(rng.uniform(0,2*math.pi)),4),
           'mesh_variant':int(rng.integers(0,6)),
           'pixel_green_evidence':{'pixel_col_row':[col,row],'rgb':[int(v) for v in rgb[row,col]],
                                   'excess_green':round(float(excess[row,col]),2),'green_fraction_9x9':round(float(fraction[row,col]),3),
                                   'luminance_std_9x9':round(float(std[row,col]),3)},
           'status':'approximate green-patch placement; not surveyed tree identity, trunk center, height or species'}
        points.append(p);spatial.setdefault(key,[]).append(len(points)-1)
        if len(points)==args.count:break
    if len(points)!=args.count:raise RuntimeError(f'Can only place {len(points)} separated trees; target {args.count}')
    # Post-sampling QA uses exported rounded coordinates and the exact source exclusion geometry.
    checks=[Point(*p['xy_m']) for p in points]
    assert all(domain.covers(p) for p in checks)
    assert all(not excluded.covers(p) for p in checks)
    assert all(math.isfinite(p['terrain_z_m']) for p in points)
    layout={'schema_version':1,'generated_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'name':'南科大卫星绿植区域约束树位','projected_crs':meta['region']['projected_crs'],
            'local_origin_utm_m':origin,'vertical_datum':meta['vertical_datum'],
            'terrain_geometry_modified':False,'count':len(points),'seed':args.seed,
            'sources':[provenance(p) for p in (source_path,image_path,boundary_path,footprints_path,config_path,terrain_meta_path,terrain_path)],
            'satellite_reference':{'service_url':source['service_url'],'capture_date':'unknown',
                'reference_only':True,'imagery_not_exported_as_texture':True,'native_size_pixels':[width,height],'extent_epsg3857':extent,
                'copyright':'Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community'},
            'method':{'classification':'visible RGB excess-green and 9x9 green-density/texture; approximate canopy areas',
                      'domain':'official campus boundary plus 25m context buffer, within acquired satellite reference',
                      'building_center_exclusion_m':2.5,'road_center_exclusion':'actual model path width/2 + 1m',
                      'water_excluded':True,'minimum_trunk_spacing_m':5.8,
                      'building_crown_extra_clearance_m':1.2,
                      'terrain_z_interpolation':'exact DTM mesh NW/SW/NE and NE/SW/SE triangles',
                      'all_tree_sizes_and_species':'procedural visual estimates, not measured',
                      'classified_canopy_pixels':int(canopy.sum()),'valid_domain_candidate_pixels':len(rows)},
            'qa':{'count_matches_target':True,'finite_terrain_elevations':True,'inside_context_domain':True,
                  'no_trunk_in_building_road_water_exclusions':True,'minimum_building_outline_distance_m':round(min(footprints.distance(p) for p in checks),3),
                  'terrain_file_sha256_unchanged':provenance(terrain_path)['sha256']},'trees':points}
    dest=ROOT/args.output;dest.parent.mkdir(parents=True,exist_ok=True)
    dest.write_text(json.dumps(layout,ensure_ascii=False,indent=2),encoding='utf-8')
    artifact=ROOT/'artifacts/campus-model-v3';artifact.mkdir(parents=True,exist_ok=True)
    Image.fromarray((canopy.astype(np.uint8)*255)).save(artifact/'vegetation-green-mask.png')
    overlay=Image.open(image_path).convert('RGB');draw=ImageDraw.Draw(overlay)
    for p in points:
        c,rp=p['pixel_green_evidence']['pixel_col_row'];draw.ellipse((c-3,rp-3,c+3,rp+3),outline=(245,228,122),width=1)
    overlay.save(artifact/'vegetation-reference-overlay.png')
    print(json.dumps({'output':str(dest),'count':len(points),'candidates':len(rows),'qa':layout['qa']},ensure_ascii=False))


if __name__=='__main__':main()
