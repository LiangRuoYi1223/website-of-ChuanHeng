"""Fetch a public satellite reference, retaining export extent and attribution."""
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen
import hashlib, json, math, sys, io
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'artifacts/campus-model/references'
SERVICE = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer'
sys.path.insert(0,str(ROOT/'artifacts/mountain-prep/python-tools'))
from PIL import Image

def tile_mosaic():
    z=17; n=2**z
    west,south,east,north = 113.988,22.594,114.005,22.613
    def pixel(lon,lat):
        return ((lon+180)/360*n*256,(1-math.asinh(math.tan(math.radians(lat)))/math.pi)/2*n*256)
    x0,y0=pixel(west,north); x1,y1=pixel(east,south)
    c0,r0,c1,r1=math.floor(x0/256),math.floor(y0/256),math.floor(x1/256),math.floor(y1/256)
    coordinates=[(c,r) for r in range(r0,r1+1) for c in range(c0,c1+1)]
    if len(coordinates)>160: raise ValueError('Satellite request larger than campus scope')
    def get_tile(cr):
        c,r=cr; url=f'{SERVICE}/tile/{z}/{r}/{c}'
        raw=fetch(url)
        with Image.open(io.BytesIO(raw)) as im:
            if im.size!=(256,256): raise ValueError('Unexpected tile shape')
            tile=im.convert('RGB')
        return c,r,tile,{'url':url,'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}
    mosaic=Image.new('RGB',((c1-c0+1)*256,(r1-r0+1)*256)); records=[]
    with ThreadPoolExecutor(max_workers=6) as pool:
        for c,r,tile,record in pool.map(get_tile,coordinates):
            mosaic.paste(tile,((c-c0)*256,(r-r0)*256));records.append(record)
    def metres(x,y):
        span=2*math.pi*6378137
        return x/(n*256)*span-span/2, span/2-y/(n*256)*span
    xmin,ymax=metres(c0*256,r0*256);xmax,ymin=metres((c1+1)*256,(r1+1)*256)
    payload=io.BytesIO(); mosaic.save(payload,format='PNG')
    return payload.getvalue(),{'method':'cached native Web Mercator tiles mosaicked without resampling','zoom':z,
       'extent':{'xmin':xmin,'ymin':ymin,'xmax':xmax,'ymax':ymax,'spatialReference':{'wkid':3857}},
       'width':mosaic.width,'height':mosaic.height,'tile_records':records}

def fetch(url):
    with urlopen(Request(url, headers={'User-Agent':'Chuanheng-Campus-Reference/1.0'}), timeout=90) as r:
        return r.read()

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    service = json.loads(fetch(SERVICE+'?f=pjson'))
    params = {'bbox':'113.987,22.592,114.010,22.615','bboxSR':4326,
              'imageSR':3857,'size':'3072,3072','format':'png32','f':'pjson'}
    export_url = SERVICE+'/export?'+urlencode(params)
    exported = json.loads(fetch(export_url))
    if 'error' in exported:
        print('Map export unavailable; reading cached campus satellite tiles.',flush=True)
        data, tile_meta=tile_mosaic()
        exported={'export_error':exported['error'],**tile_meta}
    else:
        data = fetch(exported['href'])
    if not data.startswith(b'\x89PNG'): raise ValueError('Expected satellite PNG')
    path = OUT / 'sustech_satellite_esri.png'; path.write_bytes(data)
    record = {'source':'Esri World Imagery public map export', 'service_url':SERVICE,
              'export_request_url':export_url,'export_metadata':exported,
              'copyright_text':service.get('copyrightText'),
              'acquired_utc':datetime.now(timezone.utc).isoformat(),
              'image_capture_date':'not established; do not infer from download date',
              'use':'visual positioning/cross-check reference; not a published model texture',
              'local_path':path.relative_to(ROOT).as_posix(),'bytes':len(data),
              'sha256':hashlib.sha256(data).hexdigest()}
    (OUT/'satellite-source.json').write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'path':record['local_path'],'bytes':len(data),'extent':exported['extent'],'attribution':record['copyright_text']},ensure_ascii=True))

if __name__=='__main__': main()
