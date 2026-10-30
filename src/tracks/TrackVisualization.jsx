import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowDownToLine, Check, ChevronDown, Compass, LocateFixed, Map, Mountain, Route, WifiOff } from 'lucide-react';
import { buildElevationModel, buildTrackMapModel, formatKilometers, formatMeters, nearestProfileIndex, terrainTileConfiguration, unwrapLongitude } from './visualization-helpers.js';
import './track-visualization.css';

const tileConfiguration = terrainTileConfiguration(import.meta.env || {});
const finite = Number.isFinite;

function TrackStatistics({ stats = {}, compact = false }) {
  const measurements = [
    ['里程', formatKilometers(stats.distanceM), Route],
    ['累计爬升', formatMeters(stats.ascentM), Mountain],
    ['累计下降', formatMeters(stats.descentM), ArrowDownToLine],
  ];
  return <dl className={`tv-statistics ${compact ? 'is-compact' : ''}`}>{measurements.map(([title, value, Icon]) => <div key={title}><dt><Icon size={14} aria-hidden="true" />{title}</dt><dd>{value}</dd></div>)}</dl>;
}

function coordinateLabel(value, latitude = false) {
  if (!finite(value)) return '—';
  const normalized = latitude ? value : ((value + 180) % 360 + 360) % 360 - 180;
  return `${Math.abs(normalized).toFixed(4)}°${latitude ? normalized >= 0 ? 'N' : 'S' : normalized >= 0 ? 'E' : 'W'}`;
}

function CoordinateTrack({ geometry, selectedSegment, selectedPoint, onChooseSegment }) {
  const titleId = useId();
  const highlight = selectedPoint ? geometry.project(selectedPoint.lon, selectedPoint.lat) : null;
  return <div className="tv-coordinate-map"><svg viewBox={`0 0 ${geometry.width} ${geometry.height}`} role="img" aria-labelledby={titleId}><title id={titleId}>导入轨迹的经纬度坐标图，无地形底图，各段保持断开</title><rect width={geometry.width} height={geometry.height} fill="#10181c" />{[.2, .4, .6, .8].map(ratio => <g key={ratio} className="tv-coordinate-grid" aria-hidden="true"><line x1={geometry.width * ratio} x2={geometry.width * ratio} y1="0" y2={geometry.height} /><line x1="0" x2={geometry.width} y1={geometry.height * ratio} y2={geometry.height * ratio} /></g>)}{geometry.segments.map(segment => <g key={segment.index} className={selectedSegment !== null && selectedSegment !== segment.index ? 'tv-coordinate-segment is-dimmed' : 'tv-coordinate-segment'}><path d={segment.path} onClick={() => onChooseSegment(segment.index)} />{segment.points.length === 1 && <circle cx={segment.points[0].x} cy={segment.points[0].y} r="4" />}</g>)}{geometry.start && <circle className="tv-coordinate-start" cx={geometry.start.x} cy={geometry.start.y} r="6" />}{geometry.end && <circle className="tv-coordinate-end" cx={geometry.end.x} cy={geometry.end.y} r="8" />}{highlight && <circle className="tv-coordinate-highlight" cx={highlight.x} cy={highlight.y} r="7" />}</svg><div className="tv-coordinate-corner"><Compass size={20} aria-hidden="true" /><span>N</span></div><div className="tv-coordinate-labels"><span>{coordinateLabel(geometry.bounds?.[0])} — {coordinateLabel(geometry.bounds?.[2])}</span><span>{coordinateLabel(geometry.bounds?.[1], true)} — {coordinateLabel(geometry.bounds?.[3], true)}</span></div><span className="tv-coordinate-caption">经纬度坐标投影 · 无地形背景</span></div>;
}

function prepareSections(track, geometry) {
  const allProfile = Array.isArray(track?.profile) ? track.profile : [];
  const metadata = Array.isArray(track?.segments) ? track.segments : [];
  return geometry.segments.map(segment => {
    const information = metadata.find(item => item.index === segment.index);
    const profile = allProfile.filter(point => point && (point.segment ?? 0) === segment.index);
    const baseDistance = profile.find(point => finite(point.distanceM))?.distanceM ?? 0;
    const localProfile = profile.map(point => ({ ...point, segmentDistanceM: finite(point.segmentDistanceM) ? point.segmentDistanceM : finite(point.distanceM) ? Math.max(0, point.distanceM - baseDistance) : null }));
    return {
      index: segment.index,
      name: information?.name || `第 ${segment.index + 1} 段`,
      pointCount: information?.pointCount ?? segment.points.length,
      stats: information?.stats || (geometry.segments.length === 1 ? track.stats : {}) || {},
      profile: localProfile,
    };
  });
}

function ElevationSection({ section, active, onSelectPoint, onChooseSegment }) {
  const [pointIndex, setPointIndex] = useState(0);
  const titleId = useId();
  const hintId = useId();
  const model = useMemo(() => buildElevationModel(section.profile, { distanceKey: 'segmentDistanceM' }), [section.profile]);
  const index = Math.min(pointIndex, Math.max(0, section.profile.length - 1));
  const point = section.profile[index];
  const plotted = model.points[index];
  const hasPoint = point && finite(point.lon) && finite(point.lat);
  const valueText = point ? `${formatKilometers(point.segmentDistanceM)}，${finite(point.elevationM) ? `海拔 ${formatMeters(point.elevationM)}` : '未提供海拔'}` : '没有采样点';
  function select(nextIndex) {
    setPointIndex(nextIndex);
    const next = section.profile[nextIndex];
    if (next && finite(next.lon) && finite(next.lat)) onSelectPoint(next, section.index);
  }
  function followPointer(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !section.profile.length) return;
    const x = (event.clientX - rect.left) / rect.width * model.width;
    const fraction = Math.max(0, Math.min(1, (x - model.padding.left) / (model.width - model.padding.left - model.padding.right)));
    const next = nearestProfileIndex(section.profile, fraction * model.distanceDomain[1]);
    if (next >= 0 && next !== index) select(next);
  }
  return <section className={`tv-elevation-section ${active ? 'is-active' : ''}`} aria-labelledby={titleId}><header className="tv-elevation-heading"><div><span className="tv-section-number">{String(section.index + 1).padStart(2, '0')}</span><div><h3 id={titleId}>{section.name}</h3><p>{section.pointCount.toLocaleString('zh-CN')} 个轨迹点{finite(section.stats.elevationCoverage) ? ` · 海拔覆盖 ${Math.round(section.stats.elevationCoverage * 100)}%` : ''}</p></div></div><button type="button" onClick={() => onChooseSegment(section.index)} className="tv-segment-locate" aria-pressed={active}><LocateFixed size={14} aria-hidden="true" />地图中高亮本段</button></header><TrackStatistics stats={section.stats} compact />{model.hasElevation ? <figure className="tv-elevation-figure"><svg viewBox={`0 0 ${model.width} ${model.height}`} role="img" aria-label={`${section.name}海拔剖面`} onPointerMove={followPointer}><desc>横轴为本段里程，单位公里；纵轴为海拔，单位米。缺失海拔保留空缺，只有实际采样点之间绘制曲线。</desc>{model.yTicks.map(tick => <g key={tick.value} className="tv-profile-grid"><line x1={model.padding.left} x2={model.width - model.padding.right} y1={tick.y} y2={tick.y} /><text x={model.padding.left - 13} y={tick.y + 4} textAnchor="end">{tick.label}</text></g>)}{model.xTicks.map(tick => <g key={tick.value} className="tv-profile-tick"><line x1={tick.x} x2={tick.x} y1={model.height - model.padding.bottom} y2={model.height - model.padding.bottom + 5} /><text x={tick.x} y={model.height - 15} textAnchor="middle">{tick.label}</text></g>)}{model.lines.map((line, lineIndex) => <g key={lineIndex}><path className="tv-profile-line" d={line.path} />{line.points.length === 1 && <circle className="tv-profile-isolated" cx={line.points[0].x} cy={line.points[0].y} r="3" />}</g>)}{point && finite(point.segmentDistanceM) && <line className="tv-profile-cursor" x1={model.xFor(point.segmentDistanceM)} x2={model.xFor(point.segmentDistanceM)} y1={model.padding.top} y2={model.height - model.padding.bottom} />}{plotted && <circle className="tv-profile-point" cx={plotted.x} cy={plotted.y} r="4.5" />}</svg><figcaption id={hintId}>滑动查看采样点，或聚焦下方滑块后使用方向键。海拔缺失处不连线。</figcaption></figure> : <div className="tv-elevation-missing" role="status"><Mountain size={24} strokeWidth={1.3} aria-hidden="true" /><div><strong>本段未提供海拔数据</strong><p>轨迹坐标仍可在地图中查看，海拔剖面和爬升信息需由含海拔的源文件提供。</p></div></div>}{section.profile.length > 0 && <div className="tv-point-inspector"><div className="tv-point-readout" aria-live="polite"><span>本段里程 <strong>{point ? formatKilometers(point.segmentDistanceM) : '—'}</strong></span><span>海拔 <strong>{point && finite(point.elevationM) ? formatMeters(point.elevationM) : '未提供'}</strong></span><span className="tv-point-coordinate">{hasPoint ? `${coordinateLabel(point.lon)} · ${coordinateLabel(point.lat, true)}` : '坐标未提供'}</span></div><input type="range" min="0" max={Math.max(0, section.profile.length - 1)} step="1" value={index} disabled={section.profile.length < 2} onChange={event => select(Number(event.target.value))} onFocus={() => { if (point) onSelectPoint(point, section.index); }} aria-label={`${section.name}轨迹采样点`} aria-describedby={model.hasElevation ? hintId : undefined} aria-valuetext={valueText} /></div>}</section>;
}

export default function TrackVisualization({ track }) {
  const geometry = useMemo(() => buildTrackMapModel(track), [track]);
  const sections = useMemo(() => prepareSections(track, geometry), [track, geometry]);
  const [mode, setMode] = useState(tileConfiguration.offline ? 'coordinate' : 'terrain');
  const [mapStatus, setMapStatus] = useState('loading');
  const [tileError, setTileError] = useState(false);
  const [offlineReason, setOfflineReason] = useState(tileConfiguration.reason || '');
  const [retry, setRetry] = useState(0);
  const [selectedSegment, setSelectedSegment] = useState(null);
  const [selectedPoint, setSelectedPoint] = useState(null);
  const container = useRef(null);
  const liveMap = useRef(null);
  const componentId = useId();
  const hasGeometry = geometry.segments.length > 0;

  useEffect(() => { setSelectedSegment(null); setSelectedPoint(null); }, [track]);

  useEffect(() => {
    if (!hasGeometry || mode !== 'terrain' || tileConfiguration.offline) return undefined;
    if (geometry.bounds[1] < -85.05112878 || geometry.bounds[3] > 85.05112878) {
      setOfflineReason('部分轨迹超出地形底图的纬度覆盖范围，已显示完整的本地坐标轨迹。'); setMode('coordinate'); return undefined;
    }
    let cancelled = false;
    let map, observer, timeout;
    setMapStatus('loading'); setTileError(false);
    async function initialize() {
      try {
        const [module] = await Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')]);
        if (cancelled || !container.current) return;
        const L = module.default || module;
        const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        map = L.map(container.current, { zoomControl: false, keyboard: true, scrollWheelZoom: false, zoomAnimation: !reduceMotion, fadeAnimation: !reduceMotion, markerZoomAnimation: !reduceMotion, minZoom: 1, maxZoom: tileConfiguration.maxZoom });
        L.control.zoom({ position: 'topright', zoomInTitle: '放大轨迹地图', zoomOutTitle: '缩小轨迹地图' }).addTo(map);
        L.control.scale({ position: 'bottomleft', imperial: false }).addTo(map);
        const layers = geometry.segments.map(segment => L.polyline(segment.coordinates.map(([longitude, latitude]) => [latitude, longitude]), { color: '#f07827', weight: 4, opacity: .95, lineCap: 'round' }).addTo(map).on('click', () => { if (!cancelled) { setSelectedSegment(segment.index); setSelectedPoint(null); } }));
        const first = geometry.start, last = geometry.end;
        for (const [point, label, type] of [[first, '轨迹起点', 'start'], [last, '轨迹终点', 'end']]) {
          const marker = L.marker([point.lat, point.lon], { title: label, alt: label, keyboard: true, icon: L.divIcon({ className: `tv-map-endpoint is-${type}`, html: `<span aria-hidden="true">${type === 'start' ? '起' : '终'}</span>`, iconSize: [27, 27], iconAnchor: [13.5, 13.5] }) }).addTo(map);
          marker.bindTooltip(label, { direction: 'top' });
        }
        const bounds = L.latLngBounds([[geometry.bounds[1], geometry.bounds[0]], [geometry.bounds[3], geometry.bounds[2]]]);
        const fit = () => map.fitBounds(bounds, { padding: [30, 30], maxZoom: Math.min(15, tileConfiguration.maxZoom), animate: false });
        fit();
        liveMap.current = { map, L, layers, fit, highlight: null };
        let loaded = 0, failed = 0;
        function fallback(message) { if (!cancelled) { setOfflineReason(message); setMode('coordinate'); } }
        const tiles = L.tileLayer(tileConfiguration.url, { attribution: tileConfiguration.attribution, minZoom: 0, maxZoom: tileConfiguration.maxZoom, maxNativeZoom: tileConfiguration.maxZoom, subdomains: 'abc', updateWhenIdle: true, keepBuffer: 1 });
        tiles.on('tileload', () => { if (!cancelled) { loaded++; setMapStatus('ready'); } });
        tiles.on('tileerror', () => { if (!cancelled) { failed++; setTileError(true); } });
        tiles.on('load', () => { if (!cancelled) { if (loaded === 0 && failed > 0) fallback('地形底图加载失败，已切换为本地坐标轨迹。'); else if (loaded > 0) setMapStatus('ready'); } });
        tiles.addTo(map);
        timeout = window.setTimeout(() => { if (!cancelled && loaded === 0) fallback('地形底图暂时无法连接，已切换为本地坐标轨迹。'); }, 12000);
        if (typeof ResizeObserver !== 'undefined') { observer = new ResizeObserver(() => { if (!cancelled) map.invalidateSize({ pan: false }); }); observer.observe(container.current); }
      } catch {
        if (!cancelled) { setOfflineReason('地形地图暂时不可用，已显示本地坐标轨迹。'); setMode('coordinate'); }
      }
    }
    initialize();
    return () => { cancelled = true; if (timeout) window.clearTimeout(timeout); observer?.disconnect(); if (map) map.remove(); if (liveMap.current?.map === map) liveMap.current = null; };
  }, [geometry, hasGeometry, mode, retry]);

  useEffect(() => {
    const live = liveMap.current;
    if (!live) return;
    live.layers.forEach((layer, index) => {
      const active = selectedSegment === null || geometry.segments[index]?.index === selectedSegment;
      layer.setStyle({ opacity: active ? .95 : .28, weight: active ? 4 : 3 });
      if (active) layer.bringToFront();
    });
    if (selectedPoint && finite(selectedPoint.lon) && finite(selectedPoint.lat)) {
      const center = (geometry.bounds[0] + geometry.bounds[2]) / 2;
      const position = [selectedPoint.lat, unwrapLongitude(selectedPoint.lon, center)];
      if (!live.highlight) live.highlight = live.L.circleMarker(position, { radius: 6, fillColor: '#f5f5f5', fillOpacity: 1, color: '#f07827', weight: 3, interactive: false }).addTo(live.map);
      else live.highlight.setLatLng(position);
      live.highlight.bringToFront();
    } else if (live.highlight) { live.highlight.remove(); live.highlight = null; }
  }, [selectedPoint, selectedSegment, geometry, mapStatus]);

  function chooseSegment(index) { setSelectedSegment(index); setSelectedPoint(null); }
  function choosePoint(point, index) { setSelectedSegment(index); setSelectedPoint(point); }
  function openTerrain() { if (!tileConfiguration.offline) { setOfflineReason(''); setRetry(value => value + 1); setMode('terrain'); } }

  if (!hasGeometry) return <section className="track-visualization tv-empty" aria-label="轨迹可视化"><Route size={30} strokeWidth={1.3} aria-hidden="true" /><h3>尚未载入可显示的轨迹</h3><p>导入有效的 GPX 或 KML 文件后，在这里查看真实路线与各段海拔。</p></section>;

  const sourceFile = typeof track.sourceFile === 'string' ? track.sourceFile.split(/[\\/]/).at(-1) : '';
  const coordinateVisible = mode === 'coordinate' || mapStatus === 'loading';
  return <section className="track-visualization" aria-label="真实轨迹地图与分段海拔"><header className="tv-heading"><div><span className="tv-file-type"><Check size={13} aria-hidden="true" />已解析 {String(track.format || 'GPS').toUpperCase()}</span><h2>{track.name || '已导入轨迹'}</h2><p>{sourceFile && <span>{sourceFile} · </span>}{finite(track.pointCount) ? track.pointCount.toLocaleString('zh-CN') : geometry.segments.reduce((sum, segment) => sum + segment.points.length, 0)} 个轨迹点 · {geometry.segments.length} 段独立轨迹</p></div><span className="tv-real-data">来自导入文件</span></header><TrackStatistics stats={track.stats} /><div className="tv-map-toolbar"><div className="tv-map-switch" role="group" aria-label="轨迹底图选择"><button type="button" aria-pressed={mode === 'terrain'} onClick={openTerrain} disabled={tileConfiguration.offline}><Map size={15} aria-hidden="true" />地形地图</button><button type="button" aria-pressed={mode === 'coordinate'} onClick={() => { setMode('coordinate'); setOfflineReason(''); }}><Compass size={15} aria-hidden="true" />坐标轨迹</button></div>{mode === 'terrain' && mapStatus === 'ready' && <button type="button" className="tv-fit-button" onClick={() => liveMap.current?.fit()}><LocateFixed size={15} aria-hidden="true" />显示完整轨迹</button>}</div>{(offlineReason || tileError && mode === 'terrain') && <div className="tv-map-notice" role="status"><WifiOff size={16} aria-hidden="true" /><span>{offlineReason || '部分地形瓦片未能加载。轨迹坐标保持显示，可切换坐标轨迹查看完整路线。'}</span>{!tileConfiguration.offline && mode === 'coordinate' && <button type="button" onClick={openTerrain}>重试底图</button>}</div>}<div className="tv-map-frame"><div ref={container} className={`tv-leaflet-map ${coordinateVisible ? 'is-pending' : ''}`} tabIndex={mode === 'terrain' && !coordinateVisible ? 0 : -1} role="region" aria-label="真实轨迹地形地图，方向键平移，加减键缩放" aria-hidden={coordinateVisible ? true : undefined} />{coordinateVisible && <CoordinateTrack geometry={geometry} selectedSegment={selectedSegment} selectedPoint={selectedPoint} onChooseSegment={chooseSegment} />}{mode === 'terrain' && mapStatus === 'loading' && <span className="tv-map-loading" role="status">正在连接地形底图 · 当前显示真实坐标轨迹</span>}</div><div className="tv-map-footer"><div className="tv-map-legend"><span><i className="is-start" />起点</span><span><i className="is-end" />终点</span><span><i className="is-route" />实际轨迹</span></div><span>{mode === 'terrain' && !coordinateVisible ? '方向键移动 · + / − 缩放' : '本地坐标图，不含地形底图'}</span></div>{mode === 'terrain' && <p className="tv-basemap-credit">{tileConfiguration.custom ? tileConfiguration.plainAttribution : <><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a> · DEM: SRTM, Sonny · <a href="https://opentopomap.org/about" target="_blank" rel="noopener noreferrer">© OpenTopoMap (CC-BY-SA)</a></>}</p>}<div className="tv-segment-selector" role="group" aria-label="高亮轨迹段"><button type="button" aria-pressed={selectedSegment === null} onClick={() => chooseSegment(null)}>全部轨迹 <span>{sections.length}</span></button>{sections.map(section => <button type="button" key={section.index} aria-pressed={selectedSegment === section.index} onClick={() => chooseSegment(section.index)}>{section.name}</button>)}</div><div className="tv-profiles-heading"><div><h2>分段海拔</h2><p>每段从 0 km 开始，分别显示海拔与统计；地图保留所有段及其断点。</p></div><Mountain size={24} strokeWidth={1.3} aria-hidden="true" /></div><div className="tv-elevation-list" id={`${componentId}-profiles`}>{sections.map(section => <ElevationSection key={`${track.sourceFile || track.name || ''}-${section.index}`} section={section} active={selectedSegment === section.index} onSelectPoint={choosePoint} onChooseSegment={chooseSegment} />)}</div>{Array.isArray(track.warnings) && track.warnings.length > 0 && <aside className="tv-import-warnings" aria-label="轨迹文件提示"><AlertCircle size={18} aria-hidden="true" /><div><h3>源文件提示</h3><ul>{track.warnings.filter(warning => typeof warning === 'string').map((warning, index) => <li key={index}>{warning}</li>)}</ul></div></aside>}<p className="tv-data-note">里程、爬升与下降采用导入器计算结果。底图用于位置参考；路线是否可通行需结合现场情况核实。</p></section>;
}
