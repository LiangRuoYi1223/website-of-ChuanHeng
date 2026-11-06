import {buildCachedTrackMapModel} from './cached-basemap.js';

export const MAX_TRACK_BYTES = 5 * 1024 * 1024;
function validTrackResult(track) {
  return track?.version===1 && track.geojson && Array.isArray(track.profile) && track.profile.length<=30000
    && Number.isSafeInteger(track.pointCount) && track.pointCount>0 && track.pointCount<=30000
    && Number.isSafeInteger(track.segmentCount) && track.segmentCount>0 && track.segmentCount<=100
    && (track.name==null||typeof track.name==='string') && (track.sourceFile==null||typeof track.sourceFile==='string')
    && Array.isArray(track.segments) && track.segments.length<=100 && track.segments.every(segment=>segment&&typeof segment==='object'&&!Array.isArray(segment)
      && Number.isSafeInteger(segment.index)&&segment.index>=0&&segment.index<100&&(segment.name==null||typeof segment.name==='string'));
}
export async function convertTrackFile(file, {token, signal, prepareBasemap=false, fetchImpl = fetch} = {}) {
  if (!file || !/\.(gpx|kml)$/i.test(file.name)) throw new Error('请选择 GPX 或 KML 文件（暂不支持压缩 KMZ）。');
  if (!file.size) throw new Error('文件为空，请重新选择。');
  if (file.size > MAX_TRACK_BYTES) throw new Error('文件不能超过 5 MiB，请先分割或精简轨迹。');
  const body = new FormData(); body.append('file',file);
  const headers = token ? {Authorization:`Bearer ${token}`} : {};
  let response;
  try { response = await fetchImpl(`/api/tracks/convert${prepareBasemap?'?basemap=1':''}`,{method:'POST',headers,body,signal}); }
  catch(error) {
    if (error.name === 'AbortError' || signal?.aborted) throw error;
    throw new Error('无法连接轨迹转换服务，请确认本地网站正在运行后重试。');
  }
  let data;
  try { data = await response.json(); } catch { throw new Error('轨迹转换服务尚未启动，请重新启动本地网站。'); }
  if (!response.ok) throw new Error(data?.error?.message || '转换失败，请检查文件后重试。');
  if (!validTrackResult(data?.track)) throw new Error('转换服务返回的轨迹数据无效，请重试。');
  if (prepareBasemap && !buildCachedTrackMapModel(data.track)) throw new Error('服务未返回覆盖该路线的有效底图，原路线保留，请重试。');
  return data.track;
}

export async function generateTrackBasemap(track,{token,signal,fetchImpl=fetch}={}) {
  if(!track?.geojson?.geometry || !['LineString','MultiLineString'].includes(track.geojson.geometry.type)) throw new Error('这条路线缺少有效坐标，无法生成底图。');
  const headers={'content-type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})};
  let response;
  try {response=await fetchImpl('/api/tracks/basemap',{method:'POST',headers,body:JSON.stringify({geojson:track.geojson}),signal});}
  catch(error){if(error.name==='AbortError'||signal?.aborted)throw error;throw new Error('无法连接底图服务，请稍后重试。');}
  let data;
  try{data=await response.json();}catch{throw new Error('底图服务返回了无效结果，请稍后重试。');}
  if(!response.ok)throw new Error(data?.error?.message||'底图生成失败，原路线保留，请稍后重试。');
  const model=buildCachedTrackMapModel({...track,basemap:data?.basemap});
  if(!model)throw new Error('服务未返回覆盖该路线的有效底图，原路线保留，请重试。');
  return model.basemap;
}
export function downloadTrackJson(track, geojsonOnly = false) {
  const blob = new Blob([JSON.stringify(geojsonOnly ? track.geojson : track,null,2)],{type:geojsonOnly ? 'application/geo+json' : 'application/json'});
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');link.href = url;
  link.download = `${String(track.name || 'track').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').slice(0,80)}.${geojsonOnly ? 'geojson' : 'json'}`;
  document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
