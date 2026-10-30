import boundaries from '../geography/china-cities.compact.json' with { type: 'json' };

const METRES_PER_DEGREE = 111195.0802335329;
const validPoint = point => Array.isArray(point) && typeof point[0] === 'number' && typeof point[1] === 'number' && Number.isFinite(point[0]) && Number.isFinite(point[1]) && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90;

// Adapted from wandergis/coordtransform (MIT); see geography/SOURCE.md and
// geography/coordtransform.LICENSE.txt. This is local mathematical conversion,
// not an online AMAP request or a claim of survey-grade datum transformation.
export function wgs84ToGcj02([lon, lat]) {
  if (!(lon > 73.66 && lon < 135.05 && lat > 3.86 && lat < 53.55)) return [lon, lat];
  const x = lon - 105;
  const y = lat - 35;
  let dLat = -100 + 2*x + 3*y + .2*y*y + .1*x*y + .2*Math.sqrt(Math.abs(x));
  dLat += (20*Math.sin(6*x*Math.PI) + 20*Math.sin(2*x*Math.PI))*2/3;
  dLat += (20*Math.sin(y*Math.PI) + 40*Math.sin(y/3*Math.PI))*2/3;
  dLat += (160*Math.sin(y/12*Math.PI) + 320*Math.sin(y*Math.PI/30))*2/3;
  let dLon = 300 + x + 2*y + .1*x*x + .1*x*y + .1*Math.sqrt(Math.abs(x));
  dLon += (20*Math.sin(6*x*Math.PI) + 20*Math.sin(2*x*Math.PI))*2/3;
  dLon += (20*Math.sin(x*Math.PI) + 40*Math.sin(x/3*Math.PI))*2/3;
  dLon += (150*Math.sin(x/12*Math.PI) + 300*Math.sin(x/30*Math.PI))*2/3;
  const radians = lat / 180 * Math.PI;
  const magic = 1 - .00669342162296594323 * Math.sin(radians) ** 2;
  const sqrt = Math.sqrt(magic);
  dLat = dLat * 180 / ((6378245 * (1 - .00669342162296594323)) / (magic * sqrt) * Math.PI);
  dLon = dLon * 180 / (6378245 / sqrt * Math.cos(radians) * Math.PI);
  return [lon + dLon, lat + dLat];
}

function boundsOf(values) {
  const result = [Infinity, Infinity, -Infinity, -Infinity];
  for (let index = 0; index < values.length; index += 2) {
    result[0] = Math.min(result[0], values[index]); result[2] = Math.max(result[2], values[index]);
    result[1] = Math.min(result[1], values[index+1]); result[3] = Math.max(result[3], values[index+1]);
  }
  return result;
}

function normalizeFeature(feature, dataset) {
  const rings = feature.rings.map(ring => {
    const values = new Float64Array(dataset.coordinateEncoding === 'delta-int' ? ring.length : ring.length * 2);
    if (dataset.coordinateEncoding === 'delta-int') {
      let x = 0; let y = 0;
      for (let index = 0; index < ring.length; index += 2) {
        x += ring[index]; y += ring[index+1];
        values[index] = x / dataset.coordinateScale;
        values[index+1] = y / dataset.coordinateScale;
      }
    } else for (let index = 0; index < ring.length; index++) {
      values[index*2] = ring[index][0]; values[index*2+1] = ring[index][1];
    }
    return { values, bbox: boundsOf(values) };
  });
  const bbox = [Infinity,Infinity,-Infinity,-Infinity];
  for (const ring of rings) {
    bbox[0]=Math.min(bbox[0],ring.bbox[0]); bbox[1]=Math.min(bbox[1],ring.bbox[1]);
    bbox[2]=Math.max(bbox[2],ring.bbox[2]); bbox[3]=Math.max(bbox[3],ring.bbox[3]);
  }
  return { province:feature.province,city:feature.city,adcode:feature.adcode,crs:feature.crs,rings,bbox };
}

function insideBounds([x,y], [left,bottom,right,top], dx=0, dy=dx) {
  return x >= left-dx && x <= right+dx && y >= bottom-dy && y <= top+dy;
}

function inspectFeature(point, feature, guardM) {
  const [x,y] = point;
  const lonScale = METRES_PER_DEGREE * Math.max(.01,Math.cos(y*Math.PI/180));
  const latGuard = guardM/METRES_PER_DEGREE;
  const lonGuard = guardM/lonScale;
  if (!insideBounds(point,feature.bbox,lonGuard,latGuard)) return { inside:false,near:false };
  let inside = false;
  for (const {values,bbox} of feature.rings) {
    if (!insideBounds(point,bbox,lonGuard,latGuard)) continue;
    for (let index=0,previous=values.length-2; index<values.length; previous=index,index+=2) {
      const ax=values[previous],ay=values[previous+1],bx=values[index],by=values[index+1];
      if ((ay>y)!==(by>y) && x < (bx-ax)*(y-ay)/(by-ay)+ax) inside=!inside;
      if (x < Math.min(ax,bx)-lonGuard || x > Math.max(ax,bx)+lonGuard || y < Math.min(ay,by)-latGuard || y > Math.max(ay,by)+latGuard) continue;
      const px=(ax-x)*lonScale,py=(ay-y)*METRES_PER_DEGREE;
      const dx=(bx-ax)*lonScale,dy=(by-ay)*METRES_PER_DEGREE;
      const length=dx*dx+dy*dy;
      const t=length ? Math.max(0,Math.min(1,-(px*dx+py*dy)/length)) : 0;
      if ((px+t*dx)**2+(py+t*dy)**2 <= guardM*guardM) return { inside:false,near:true };
    }
  }
  return { inside,near:false };
}

/** Build an entirely offline spatial index. Dataset injection is for controlled
 * tests/rebuilds, never user-provided boundary definitions or remote queries. */
export function createLocator(dataset) {
  const features = dataset.features.map(feature => normalizeFeature(feature,dataset));
  const guardM = Math.max(0,Number(dataset.boundaryGuardM) || 0);
  const indexes = new Map();
  for (const feature of features) {
    if (!indexes.has(feature.crs)) indexes.set(feature.crs,new Map());
    const grid=indexes.get(feature.crs);
    const padding=guardM/METRES_PER_DEGREE/.2 + .0001;
    for(let x=Math.floor(feature.bbox[0]-padding);x<=Math.floor(feature.bbox[2]+padding);x++) {
      for(let y=Math.floor(feature.bbox[1]-padding);y<=Math.floor(feature.bbox[3]+padding);y++) {
        const key=`${x},${y}`;
        if(!grid.has(key)) grid.set(key,[]);
        grid.get(key).push(feature);
      }
    }
  }
  const source = Object.freeze({ id:dataset.id,provider:'DataV.GeoAtlas / NLSC',method:'offline-point-in-polygon',inputCoordinateSystem:'WGS84',boundaryCoordinateSystems:[...indexes.keys()],retrievedAt:dataset.retrievedAt || null,boundaryGuardM:guardM,simplificationToleranceDegrees:dataset.simplificationToleranceDegrees || 0,coverage:'all-recorded-points',interpolatesBetweenPoints:false });

  const matchPoint = point => {
    const matches=[];
    let uncertain=false;
    for(const [crs,grid] of indexes) {
      // NLSC's geographic TWD97 is used at the same coordinate scale as WGS84;
      // sub-metre datum differences are far below the explicit 500 m guard.
      const query=crs==='GCJ02' ? wgs84ToGcj02(point) : point;
      for(const candidate of grid.get(`${Math.floor(query[0])},${Math.floor(query[1])}`) || []) {
        const result=inspectFeature(query,candidate,guardM);
        if(result.near) uncertain=true;
        if(result.inside) matches.push(candidate);
      }
    }
    if(uncertain || matches.length>1) return {feature:null,reason:'boundary'};
    return {feature:matches[0] || null,reason:matches.length ? null : 'outside'};
  };

  return function locate(track) {
    const result={coordinates:null,province:null,city:null,adcode:null,locations:[],locationStatus:'unmatched',source,checkedPointCount:0,matchedPointCount:0,totalPointCount:0,warnings:[]};
    const geometry=track?.geojson?.geometry;
    const segments=geometry?.type==='MultiLineString' ? geometry.coordinates : null;
    if(!Array.isArray(segments) || segments.length===0 || segments.length>100 || segments.some(segment=>!Array.isArray(segment))) {
      result.warnings.push('没有可用于离线行政区匹配的有效轨迹。'); return result;
    }
    const points=segments.flat();
    result.totalPointCount=points.length;
    if(!points.length || points.length>30000 || points.some(point=>!validPoint(point))) {
      result.warnings.push('轨迹坐标无效或超过本地定位上限，未推测省市。'); return result;
    }
    result.coordinates=points[0].slice(0,2);
    const cache=new Map();
    let hasBoundary=false;
    for(const [segmentIndex,segment] of segments.entries()) {
      const visited=new Set();
      for(const point of segment) {
        const key=`${point[0]},${point[1]}`;
        if(!cache.has(key)) cache.set(key,matchPoint(point));
        const match=cache.get(key);
        if(match.reason==='boundary') hasBoundary=true;
        if(result.checkedPointCount===0 && match.feature) {
          result.province=match.feature.province; result.city=match.feature.city; result.adcode=match.feature.adcode;
        }
        result.checkedPointCount++;
        if(!match.feature) continue;
        result.matchedPointCount++;
        if(visited.has(match.feature.adcode)) continue;
        visited.add(match.feature.adcode);
        result.locations.push({province:match.feature.province,city:match.feature.city,adcode:match.feature.adcode,segmentIndex,coordinates:point.slice(0,2)});
      }
    }
    if(result.matchedPointCount) result.locationStatus=result.matchedPointCount===result.totalPointCount ? 'matched' : 'partial';
    if(hasBoundary) result.warnings.push(`部分坐标位于简化行政区边界附近（保守排除 ${guardM} 米），或边界重叠；这些点未自动确定省市。`);
    if(result.matchedPointCount<result.totalPointCount) result.warnings.push('部分或全部轨迹点不在可确认的离线省市范围内；未使用最近城市补填。');
    return result;
  };
}

// Server/Worker only: importing this module never fetches or transmits a track.
export const locateTrack=createLocator(boundaries);
