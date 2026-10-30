export const MAX_TRACK_BYTES = 5 * 1024 * 1024;
export async function convertTrackFile(file, {token, signal, fetchImpl = fetch} = {}) {
  if (!file || !/\.(gpx|kml)$/i.test(file.name)) throw new Error('请选择 GPX 或 KML 文件（暂不支持压缩 KMZ）。');
  if (!file.size) throw new Error('文件为空，请重新选择。');
  if (file.size > MAX_TRACK_BYTES) throw new Error('文件不能超过 5 MiB，请先分割或精简轨迹。');
  const body = new FormData(); body.append('file',file);
  const headers = token ? {Authorization:`Bearer ${token}`} : {};
  let response;
  try { response = await fetchImpl('/api/tracks/convert',{method:'POST',headers,body,signal}); }
  catch(error) {
    if (error.name === 'AbortError' || signal?.aborted) throw error;
    throw new Error('无法连接轨迹转换服务，请确认本地网站正在运行后重试。');
  }
  let data;
  try { data = await response.json(); } catch { throw new Error('轨迹转换服务尚未启动，请重新启动本地网站。'); }
  if (!response.ok) throw new Error(data?.error?.message || '转换失败，请检查文件后重试。');
  if (data?.track?.version !== 1 || !data.track.geojson || !Array.isArray(data.track.profile)) throw new Error('转换服务返回的轨迹数据无效，请重试。');
  return data.track;
}
export function downloadTrackJson(track, geojsonOnly = false) {
  const blob = new Blob([JSON.stringify(geojsonOnly ? track.geojson : track,null,2)],{type:geojsonOnly ? 'application/geo+json' : 'application/json'});
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');link.href = url;
  link.download = `${String(track.name || 'track').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').slice(0,80)}.${geojsonOnly ? 'geojson' : 'json'}`;
  document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
