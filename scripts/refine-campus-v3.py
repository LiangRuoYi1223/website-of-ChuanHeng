"""Source-based campus detail pass. Opens v2 and saves a separate v3 project.

The source DTM and GIS roads are immutable. Facade divisions, local grading and
landscape tree positions are photo-derived estimates, not surveyed dimensions.
PBR maps are generated material data, not redistributed reference photographs.
Run in Blender: blender --background --python this.py -- --build / --render.
"""
from __future__ import annotations
import argparse
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import random
import sys

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output/campus-model-v3'
DOC = ROOT / 'docs/campus-model-v3'
SOURCE = ROOT / 'output/campus-model-v2/sustech_campus_v2.blend'
BLEND = OUT / 'sustech_campus_v3.blend'
PREP = json.loads((ROOT / 'output/campus-model-v2/campus-prepared.json').read_text(encoding='utf-8'))
spec = importlib.util.spec_from_file_location('campus_builder', ROOT / 'scripts/build-sustech-campus.py')
old = importlib.util.module_from_spec(spec)
spec.loader.exec_module(old)


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def collection(name):
    import bpy
    result = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(result)
    return result


def uv_map(obj, scale=2):
    """Metre-scaled box projection; only UV data change, never geometry."""
    from mathutils import Vector
    mesh = obj.data
    uv = mesh.uv_layers.active or mesh.uv_layers.new(name='UVMap')
    for poly in mesh.polygons:
        normal = poly.normal
        axis = max(range(3), key=lambda k: abs(normal[k]))
        axes = ([1, 2], [0, 2], [0, 1])[axis]
        sign = -1 if normal[axis] < 0 else 1
        for idx in poly.loop_indices:
            co = mesh.vertices[mesh.loops[idx].vertex_index].co
            uv.data[idx].uv = (co[axes[0]] / scale * sign, co[axes[1]] / scale)


class Mesh:
    """Closed independent solids; touching boxes are deliberately not welded."""
    def __init__(self):
        self.v, self.f, self.mi = [], [], []

    def prism(self, corners, low, high, mat=0):
        n, start = len(corners), len(self.v)
        self.v.extend([(x, y, low(x, y) if callable(low) else low) for x, y in corners])
        self.v.extend([(x, y, high(x, y) if callable(high) else high) for x, y in corners])
        self.f.append(tuple(start+i for i in reversed(range(n))))
        self.f.append(tuple(start+n+i for i in range(n)))
        self.f.extend((start+i, start+(i+1)%n, start+n+(i+1)%n, start+n+i) for i in range(n))
        self.mi.extend([mat]*(n+2))

    def box(self, origin, along, outward, s0, s1, d0, d1, z0, z1, mat=0):
        p = [(origin[0]+along[0]*s+outward[0]*d,
              origin[1]+along[1]*s+outward[1]*d) for s,d in ((s0,d0),(s1,d0),(s1,d1),(s0,d1))]
        # Correct XY winding even when local basis is reflected.
        if old.area(p) < 0:
            p.reverse()
        self.prism(p, z0, z1, mat)

    def rod(self, a, b, radius, sides=12, mat=0):
        from mathutils import Vector
        a, b = Vector(a), Vector(b)
        direction = (b-a).normalized()
        u = direction.cross(Vector((0,0,1)))
        if u.length < .01:
            u = direction.cross(Vector((0,1,0)))
        u.normalize()
        v = direction.cross(u)
        start = len(self.v)
        for p in (a,b):
            self.v.extend(tuple(p+radius*(u*math.cos(i*math.tau/sides)+v*math.sin(i*math.tau/sides))) for i in range(sides))
        self.f.append(tuple(start+i for i in reversed(range(sides))))
        self.f.append(tuple(start+sides+i for i in range(sides)))
        self.f.extend((start+i,start+(i+1)%sides,start+sides+(i+1)%sides,start+sides+i) for i in range(sides))
        self.mi.extend([mat]*(sides+2))

    def finish(self, name, asset_id, materials, coll, extras, bevel=0):
        import bpy
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(self.v, [], self.f)
        mesh.update()
        obj = bpy.data.objects.new(name, mesh)
        coll.objects.link(obj)
        for material in materials:
            mesh.materials.append(material)
        for p,i in zip(mesh.polygons,self.mi):
            p.material_index = i
        obj['asset_id'], obj['export_asset'] = asset_id, True
        for k,v in extras.items():
            obj[k] = v if isinstance(v,(str,bool,int,float)) else json.dumps(v,ensure_ascii=False,sort_keys=True)
        obj['detail_version'] = 3
        if bevel:
            bpy.ops.object.select_all(action='DESELECT')
            obj.select_set(True)
            bpy.context.view_layer.objects.active = obj
            mod = obj.modifiers.new('实体边缘倒角', 'BEVEL')
            mod.width, mod.segments, mod.affect = bevel, 1, 'EDGES'
            mod.limit_method = 'ANGLE'
            bpy.ops.object.modifier_apply(modifier=mod.name)
        uv_map(obj)
        return obj


def material(name, color, rough=.6, metal=0, category=None, glass=False):
    import bpy
    mat = bpy.data.materials.new('V3 · '+name)
    mat.use_nodes = True
    mat.diffuse_color = (*color,1)
    node = mat.node_tree.nodes.get('Principled BSDF')
    node.inputs['Base Color'].default_value = (*color,1)
    node.inputs['Roughness'].default_value = rough
    node.inputs['Metallic'].default_value = metal
    if glass:
        node.inputs['IOR'].default_value = 1.5
        node.inputs['Coat Weight'].default_value = .35
        node.inputs['Coat Roughness'].default_value = .09
        # Mild transmission over interior geometry; glass remains legible at aerial scale.
        node.inputs['Transmission Weight'].default_value = .08
    if category:
        manifest = json.loads((OUT/'textures/manifest.json').read_text(encoding='utf-8'))
        cat = manifest.get('material_categories',manifest.get('materials',manifest)).get(category)
        if not cat:
            raise RuntimeError('Texture category not found: '+category)
        for key,socket in (('basecolor','Base Color'),('roughness','Roughness'),('normal',None)):
            val = cat.get('roughness_map') if key=='roughness' else cat.get(key) or cat.get(key+'_path')
            if isinstance(val,dict):
                val = val.get('path')
            if not val:
                continue
            path = Path(val)
            if not path.is_absolute():
                path = ROOT/path if (ROOT/path).is_file() else OUT/'textures'/path
            im = bpy.data.images.load(str(path),check_existing=True)
            im.colorspace_settings.name = 'sRGB' if key=='basecolor' else 'Non-Color'
            im.pack()
            tex = mat.node_tree.nodes.new('ShaderNodeTexImage')
            tex.image = im
            if key=='normal':
                normal = mat.node_tree.nodes.new('ShaderNodeNormalMap')
                normal.inputs['Strength'].default_value = .35 if category!='bark' else .65
                mat.node_tree.links.new(tex.outputs['Color'],normal.inputs['Color'])
                mat.node_tree.links.new(normal.outputs['Normal'],node.inputs['Normal'])
            else:
                mat.node_tree.links.new(tex.outputs['Color'],node.inputs[socket])
        mat['texture_source'] = 'deterministic procedural PBR material data generated in project; no reference photo embedded'
        mat['texture_category'] = category
    return mat


def base_materials():
    return {
        'stone':material('一号门浅灰石材',(.67,.64,.57),.78,category='stone'),
        'paint':material('一丹橙红金属饰面',(.62,.12,.035),.6,category='cladding'),
        'white':material('象牙白混凝土',(.77,.77,.73),.78,category='paint'),
        'roof':material('深灰屋面',(.16,.18,.18),.8,category='roof'),
        'paving':material('细颗粒石材铺装',(.48,.47,.43),.9,category='paving'),
        'black':material('校门黑灰金属',(.026,.034,.039),.42,.55),
        'silver':material('铝合金窗框',(.47,.50,.51),.32,.65),
        'glass':material('蓝灰建筑玻璃',(.24,.34,.39),.12,.12,glass=True),
        'glass-dark':material('深色窗玻璃',(.085,.15,.17),.17,.08,glass=True),
        'interior':material('幕墙后暗室内',(.025,.035,.037),.85),
        'sign':material('校名字金属',(.018,.065,.08),.36,.48),
        'grass':material('草地与绿化底层',(.18,.25,.12),1,category='ground'),
        'bark':material('树干',(.21,.14,.075),.96,category='bark'),
        'leaf':material('亚热带阔叶',(.07,.19,.065),.88,category='foliage'),
        'leaf-light':material('阔叶嫩梢',(.12,.25,.075),.9),
    }


def text_mesh(body, name, asset_id, loc, axis_x, axis_y, size, mat, coll, extras, font='C:/Windows/Fonts/msyh.ttc'):
    import bpy
    from mathutils import Matrix,Vector
    curve = bpy.data.curves.new(name,'FONT')
    curve.body,curve.size,curve.extrude,curve.resolution_u = body,size,.018,6
    curve.align_x,curve.align_y = 'CENTER','CENTER'
    if Path(font).is_file():
        curve.font = bpy.data.fonts.load(font)
    curve.materials.append(mat)
    obj = bpy.data.objects.new(name,curve)
    coll.objects.link(obj)
    x,y = Vector(axis_x),Vector(axis_y)
    obj.rotation_euler = Matrix((x,y,x.cross(y))).transposed().to_euler()
    obj.location = loc
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target='MESH')
    obj = bpy.context.view_layer.objects.active
    obj['asset_id'],obj['export_asset'],obj['detail_version'] = asset_id,True,3
    for k,v in extras.items():
        obj[k]=v if isinstance(v,(str,bool,float,int)) else json.dumps(v,ensure_ascii=False)
    return obj


def refine_gate(mats,ground):
    import bpy
    for obj in list(bpy.data.objects):
        if obj.get('feature_id')=='gate1':
            bpy.data.objects.remove(obj,do_unlink=True)
    coll=collection('V3 一号门 · 石材、结构、双语校名字')
    cfg=PREP['gate_model']
    c=cfg['centre_xy']; inward=cfg['inward_xy']; across=(inward[1],-inward[0])
    def p(u,v):
        return (c[0]+across[0]*u+inward[0]*v,c[1]+across[1]*u+inward[1]*v)
    base=max(ground.sample(*p(u,v)) for u in (-12,12,20) for v in (-3.5,3.5))+.1
    ext={'feature_id':'gate1','building_name':'一号门','role':'gate','sources':cfg['sources'],
         'dimensions_status':'photo-derived estimates; not surveyed','units':'metres',
         'lettering_status':'STXingkai/Arial approximation of photographed inscription; not exact calligraphy'}
    wall=Mesh(); panels=Mesh(); frame=Mesh(); sign=Mesh(); paving=Mesh()
    top=lambda x,y:base+9-.45*((((x-c[0])*across[0]+(y-c[1])*across[1])-16)/4)**2
    wall.box(c,across,inward,12,20,-.22,.28,lambda x,y:ground.sample(x,y)-.2,top)
    wall.finish('一号门 · 弧顶标志墙主体','gate1:sign-wall',[mats['stone']],coll,{**ext,'component':'gate-sign-wall'})
    # The wall receives real 8 mm recessed joints and 18 mm projecting stone cladding.
    for row in range(10):
        for col in range(7):
            u0=12+col*8/7+.004;u1=12+(col+1)*8/7-.004
            z0=base+row*.91+.004
            z1=lambda x,y,r=row:min(base+(r+1)*.91-.004,top(x,y)-.015)
            if min(top(*p(u,0)) for u in (u0,u1))>z0+.05:
                panels.box(c,across,inward,u0,u1,-.25,-.227,z0,z1)
    panels.finish('一号门 · 细分石材拼缝','gate1:stone-panels',[mats['stone']],coll,{**ext,'component':'stone-cladding'},.005)
    # Thin canopy, exposed soffit beams and all four slender support columns.
    frame.box(c,across,inward,-12,12,-3.5,3.5,base+3.28,base+3.4)
    for v in (-3.4,3.4):
        frame.box(c,across,inward,-12,12,v-.08,v+.08,base+3.08,base+3.28)
    for u in range(-11,13,2):
        frame.box(c,across,inward,u-.05,u+.05,-3.4,3.4,base+3.15,base+3.28)
    for u in (-9.6,9.6):
        for v in (-2.24,2.24):
            x,y=p(u,v)
            frame.rod((x,y,ground.sample(x,y)-.2),(x,y,base+3.28),.14,24)
            frame.box(c,across,inward,u-.22,u+.22,v-.22,v+.22,base,base+.07)
    # Slim stone-wall flank trim visible in the reference.
    frame.box(c,across,inward,19.86,20.05,-.255,.3,base,top)
    frame.finish('一号门 · 雨棚梁柱与包边','gate1:canopy-structure',[mats['black']],coll,{**ext,'component':'gate-canopy-structure'},.008)
    # Nearby tactile paving and granite pavers are a separately documented local grade.
    for i in range(38):
        for j in range(11):
            u0=-14+i;v0=-7+j
            paving.box(c,across,inward,u0+.008,u0+.992,v0+.008,v0+.992,base-.17,base-.10)
    paving.finish('一号门 · 近景花岗石铺装','gate1:local-paving',[mats['paving']],coll,
                  {**ext,'component':'landscape-paving','grading_status':'estimated local flat entrance paving; original DTM unchanged'},.004)
    tactile=material('米黄色盲道',(.65,.48,.16),.86)
    tile=Mesh()
    for i in range(76):
        for j in range(4):
            u=-13.8+i*.5;v=-5.1+j*.09
            tile.box(c,across,inward,u,u+.45,v,v+.026,base-.09,base-.077)
    tile.finish('一号门 · 黄盲道条纹','gate1:tactile-paving',[tactile],coll,{**ext,'component':'tactile-paving'})
    # Chinese inscription higher and to the right; English reads down alongside it.
    text_mesh('南\n方\n科\n技\n大\n学','一号门 · 立体中文校名','gate1:lettering',
              (*p(17.9,-.29),base+5.05),(*across,0),(0,0,1),.89,mats['sign'],coll,ext,
              'C:/Windows/Fonts/STXINGKA.TTF')
    text_mesh('SOUTHERN UNIVERSITY OF SCIENCE AND TECHNOLOGY','一号门 · 立体英文校名','gate1:english-lettering',
              (*p(16.76,-.29),base+5.05),(0,0,-1),(*across,0),.16,mats['sign'],coll,ext,
              'C:/Windows/Fonts/arialbd.ttf')
    return {'centre':c,'base':base,'inward':inward,'across':across}


def refine_yidan(mats):
    import bpy
    b=next(b for b in PREP['buildings'] if b['id']=='way/710848316')
    part=b['parts'][0];ring=part['rings'][0];base=part['base_z_m'];height=part['height_m']
    prior=next(o for o in bpy.data.objects if o.get('feature_id')==b['id'] and o.get('component')=='body')
    ext={k:prior[k] for k in prior.keys()}
    asset_id=prior['asset_id']
    for obj in list(bpy.data.objects):
        if obj.get('feature_id')==b['id'] and obj.get('export_asset'):
            bpy.data.objects.remove(obj,do_unlink=True)
    coll=collection('V3 一丹图书馆 · 西橙东玻璃、南端通高幕墙')
    ext.update({'detail_version':3,'facade_status':'west orange short-window side, east sawtooth curtain wall, south glazed high end, photo-derived layout',
                'height_status':'four storeys including shared base; estimated 20m high; south-high north-low roof corrected from public references',
                'reference_urls':b['sources'],'window_layout_status':'photo-informed irregular bands, approximate; not one-to-one survey'})
    y0,y1=min(p[1] for p in ring),max(p[1] for p in ring)
    roof=lambda x,y:base+height-4.5*(y-y0)/(y1-y0)
    # Original XY outline is retained. Roof slab, floor diaphragms and window backing are real geometry.
    body=Mesh();points,triangles=old.triangulate([ring])
    for low,high in ((base,base+.20),(base+4.7,base+4.9),(base+9.4,base+9.6),(lambda x,y:roof(x,y)-.18,roof)):
        for tri in triangles:
            body.prism([points[i] for i in tri],low,high)
    body.finish('一丹图书馆 · 原轮廓楼板和坡屋顶',asset_id,[mats['white']],coll,{**ext,'component':'body'})
    walls=Mesh();glass=Mesh();frames=Mesh();ribs=Mesh();inner=Mesh();rail=Mesh()
    rng=random.Random(710848316)
    # Discrete photographed facade zones (indices match original OSM boundary).
    for edge,(p,q) in enumerate(zip(ring,ring[1:]+ring[:1])):
        dx,dy=q[0]-p[0],q[1]-p[1];length=math.hypot(dx,dy)
        a=(dx/length,dy/length);out=(a[1],-a[0])
        # OSM ring CCW; reverse outward for clockwise sources.
        if old.area(ring)<0:out=(-out[0],-out[1])
        def xy(s,d=0):return (p[0]+a[0]*s+out[0]*d,p[1]+a[1]*s+out[1]*d)
        def rz(s):return roof(*xy(s))
        glazing=edge in (5,6,7)
        if glazing:
            bays=max(1,round(length/1.9))
            for col in range(bays):
                s0=length*col/bays;s1=length*(col+1)/bays
                # The eastern long side has projected folded glass bays, the southern end is planar.
                depth=.42 if edge==7 else 0
                frames.box(p,a,out,s0,s0+.065,-.19,depth+.10,base,lambda x,y:roof(x,y)-.03)
                for row in range(9):
                    z0=base+row*1.7;z1=min(base+(row+1)*1.7,min(rz(s0),rz(s1))-.03)
                    if z1<z0+.08:continue
                    glass.box(p,a,out,s0+.035,s1-.035,-.12,depth-.02,z0+.027,z1-.027,col%3==0)
                    frames.box(p,a,out,s0,s1,-.15,depth+.03,z0,z0+.055)
                inner.box(p,a,out,s0,s1,-.65,-.60,base+.23,lambda x,y:roof(x,y)-.21)
        else:
            bays=max(1,round(length/3.5))
            for col in range(bays):
                s0=length*col/bays+.007;s1=length*(col+1)/bays-.007
                edge_roof=min(rz(s0),rz(s1))
                rows=max(1,int((edge_roof-base)/1.65))
                for row in range(rows+1):
                    z0=base+row*1.65+.007;z1=min(z0+1.636,edge_roof-.02)
                    if z1<=z0+.07:continue
                    # Two characteristic broken bands, plus taller lower windows; blank panels remain plentiful.
                    active=(row in (2,3,5,6) and (col+row*2+edge)%5!=0) or (row in (0,1) and (col+edge)%4==0)
                    if active and z1-z0>.8 and s1-s0>1.3:
                        w=(s1-s0)*(.82 if row>2 else .68);mid=(s0+s1)*.5
                        wl,wr=mid-w/2,mid+w/2
                        h=.47 if row>1 else 1.12;wb=z0+.34+(.16 if (row+col)%2 else 0);wt=min(wb+h,z1-.12)
                        walls.box(p,a,out,s0,wl,-.43,.025,z0,z1)
                        walls.box(p,a,out,wr,s1,-.43,.025,z0,z1)
                        walls.box(p,a,out,wl,wr,-.43,.025,z0,wb)
                        walls.box(p,a,out,wl,wr,-.43,.025,wt,z1)
                        glass.box(p,a,out,wl+.018,wr-.018,-.20,-.17,wb+.025,wt-.025,(col+row)%4==0)
                        for sl,sr in ((wl,wl+.038),(wr-.038,wr)):
                            frames.box(p,a,out,sl,sr,-.22,-.125,wb,wt)
                        for zl,zr in ((wb,wb+.03),(wt-.03,wt)):
                            frames.box(p,a,out,wl,wr,-.22,-.125,zl,zr)
                    else:
                        walls.box(p,a,out,s0,s1,-.43,.025,z0,z1)
                ribs.box(p,a,out,s0-.055,s0+.055,-.04,.19,base+.02,lambda x,y:roof(x,y)-.015)
                # Close small residual sloped roof band above the last horizontal panel.
                band=base+(rows+1)*1.65
                if edge_roof>band+.03:
                    walls.box(p,a,out,s0,s1,-.43,.025,band,lambda x,y:roof(x,y)-.01)
            walls.box(p,a,out,0,length,-.44,.035,base,base+.22,1)
        # Fine roof perimeter, railing and floor-edge weathering trims.
        frames.box(p,a,out,0,length,-.1,.09,lambda x,y:roof(x,y)-.10,lambda x,y:roof(x,y)+.05)
        for n in range(max(1,math.ceil(length/.75))+1):
            s=length*n/max(1,math.ceil(length/.75));x,y=xy(s,-.12);z=roof(x,y)
            rail.rod((x,y,z+.04),(x,y,z+1.03),.015,8)
        x0,y00=xy(0,-.12);x1,y11=xy(length,-.12)
        rail.rod((x0,y00,roof(x0,y00)+1.03),(x1,y11,roof(x1,y11)+1.03),.021,8)
    for geom,name,aid,m,component,bevel in (
        (walls,'橙红面板与真实凹窗','panels',[mats['paint'],mats['white']],'photo-derived-cladding',.007),
        (ribs,'橙侧竖向浅肋','ribs',[mats['paint']],'vertical-ribs',.008),
        (glass,'南端与东长侧幕墙玻璃','glass',[mats['glass'],mats['glass-dark']],'glazing',0),
        (frames,'实体铝框、压条与窗套','frames',[mats['silver']],'window-frames',.006),
        (inner,'幕墙后暗层','interior',[mats['interior']],'interior-backing',0),
        (rail,'坡屋顶细栏杆','roof-rail',[mats['black']],'roof-railing',0)):
        geom.finish('一丹图书馆 · '+name,'v3:yidan:'+aid,m,coll,{**ext,'component':component},bevel)
    # Photographed bilingual sign beside the south glass end, on the last orange panel.
    p,q=ring[4],ring[5];a=((q[0]-p[0]),(q[1]-p[1]));l=math.hypot(*a);a=(a[0]/l,a[1]/l);out=(a[1],-a[0])
    loc=(p[0]+a[0]*(l-.7)+out[0]*.25,p[1]+a[1]*(l-.7)+out[1]*.25)
    text_mesh('一\n丹\n图\n书\n馆','一丹图书馆 · 白色中文馆名字','v3:yidan:chinese-sign',
              (*loc,base+10.4),(*a,0),(0,0,1),.72,mats['white'],coll,ext)
    text_mesh('Yidan Library','一丹图书馆 · 白色英文馆名字','v3:yidan:english-sign',
              (*loc,base+5.6),(0,0,-1),(*a,0),.40,mats['white'],coll,ext,'C:/Windows/Fonts/arialbd.ttf')
    return b


def upgrade_materials(mats):
    import bpy
    # Keep every other footprint and building volume. Improve physically meaningful surface response.
    for obj in bpy.context.scene.objects:
        if obj.type!='MESH' or not obj.get('export_asset') or obj.get('detail_version')==3:
            continue
        component=obj.get('component','')
        for i,mat in enumerate(obj.data.materials):
            name=mat.name.lower()
            target=None
            if component=='terrain':target=mats['grass']
            elif 'glass' in name:target=mats['glass-dark'] if 'dark' in name else mats['glass']
            elif 'roof' in name:target=mats['roof']
            elif 'frame' in name:target=mats['silver']
            elif 'walkway' in name:target=mats['paving']
            elif 'foundation' in name or 'white' in name or 'light-stone' in name:target=mats['white']
            elif 'wall' in name:
                color=mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value
                # Source-specific warm yellow engineering walls and warm science frames remain intact.
                if abs(color[0]-color[2])<.13 and color[0]>.65:target=mats['white']
            if target:
                obj.data.materials[i]=target
        if any(m and m.get('texture_category') for m in obj.data.materials):
            uv_map(obj,8 if component=='terrain' else 2)


def build_tree_templates(mats):
    """Broadleaf tree assets: tapered trunks, branching limbs, thousands of actual leaf silhouettes."""
    from mathutils import Vector
    coll=collection('V3 亚热带树木 · 共享枝叶网格')
    templates=[]
    for variant in range(8):
        rng=random.Random(800+variant);wood=Mesh();leaves=Mesh()
        wood.rod((0,0,0),(0,0,6.0),.16,12)
        for branch in range(16):
            angle=branch*2.399+rng.uniform(-.3,.3);radius=rng.uniform(1.3,3.2)
            end=Vector((math.cos(angle)*radius,math.sin(angle)*radius,rng.uniform(4.3,8)))
            start=Vector((0,0,rng.uniform(2.1,5)))
            wood.rod(start,end,.06 if branch<8 else .035,8)
            for twig in range(3):
                target=end+Vector((rng.uniform(-1.2,1.2),rng.uniform(-1.2,1.2),rng.uniform(.15,1)))
                wood.rod(end,target,.017,6)
                for n in range(30):
                    position=target+Vector((rng.gauss(0,.6),rng.gauss(0,.6),rng.gauss(0,.40)))
                    z=rng.uniform(-1,1);theta=rng.uniform(0,math.tau)
                    axis=Vector((math.cos(theta),math.sin(theta),z)).normalized()
                    width=axis.cross(Vector((0,0,1))).normalized()*rng.uniform(.045,.095)
                    length=axis*rng.uniform(.16,.31)
                    startidx=len(leaves.v)
                    leaves.v.extend(tuple(v) for v in (position-length,position-width,position+length,position+width,position+Vector((0,0,.022))))
                    leaves.f.extend((startidx+i,startidx+(i+1)%4,startidx+4) for i in range(4))
                    leaves.mi.extend([int(rng.random()<.22)]*4)
        w=wood.finish('阔叶树 · 枝干模板 '+str(variant),'v3:tree-template:wood:'+str(variant),[mats['bark']],coll,{'component':'vegetation','placement_status':'template hidden; shared mesh instances'})
        f=leaves.finish('阔叶树 · 叶片模板 '+str(variant),'v3:tree-template:leaves:'+str(variant),[mats['leaf'],mats['leaf-light']],coll,{'component':'vegetation','placement_status':'template hidden; shared mesh instances'})
        # Leaf cards are intentionally double-sided and do not need manifold solids.
        for mat in f.data.materials:mat.use_backface_culling=False
        for obj in (w,f):obj.hide_render=True;obj.hide_viewport=True;obj['export_asset']=False
        templates.append((w,f))
    return templates,coll


def vegetation(mats,ground):
    import bpy
    path=DOC/'vegetation-layout.json'
    if not path.is_file():raise RuntimeError('Vegetation source layout pending')
    doc=json.loads(path.read_text(encoding='utf-8'))
    points=doc.get('points',doc.get('trees',[]))
    templates,coll=build_tree_templates(mats)
    rng=random.Random(4343)
    for i,point in enumerate(points):
        xy=point.get('xy') or point.get('xy_m') or point.get('position_xy_m')
        if xy is None:xy=(point['x'],point['y'])
        h=point.get('height_m',10);r=point.get('crown_radius_m',point.get('radius_m',3))
        for component,template in zip(('wood','leaves'),templates[i%len(templates)]):
            obj=bpy.data.objects.new('绿化树 %03d · %s'%(i,component),template.data)
            coll.objects.link(obj)
            obj.location=(*xy,ground.sample(*xy)-.08)
            obj.rotation_euler.z=rng.uniform(0,math.tau)
            obj.scale=(r/3.6,r/3.6,h/8.5)
            obj['asset_id']='v3:tree:%04d:%s'%(i,component)
            obj['export_asset']=True
            obj['component']='vegetation'
            obj['detail_version']=3
            obj['placement_status']='approximate canopy position inferred from reference satellite vegetation pixels; species and individual tree dimensions estimated'
            obj['sources']='Esri World Imagery reference + official campus boundary; see vegetation-layout.json'
    return len(points)


def lookdev():
    import bpy
    scene=bpy.context.scene
    for obj in list(scene.objects):
        if obj.type=='LIGHT':bpy.data.objects.remove(obj,do_unlink=True)
    world=scene.world
    world.use_nodes=True
    nodes=world.node_tree.nodes;nodes.clear()
    out=nodes.new('ShaderNodeOutputWorld');bg=nodes.new('ShaderNodeBackground');sky=nodes.new('ShaderNodeTexSky')
    sky.sky_type='NISHITA';sky.sun_disc=False;sky.sun_elevation=math.radians(38);sky.sun_rotation=math.radians(220)
    sky.altitude=80;sky.air_density=1;sky.dust_density=.45
    bg.inputs['Strength'].default_value=.32
    world.node_tree.links.new(sky.outputs['Color'],bg.inputs['Color']);world.node_tree.links.new(bg.outputs[0],out.inputs[0])
    sun=bpy.data.lights.new('V3 下午柔日光','SUN');sun.energy=2.8;sun.angle=math.radians(1.8)
    obj=bpy.data.objects.new(sun.name,sun);scene.collection.objects.link(obj)
    obj.rotation_euler=tuple(math.radians(a) for a in (32,-22,-30))
    scene.render.engine='BLENDER_EEVEE'
    scene.eevee.taa_render_samples=96
    scene.render.film_transparent=False
    scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGB'
    scene.render.resolution_x=1800;scene.render.resolution_y=1200;scene.render.resolution_percentage=100
    scene.view_settings.view_transform='AgX'
    scene.view_settings.look='AgX - Medium High Contrast'
    scene.view_settings.exposure=-.15
    # Render scene environment is intentionally separate from glTF; web must recreate this lighting.
    scene['v3_lighting_status']='Nishita sky + soft sun / AgX. World sky is Blender lookdev; not embedded in glTF.'


def camera(name,target,direction,width=None,lens=45):
    import bpy
    from mathutils import Vector
    data=bpy.data.cameras.new(name);obj=bpy.data.objects.new(name,data)
    bpy.context.scene.collection.objects.link(obj)
    target=Vector(target);obj.location=target+Vector(direction)
    old.aim(obj,target)
    data.clip_start=.5;data.clip_end=10000;data.lens=lens;data.dof.use_dof=False
    if width:data.type='ORTHO';data.ortho_scale=width
    return obj


def set_cameras(gate,yidan):
    import bpy
    from mathutils import Vector
    c=gate['centre'];a=gate['across'];n=gate['inward'];z=gate['base']
    target=(c[0]+a[0]*5,c[1]+a[1]*5,z+3.8)
    camera('v3-gate1',target,(a[0]*12-n[0]*39,a[1]*12-n[1]*39,4),lens=42)
    target=(c[0]+a[0]*16.8,c[1]+a[1]*16.8,z+5.1)
    camera('v3-gate-stone-detail',target,(a[0]*4-n[0]*15,a[1]*4-n[1]*15,1),lens=56)
    c=yidan['centre_xy'];base=yidan['base_z_m'];target=(c[0],c[1]+6,base+6)
    camera('v3-yidan-orange',target,(-77,-52,33),lens=46)
    camera('v3-yidan-glass',target,(85,-63,22),lens=45)
    camera('v3-yidan-cladding-detail',(c[0]-5,c[1],base+7),(-28,-22,7),lens=60)
    for name,ids,direction,margin in (
        ('science',['relation/18716462'],(.8,-1,.85),1.3),
        ('engineering',['way/695571961','way/695571962'],(.8,-1,1),1.28),
        ('business',['way/703098307'],(.8,.8,.8),1.45),
        ('zhihua',['way/703098306'],(.8,.8,.9),1.35)):
        objects=[o for o in bpy.context.scene.objects if o.type=='MESH' and o.get('feature_id') in ids and o.get('component')=='body']
        points=[o.matrix_world@Vector(p) for o in objects for p in o.bound_box]
        lo=Vector([min(p[i] for p in points) for i in range(3)]);hi=Vector([max(p[i] for p in points) for i in range(3)])
        center=(lo+hi)/2;extent=hi-lo
        obj=camera('v3-'+name,center,Vector(direction).normalized()*extent.length*2)
        inv=obj.rotation_euler.to_matrix().transposed();view=[inv@(p-center) for p in points]
        width=max(p.x for p in view)-min(p.x for p in view);height=max(p.y for p in view)-min(p.y for p in view)
        obj.data.type='ORTHO';obj.data.ortho_scale=max(width,height*1.5)*margin
    scene=bpy.context.scene;scene.camera=bpy.data.objects.get('campus_aerial')
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type=='VIEW_3D':
                space=area.spaces.active
                space.clip_start,space.clip_end=5,12000
                space.shading.type='MATERIAL';space.shading.use_scene_world=True;space.shading.use_scene_lights=True
                if space.region_3d:
                    space.region_3d.view_location=Vector((450,1800,50));space.region_3d.view_distance=1400
    return scene


def build():
    import bpy
    OUT.mkdir(parents=True,exist_ok=True);DOC.mkdir(parents=True,exist_ok=True)
    sha=hashlib.sha256(SOURCE.read_bytes()).hexdigest()
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE),load_ui=False,use_scripts=False)
    ground=old.ground_from_prepared(PREP)
    mats=base_materials()
    gate=refine_gate(mats,ground)
    yidan=refine_yidan(mats)
    upgrade_materials(mats)
    secondary_path=ROOT/'scripts/refine-campus-landmarks-v3.py'
    if secondary_path.is_file():
        secondary_spec=importlib.util.spec_from_file_location('campus_secondary',secondary_path)
        secondary=importlib.util.module_from_spec(secondary_spec);secondary_spec.loader.exec_module(secondary)
        secondary.refine(bpy,PREP,mats,Mesh,collection)
    count=vegetation(mats,ground)
    lookdev();scene=set_cameras(gate,yidan)
    for coll in bpy.data.collections:
        if '标签' in coll.name:coll.hide_viewport=True;coll.hide_render=True
    scene['campus_model_version']=3
    scene['campus_model_scope']='Photo-derived detail samples gate1/Yidan; full original campus footprints retained; remaining buildings v2 architecture with PBR surface improvement'
    bpy.context.preferences.filepaths.save_version=0
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND),check_existing=False)
    assert hashlib.sha256(SOURCE.read_bytes()).hexdigest()==sha
    write(DOC/'refinement.json',{'status':'built','source_v2_sha256':sha,'blend':str(BLEND.relative_to(ROOT)),
          'refined_landmarks':['gate1','way/710848316'],'tree_count':count,
          'scope':'gate and Yidan geometry detail; remaining buildings v2 geometry with PBR materials',
          'limitations':['All new facade dimensions and divisions estimated from public photos.',
              'Original 30m DTM retained; local entrance paving is independent estimated grading.',
              'Other landmark geometry retains v2 approximation; not complete photogrammetric campus.',
              'Legacy v2 aggregate facade seams retained; new solids have independent topology.',
              'Blender sky and color management need corresponding web lighting.']})
    print('V3_BUILD_OK',flush=True)


def render(names,small=False):
    import bpy
    bpy.ops.wm.open_mainfile(filepath=str(BLEND),load_ui=False,use_scripts=False)
    scene=bpy.context.scene
    if small:scene.render.resolution_x=1100;scene.render.resolution_y=733;scene.eevee.taa_render_samples=48
    views=[]
    for name in names:
        scene.camera=bpy.data.objects[name]
        scene.render.filepath=str(OUT/(name+('.draft' if small else '')+'.png'))
        bpy.ops.render.render(write_still=True)
        views.append({'name':name,'camera_position':list(scene.camera.location),'image':str(Path(scene.render.filepath).relative_to(ROOT))})
        print('V3_RENDER_OK='+name,flush=True)
    write(DOC/('draft-cameras.json' if small else 'render-cameras.json'),views)


if __name__=='__main__':
    args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    if '--build' in args:build()
    elif '--render' in args:
        idx=args.index('--render');names=[a for a in args[idx+1:] if not a.startswith('--')]
        render(names or ['v3-gate1','v3-yidan-orange','v3-yidan-glass','campus_aerial'], '--draft' in args)
    else:raise SystemExit('Pass -- --build or --render [camera names] [--draft]')
