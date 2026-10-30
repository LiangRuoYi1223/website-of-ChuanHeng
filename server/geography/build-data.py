"""Fetch public boundaries only, never user coordinates; build offline city polygons.
Run explicitly: python server/geography/build-data.py
Pillow/GIS packages and cloud credentials are not required.
"""
import concurrent.futures
import datetime
import hashlib
import io
import json
from pathlib import Path
import struct
import sys
import time
from urllib.parse import quote
from urllib.request import Request, urlopen
import zipfile

DIRECTORY = Path(__file__).resolve().parent
ROOT_URL = 'https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json'
TAIWAN_URL = 'https://maps.nlsc.gov.tw/download/縣市界線(TWD97經緯度).zip'
MUNICIPAL = {110000,120000,310000,500000,810000,820000}
TOLERANCE = 0.0003
sources = []


def fetch(url):
    url = quote(url, safe=':/()?=&%')
    for attempt in range(3):
        try:
            with urlopen(Request(url, headers={'User-Agent':'Chuanheng-offline-boundary-builder/1.0'}),timeout=60) as response:
                data=response.read(25*1024*1024+1)
                if len(data)>25*1024*1024: raise ValueError('Public boundary download exceeds limit')
            return data, {'url':url,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
        except Exception:
            if attempt==2: raise
            time.sleep(1)


def simplify_open(points):
    keep={0,len(points)-1}
    stack=[(0,len(points)-1)]
    while stack:
        start,end=stack.pop()
        ax,ay=points[start]; bx,by=points[end]
        dx,dy=bx-ax,by-ay; length=dx*dx+dy*dy
        maximum=0; chosen=None
        for index in range(start+1,end):
            px,py=points[index]
            t=max(0,min(1,((px-ax)*dx+(py-ay)*dy)/length)) if length else 0
            distance=(px-ax-t*dx)**2+(py-ay-t*dy)**2
            if distance>maximum: maximum=distance;chosen=index
        if chosen is not None and maximum>TOLERANCE*TOLERANCE:
            keep.add(chosen);stack.extend([(start,chosen),(chosen,end)])
    return [points[index] for index in sorted(keep)]


def simplify_ring(ring):
    points=[(float(point[0]),float(point[1])) for point in ring]
    if points[0]!=points[-1]: points.append(points[0])
    if len(points)>5:
        split=max(range(1,len(points)-1),key=lambda index:(points[index][0]-points[0][0])**2+(points[index][1]-points[0][1])**2)
        reduced=simplify_open(points[:split+1])[:-1]+simplify_open(points[split:])
        if len(set(reduced))>=3: points=reduced
    result=[]
    for point in points:
        rounded=[round(point[0],5),round(point[1],5)]
        if not result or rounded!=result[-1]: result.append(rounded)
    if result[0]!=result[-1]:result.append(result[0])
    if len(set(map(tuple,result)))<3:
        result=[[round(point[0],7),round(point[1],7)] for point in ring]
        if result[0]!=result[-1]: result.append(result[0])
    return result


def feature(province,city,adcode,crs,rings,level):
    points=[point for ring in rings for point in ring]
    return {'province':province,'city':city,'adcode':str(adcode),'crs':crs,'level':level,
            'bbox':[min(point[0] for point in points),min(point[1] for point in points),max(point[0] for point in points),max(point[1] for point in points)],
            'rings':[simplify_ring(ring) for ring in rings]}


def geometry_rings(geometry):
    if geometry['type']=='Polygon':return geometry['coordinates']
    if geometry['type']=='MultiPolygon':return [ring for polygon in geometry['coordinates'] for ring in polygon]
    raise ValueError('Boundary is not polygonal')


def read_dbf(raw,encoding):
    count=struct.unpack_from('<I',raw,4)[0]
    header,size=struct.unpack_from('<HH',raw,8)
    fields=[];offset=32
    while raw[offset]!=13:
        descriptor=raw[offset:offset+32]
        fields.append((descriptor[:11].split(b'\0')[0].decode('ascii'),descriptor[16]));offset+=32
    rows=[]
    for index in range(count):
        cursor=header+index*size+1;row={}
        for name,length in fields:
            row[name]=raw[cursor:cursor+length].strip(b' \0').decode(encoding);cursor+=length
        rows.append(row)
    return rows


def read_shp(raw):
    if struct.unpack_from('>I',raw,0)[0]!=9994:raise ValueError('Invalid NLSC shapefile')
    rows=[];offset=100
    while offset<len(raw):
        size=struct.unpack_from('>I',raw,offset+4)[0]*2;record=raw[offset+8:offset+8+size]
        if struct.unpack_from('<I',record,0)[0]!=5:raise ValueError('Expected polygon SHP')
        parts,count=struct.unpack_from('<II',record,36)
        starts=list(struct.unpack_from(f'<{parts}I',record,44))+[count]
        point_start=44+parts*4
        points=[struct.unpack_from('<dd',record,point_start+index*16) for index in range(count)]
        rows.append([points[starts[index]:starts[index+1]] for index in range(parts)])
        offset+=size+8
    return rows


def main():
    root_raw,root_source=fetch(ROOT_URL);sources.append(root_source)
    root=json.loads(root_raw)
    provinces=[item for item in root['features'] if isinstance(item.get('properties',{}).get('adcode'),int) and item['properties'].get('level')=='province']
    if len(provinces)!=34:raise ValueError('Expected 34 provincial units')
    result=[]
    for item in provinces:
        props=item['properties']
        if props['adcode'] in MUNICIPAL:
            result.append(feature(props['name'],props['name'],props['adcode'],'GCJ02',geometry_rings(item['geometry']),'municipality'))
    ordinary=[item for item in provinces if item['properties']['adcode'] not in MUNICIPAL|{710000}]
    def download(item):
        props=item['properties'];url=f"https://geo.datav.aliyun.com/areas_v3/bound/{props['adcode']}_full.json"
        raw,source=fetch(url);data=json.loads(raw)
        rows=[feature(props['name'],child['properties']['name'],child['properties']['adcode'],'GCJ02',geometry_rings(child['geometry']),child['properties'].get('level','city')) for child in data['features'] if isinstance(child.get('properties',{}).get('adcode'),int)]
        return rows,source
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for index,(rows,source) in enumerate(pool.map(download,ordinary),1):
            result.extend(rows);sources.append(source);print(f'DataV province boundary sources: {index}/{len(ordinary)}',flush=True)

    if '--taiwan-archive' in sys.argv:
        taiwan_raw=Path(sys.argv[sys.argv.index('--taiwan-archive')+1]).read_bytes()
        taiwan_source={'url':quote(TAIWAN_URL,safe=':/()'),'bytes':len(taiwan_raw),'sha256':hashlib.sha256(taiwan_raw).hexdigest()}
    else: taiwan_raw,taiwan_source=fetch(TAIWAN_URL)
    sources.append(taiwan_source)
    with zipfile.ZipFile(io.BytesIO(taiwan_raw)) as archive:
        shp=next(name for name in archive.namelist() if name.lower().endswith('.shp'));base=shp[:-4]
        find=lambda suffix:next(name for name in archive.namelist() if name.lower()==(base+suffix).lower())
        projection=archive.read(find('.prj')).decode('ascii')
        if not any(value in projection for value in ['TWD97','TWD_1997']) or 'PROJCS' in projection:raise ValueError('NLSC data must be TWD97 geographic coordinates')
        cpg=next((name for name in archive.namelist() if name.lower()==(base+'.cpg').lower()),None)
        encoding=archive.read(cpg).decode('ascii').strip() if cpg else 'big5'
        if encoding=='950':encoding='big5'
        properties=read_dbf(archive.read(find('.dbf')),encoding);shapes=read_shp(archive.read(shp))
        if len(properties)!=22 or len(shapes)!=22:raise ValueError('Expected 22 Taiwan county/city polygons')
        for props,rings in zip(properties,shapes):result.append(feature('台湾省',props['COUNTYNAME'],'TW-'+props['COUNTYCODE'],'TWD97',rings,'county-city'))
        taiwan_source.update({'file':shp,'projection':projection,'license':'政府資料開放授權條款－第1版'})
    result.sort(key=lambda item:item['adcode'])
    if len(result)<390:raise ValueError('Incomplete national coverage')
    license_raw,license_source=fetch('https://raw.githubusercontent.com/wandergis/coordtransform/master/LICENSE')
    (DIRECTORY/'coordtransform.LICENSE.txt').write_bytes(license_raw);sources.append(license_source)
    vertex_count=sum(len(ring) for item in result for ring in item['rings'])
    for item in result:
        packed=[]
        for ring in item['rings']:
            values=[];previous=(0,0)
            for point in ring:
                current=(round(point[0]*100000),round(point[1]*100000))
                values.extend([current[0]-previous[0],current[1]-previous[1]])
                previous=current
            packed.append(values)
        item['rings']=packed
    dataset={'version':1,'id':'chuanheng-offline-city-boundaries-v1','retrievedAt':str(datetime.date.today()),'boundaryGuardM':500,'simplificationToleranceDegrees':TOLERANCE,'coordinateEncoding':'delta-int','coordinateScale':100000,'features':result}
    raw=json.dumps(dataset,ensure_ascii=False,separators=(',',':')).encode('utf-8')
    (DIRECTORY/'china-cities.compact.json').write_bytes(raw)
    manifest={'retrievedAt':dataset['retrievedAt'],'featureCount':len(result),'vertexCount':vertex_count,'datasetBytes':len(raw),'datasetSHA256':hashlib.sha256(raw).hexdigest(),'sources':sources}
    (DIRECTORY/'source-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(f"Built {len(result)} real city/prefecture/county-city boundaries, {len(raw)} bytes.",flush=True)


if __name__=='__main__':main()
