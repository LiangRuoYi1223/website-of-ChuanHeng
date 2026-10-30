import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, ChevronDown, Compass, Map, MapPin, Minus, Plus, RotateCcw, ShieldCheck, X } from 'lucide-react';
import { useCatalog } from '../catalog.jsx';
import geography from './geography.json' with { type: 'json' };
import { clampView, filterFootprints, getFootprints, projectCoordinate } from './footprints.js';
import './footprint-map.css';
import './map-theme.css';
import themes from './map-themes.json' with { type: 'json' };

const initialView = { zoom: 1, panX: 0, panY: 0 };
const shortName = name => name.replace('壮族自治区', '').replace('维吾尔自治区', '').replace('回族自治区', '').replace('自治区', '').replace('特别行政区', '').replace(/[省市]$/, '');
const provinceLabels = geography.provinces.filter(item => !['110000', '120000', '310000', '810000', '820000'].includes(item.adcode));
const graticules = [
  ...[80, 90, 100, 110, 120, 130].map(lon => Array.from({ length: 48 }, (_, index) => projectCoordinate([lon, 7 + index]))),
  ...[10, 20, 30, 40, 50].map(lat => Array.from({ length: 66 }, (_, index) => projectCoordinate([72 + index, lat]))),
].map(points => points.map(([x, y], index) => `${index ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join(''));

export default function FootprintExplorer({ expanded = false, palette = 'obsidian' }) {
  const selectedPalette = themes.find(item => item.id === palette) || themes[0];
  const paletteStyle = selectedPalette ? Object.fromEntries(['background','land','border','label','hover','panel','text','muted','chrome'].map(key => [`--map-${key}`,selectedPalette[key]])) : undefined;
  const { activities, footprintActivities, localFootprintPreview, photos, routes, loading, error, refresh } = useCatalog();
  const footprints = useMemo(() => getFootprints(footprintActivities || activities,{allowLocalPreview:localFootprintPreview}), [activities,footprintActivities,localFootprintPreview]);
  const [year, setYear] = useState('all');
  const [type, setType] = useState('all');
  const [view, setView] = useState(initialView);
  const [selectedId, setSelectedId] = useState(null);
  const [province, setProvince] = useState(null);
  const [dragging, setDragging] = useState(false);
  const surface = useRef(null);
  const svg = useRef(null);
  const gesture = useRef(null);
  const suppressClick = useRef(false);
  const visible = filterFootprints(footprints, { year, type });
  const selected = visible.find(item => item.id === selectedId);
  const years = [...new Set(footprints.map(item => item.year))].sort((a, b) => b - a);
  const types = [...new Set(footprints.map(item => item.type).filter(Boolean))];
  const filtered = year !== 'all' || type !== 'all';

  function changeZoom(amount) {
    setView(current => clampView({ ...current, zoom: current.zoom + amount }));
  }
  function pointerDown(event) {
    if (event.button !== 0 || event.target.closest('button, a, select')) return;
    suppressClick.current = false;
    const rect = svg.current.getBoundingClientRect();
    gesture.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, view, ratio: Math.min(rect.width / 1000, rect.height / 640) || 1, moved: false };
    // Capture on the actual target so a click still reaches a province/marker.
    event.target.setPointerCapture?.(event.pointerId);
  }
  function pointerMove(event) {
    const start = gesture.current;
    if (!start || event.pointerId !== start.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.hypot(dx, dy) > 4) { start.moved = true; setDragging(true); }
    if (start.moved) setView(clampView({ ...start.view, panX: start.view.panX + dx / start.ratio, panY: start.view.panY + dy / start.ratio }));
  }
  function pointerUp(event) {
    if (event.pointerId !== gesture.current?.pointerId) return;
    suppressClick.current = event.type === 'pointerup' && gesture.current.moved;
    gesture.current = null;
    setDragging(false);
  }
  function selectProvince(item) {
    if (suppressClick.current) { suppressClick.current = false; return; }
    setProvince(item); setSelectedId(null);
  }
  function selectRecord(item) {
    if (suppressClick.current) { suppressClick.current = false; return; }
    setSelectedId(item.id); setProvince(null);
  }
  function handleKey(event) {
    if (event.target !== event.currentTarget) return;
    const steps = { ArrowLeft: [45, 0], ArrowRight: [-45, 0], ArrowUp: [0, 45], ArrowDown: [0, -45] };
    if (steps[event.key]) { event.preventDefault(); const [x, y] = steps[event.key]; setView(current => clampView({ ...current, panX: current.panX + x, panY: current.panY + y })); }
    else if (event.key === '+' || event.key === '=') { event.preventDefault(); changeZoom(.5); }
    else if (event.key === '-') { event.preventDefault(); changeZoom(-.5); }
    else if (event.key === 'Home' || event.key === '0') { event.preventDefault(); setView(initialView); }
    else if (event.key === 'Escape') { setSelectedId(null); setProvince(null); }
  }
  function resetFilters() { setYear('all'); setType('all'); setSelectedId(null); }
  const associatedPhotos = selected ? (photos || []).filter(item => item.isDemo === false && item.activityId === selected.id) : [];
  const associatedRoute = selected && (routes || []).find(item => item.id === selected.routeId);

  return <div className={`footprint-explorer ${expanded ? 'is-expanded' : ''}`} data-map-theme={selectedPalette?.id} style={paletteStyle}>
    <div className="f-toolbar"><div className="f-map-heading"><Map size={19} /><strong>川衡足迹</strong><span>全国视图</span></div><div className="f-filters">
      <label><span className="c-sr-only">按年份筛选</span><select aria-label="按年份筛选" value={year} onChange={event => { setYear(event.target.value); setSelectedId(null); }}><option value="all">全部年份</option>{years.map(value => <option key={value} value={value}>{value} 年</option>)}</select><ChevronDown size={13} /></label>
      <label><span className="c-sr-only">按活动类型筛选</span><select aria-label="按活动类型筛选" value={type} onChange={event => { setType(event.target.value); setSelectedId(null); }}><option value="all">全部类型</option>{types.map(value => <option key={value}>{value}</option>)}</select><ChevronDown size={13} /></label>
      {!expanded && <Link className="f-expand" to="/footprints">展开地图<ArrowUpRight size={16} /></Link>}
    </div></div>
    <div className="f-body">
      <div ref={surface} className={`f-map ${dragging ? 'is-dragging' : ''}`} role="region" aria-label="中国活动足迹地图，支持缩放和拖动" tabIndex={0} onKeyDown={handleKey} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onLostPointerCapture={pointerUp}>
        <div className="f-map-top"><Compass size={23} strokeWidth={1.3} /><span>中国 · 省级地图</span><span className="f-instructions">放大后可拖动 · 方向键平移</span></div>
        <svg ref={svg} viewBox="0 0 1000 640" className="f-map-svg" role="img" aria-label="中国省级地图，含台湾及南海诸岛附图；橙色标记仅表示已核实的川衡活动地点">
          <title>川衡活动足迹 · 中国地图</title><desc>中国省级地理底图独立显示，不以是否存在活动为条件。没有真实活动记录时不绘制活动标记。</desc>
          <g transform={`translate(${500 + view.panX},${320 + view.panY}) scale(${view.zoom}) translate(-500,-320)`}>
            <g className="f-graticule" aria-hidden="true">{graticules.map((path, index) => <path d={path} key={index} />)}</g>
            <g transform="translate(40,-5)" fillRule="evenodd">
              {geography.provinces.map(item => <path key={item.id} className={`f-province ${province?.id === item.id ? 'is-selected' : ''}`} d={item.path} role="button" tabIndex={0} aria-label={`查看${item.name}地区`} onClick={() => selectProvince(item)} onKeyDown={event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); suppressClick.current = false; selectProvince(item); } }}><title>{item.name}</title></path>)}
              <g className="f-province-labels" pointerEvents="none" aria-hidden="true">{provinceLabels.map(item => <text x={item.label[0]} y={item.label[1]} key={item.id}>{shortName(item.name)}</text>)}</g>
              <g className="f-south-sea"><rect x={geography.inset.frame.x} y={geography.inset.frame.y} width={geography.inset.frame.width} height={geography.inset.frame.height} rx="2" />{geography.inset.paths.map(item => <path key={item.id} d={item.path} />)}<text x={geography.inset.frame.x + geography.inset.frame.width / 2} y={geography.inset.frame.y + geography.inset.frame.height + 20}>南海诸岛</text></g>
            </g>
            {visible.map(item => { const [x, y] = projectCoordinate(item.coordinates); return <g key={item.id} className="f-activity-point" transform={`translate(${x},${y})`} onClick={() => selectRecord(item)} role="button" tabIndex={0} aria-label={`查看${item.title}活动足迹`} onKeyDown={event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); suppressClick.current = false; selectRecord(item); } }}><circle className="f-point-halo" r={12 / view.zoom} /><circle r={4.5 / view.zoom} /><title>{item.title}</title></g>; })}
          </g>
        </svg>
        <div className="f-controls" aria-label="地图缩放控制"><button aria-label="放大地图" title="放大地图" onClick={() => changeZoom(.5)} disabled={view.zoom >= 4}><Plus size={18} /></button><button aria-label="缩小地图" title="缩小地图" onClick={() => changeZoom(-.5)} disabled={view.zoom <= 1}><Minus size={18} /></button><button aria-label="显示全国地图" title="显示全国 / 复位" onClick={() => { setView(initialView); setProvince(null); setSelectedId(null); }}><RotateCcw size={16} /></button></div>
        {selected && <div className="f-popup" role="status"><button className="f-popup-close" aria-label="关闭地点信息" onClick={() => setSelectedId(null)}><X size={17} /></button><span>{selected.year} · {selected.type || '协会活动'}</span><h3>{selected.title}</h3><p>{selected.location || ''}</p>{selected.localDraft&&<small>本地活动预览 · 尚未公开</small>}<Link to={`/activities/${selected.id}${selected.localDraft?'?draft=1':''}`}>查看活动<ArrowUpRight size={14} /></Link>{(associatedRoute || selected.routeId) && <Link to={`/routes/${associatedRoute?.id || selected.routeId}${selected.localDraft?'?draft=1':''}`}>关联路线<ArrowUpRight size={14} /></Link>}{associatedPhotos.length > 0 && <div className="f-linked-photos">{associatedPhotos.slice(0, 3).map(photo => <Link to={`/gallery?photo=${photo.id}`} key={photo.id}><img src={photo.image} alt={photo.title} /></Link>)}</div>}</div>}
        {province && <div className="f-province-info" role="status"><span>{province.name}</span><button aria-label="关闭省份信息" onClick={() => setProvince(null)}><X size={14} /></button></div>}
        {!visible.length && <div className="f-empty-message" role="status"><MapPin size={19} strokeWidth={1.5} /><div><strong>{loading ? '正在加载活动记录' : filtered ? '此筛选范围暂无活动' : '真实足迹，等待下一次出发'}</strong><p>{error ? '活动记录暂时无法加载，地图仍可浏览。' : filtered ? '地图已显示，试试其他年份或活动类型。' : '尚未载入真实活动地点。中国底图已显示，核实后的活动将在图上标记。'}</p></div>{error ? <button onClick={refresh}>重试</button> : filtered ? <button onClick={resetFilters}>清除筛选</button> : null}</div>}
        <div className="f-map-bottom"><span className="f-legend"><i />{visible.some(item=>item.localDraft)?'活动足迹（含本地预览）':'协会活动足迹'}<span className="f-record-count">{visible.length} 条</span></span><span>非导航地图<output aria-label="当前缩放比例" aria-live="polite">{view.zoom.toFixed(1)}×</output></span></div>
      </div>
      {expanded && <aside className="f-records"><div className="f-records-heading"><h3>活动记录</h3><span>{visible.length} 条</span></div><div className="f-record-list">{visible.length ? visible.map(item => <button className={`f-record-card ${selectedId === item.id ? 'is-selected' : ''}`} key={item.id} onClick={() => { suppressClick.current = false; selectRecord(item); }}><MapPin size={16} /><span><strong>{item.title}</strong><small>{item.year} · {item.location || item.type}</small></span><ArrowUpRight size={16} /></button>) : <div className="f-record-empty"><Map size={29} strokeWidth={1} /><h4>等待第一份真实记录</h4><p>活动地点、日期和照片核实后，会在地图与列表中同步呈现。</p>{filtered && <button onClick={resetFilters}>清除筛选</button>}</div>}</div><div className="f-records-note"><ShieldCheck size={15} />示例活动不会计入协会足迹</div></aside>}
    </div>
    <div className="f-footnote"><ShieldCheck size={15} /><p>{visible.some(item=>item.localDraft)?'本地预览包含活动管理中选入的已结束活动草稿，尚未公开。':'仅展示川衡组织并已公开的真实活动。'}底图不代表协会到访记录。</p><a href="https://datav.aliyun.com/portal/school/atlas/area_selector" target="_blank" rel="noopener noreferrer">底图：DataV / 高德</a></div>
  </div>;
}
