import { useId, useState } from 'react';
import { Footprints, MapPin, ArrowUpRight } from 'lucide-react';
import { footprintPoints } from './footprint-data';
import { CHINA_VIEWBOX, chinaProvinces, southSeaPaths, projectChinaPoint } from './map-data/china-paths';
import './footprint-map.css';

export function FootprintMap() {
  const uid = useId();
  const [selectedId, setSelectedId] = useState(footprintPoints[0].id);
  const selected = footprintPoints.find(point => point.id === selectedId) ?? footprintPoints[0];
  const storyId = `${uid}-story`;
  const [taiwanX, taiwanY] = projectChinaPoint(121.05, 23.8);
  const [hainanX, hainanY] = projectChinaPoint(109.75, 19.0);

  return <section className="footprint-section" id="footprints" aria-labelledby={`${uid}-heading`}>
    <div className="footprint-container">
      <div className="footprint-heading">
        <div><span className="footprint-eyebrow">05 / OUR FOOTPRINTS</span><h2 id={`${uid}-heading`}>把一起走过的路，<br/>留在地图上。</h2></div>
        <div className="footprint-introduction"><span className="footprint-demo-badge">演示地图 · 真实足迹待补充</span><p>选一个地点，看看足迹如何被记录。<br/>四个点位均为位置示例，不代表协会已到访。</p></div>
      </div>

      <div className="footprint-layout">
        <figure className="footprint-map-panel">
          <div className="footprint-map-topline"><span><Footprints size={17} aria-hidden="true"/> 山野之间，留下连接</span><span>CHINA / 地点示例</span></div>
          <svg className="footprint-map-svg" viewBox={`0 0 ${CHINA_VIEWBOX.width} ${CHINA_VIEWBOX.height}`} role="group" aria-labelledby={`${uid}-map-title ${uid}-map-description`}>
            <title id={`${uid}-map-title`}>中国地图中的四个演示地点</title>
            <desc id={`${uid}-map-description`}>地图包含省界、台湾、海南和南海区域。点位为深圳、韶关、桂林和成都的位置示例，并非协会真实活动记录。可使用 Tab 聚焦点位，按 Enter 或空格选择，也可使用地图旁的地点列表。</desc>
            <g aria-hidden="true" className="footprint-provinces">
              {chinaProvinces.map(province => <path key={province.adcode} d={province.path} fillRule="evenodd" className={province.adcode === selected.provinceCode ? 'footprint-province footprint-province-selected' : 'footprint-province'}/>) }
              <text className="footprint-region-label" x={taiwanX + 14} y={taiwanY + 3}>台湾</text>
              <text className="footprint-region-label" x={hainanX + 15} y={hainanY + 5}>海南</text>
            </g>
            <g className="footprint-inset" aria-hidden="true">
              <rect x="770" y="407" width="114" height="187" rx="4"/>
              <text x="827" y="424" textAnchor="middle">南海诸岛</text>
              {southSeaPaths.map(shape => <path key={shape.adcode} d={shape.path} fillRule="evenodd" className={shape.adcode === '100000_JD' ? 'footprint-sea-boundary' : 'footprint-sea-islands'}/>)}
            </g>
            {footprintPoints.map((point, index) => {
              const [x, y] = projectChinaPoint(point.longitude, point.latitude);
              const active = point.id === selectedId;
              return <g key={point.id} transform={`translate(${x} ${y})`} className={`footprint-marker${active ? ' footprint-marker-selected' : ''}`} role="button" tabIndex={0} aria-label={`${point.city}，演示点位，${point.activityKind}`} aria-pressed={active} aria-controls={storyId} onClick={() => setSelectedId(point.id)} onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedId(point.id); }
              }}>
                <circle className="footprint-marker-hit" r="21"/>
                <circle className="footprint-marker-halo" r="16"/>
                <circle className="footprint-marker-core" r="8"/>
                <text className="footprint-marker-label" x={point.labelOffset[0]} y={point.labelOffset[1]} textAnchor={point.labelOffset[0] < 0 ? 'end' : 'start'} aria-hidden="true">{point.city}<tspan className="footprint-marker-number"> / 0{index + 1}</tspan></text>
              </g>;
            })}
            <text className="footprint-map-watermark" x="45" y="617" aria-hidden="true">A TRAIL BEGINS WITH A STEP.</text>
          </svg>
          <figcaption className="footprint-map-caption"><div className="footprint-legend"><span><i className="footprint-legend-point"/>演示点位</span><span><i className="footprint-legend-region"/>当前所选地区</span></div><span>地图或地点列表均可选择</span></figcaption>
        </figure>

        <aside className="footprint-side" aria-label="演示地点与足迹展示">
          <div className="footprint-places" aria-label="选择演示地点">
            {footprintPoints.map((point, index) => <button type="button" key={point.id} className={`footprint-place${point.id === selectedId ? ' footprint-place-selected' : ''}`} aria-pressed={point.id === selectedId} aria-controls={storyId} onClick={() => setSelectedId(point.id)}><span className="footprint-place-number">0{index + 1}</span><span>{point.city}<small>地点示例</small></span><ArrowUpRight size={16} aria-hidden="true"/></button>)}
          </div>
          <article className="footprint-story" id={storyId}>
            <div className="footprint-story-photo"><img src={selected.image} alt={selected.imageAlt} width="1536" height="1024" loading="lazy" decoding="async"/><span>AI 示意配图</span></div>
            <div className="footprint-story-body"><span className="footprint-story-location"><MapPin size={15} aria-hidden="true"/>{selected.region}</span><p className="footprint-story-kind">{selected.activityKind}</p><h3>{selected.title}</h3><p className="footprint-story-description">{selected.description}</p><div className="footprint-record-pending"><i/>等待真实足迹 · 路线记录待替换</div></div>
          </article>
        </aside>
      </div>
      <p className="footprint-screenreader-status" role="status" aria-live="polite">当前选择：{selected.city}，地点示例。真实路线记录待补充。</p>
      <div className="footprint-bottom"><p>真实照片、路线与同行故事，会让这张地图慢慢生长。</p><a href="#calendar">看看当前公开活动 <ArrowUpRight size={16} aria-hidden="true"/></a></div>
    </div>
  </section>;
}

export default FootprintMap;
