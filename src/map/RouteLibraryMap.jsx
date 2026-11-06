import { useEffect, useMemo, useState } from 'react';
import { buildCachedTrackMapModel } from '../tracks/cached-basemap.js';
import { buildTrackMapModel } from '../tracks/visualization-helpers.js';
import CachedTrackMap from '../tracks/CachedTrackMap.jsx';
import { CoordinateTrack } from '../tracks/TrackVisualization.jsx';
import './route-library-map.css';

export default function RouteLibraryMap({ items = [], selected, onSelect }) {
  const routes = items.filter(item => item && !item.isDemo && !item.localDraft && !item.archived && typeof item.id === 'string' && typeof item.title === 'string' && item.title.trim());
  const current = routes.find(item => item.id === selected?.id) || routes[0];
  const track = current?.track;
  const cached = useMemo(() => buildCachedTrackMapModel(track), [track]);
  const geometry = useMemo(() => buildTrackMapModel(track), [track]);
  const [failedImage, setFailedImage] = useState(null);
  useEffect(() => setFailedImage(null), [current?.id, track]);
  const saved = cached && cached.basemap.image !== failedImage;

  return <div className="route-library-map">
    {routes.length ? <>
      <div className="rlm-route-options" role="group" aria-label="选择地图中的路线">{routes.map(item => <button type="button" key={item.id} aria-pressed={current.id === item.id} onClick={() => onSelect?.(item)}>{item.title}</button>)}</div>
      <div className="rlm-map-title"><h3>{current.title}</h3><span>{saved ? '已保存底图' : '坐标轨迹'}</span></div>
      {!saved && <p className="rlm-map-notice" role="status">{failedImage ? '已保存底图暂时无法显示，当前展示真实坐标轨迹。' : track?.basemap ? '已保存底图与轨迹不匹配或数据无效，当前展示真实坐标轨迹。' : '此路线尚未保存地图底图，当前仅显示本地坐标。'}</p>}
      <div className="tv-map-frame">{saved ? <CachedTrackMap model={cached} onError={() => setFailedImage(cached.basemap.image)} /> : geometry.segments.length ? <CoordinateTrack geometry={geometry} selectedSegment={null} selectedPoint={null} /> : <div className="rlm-map-empty" role="status">此路线尚未提供真实轨迹。</div>}</div>
      {saved && <p className="rlm-map-credit"><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a> · OpenStreetMap / Overpass API · ODbL</p>}
    </> : <div className="rlm-map-empty" role="status">暂无可展示的真实路线。正式路线与轨迹发布后可在这里查看。</div>}
  </div>;
}
