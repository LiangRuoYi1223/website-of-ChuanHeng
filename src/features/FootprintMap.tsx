import { useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Footprints, MapPin, ArrowUpRight } from 'lucide-react';
import { useContent } from '../App';
import { aggregateFootprints, selectFootprint, type FootprintPoint } from './footprint-data';
import { activityRoute } from './activity-location';
import { chinaProvinces, southSeaPaths, projectChinaPoint } from './map-data/china-paths';
import './footprint-map.css';

function cityStatus(point: FootprintPoint) {
  const counts = [point.completedCount ? `已完成 ${point.completedCount} 场` : '', point.upcomingCount ? `未来 ${point.upcomingCount} 场` : ''].filter(Boolean);
  return counts.join(' · ');
}

export function FootprintMap() {
  const uid = useId();
  const { activities } = useContent();
  const points = useMemo(() => aggregateFootprints(activities), [activities]);
  const [selectedId, setSelectedId] = useState('');
  const selected = selectFootprint(points, selectedId);
  const demoOnly = points.length > 0 && points.every(point => point.demoOnly);
  const hasDemo = points.some(point => point.activities.some(activity => activity.isDemo));
  const storyId = `${uid}-story`;
  const [taiwanX, taiwanY] = projectChinaPoint(121.05, 23.8);
  const [hainanX, hainanY] = projectChinaPoint(109.75, 19.0);

  return <section className="footprint-section" id="footprints" aria-labelledby={`${uid}-heading`}>
    <div className="footprint-container">
      <div className="footprint-heading">
        <div><span className="footprint-eyebrow">05 / OUR FOOTPRINTS</span><h2 id={`${uid}-heading`}>把一起走过的路，<br/>留在地图上。</h2></div>
        <div className="footprint-introduction">
          <span className="footprint-demo-badge">{demoOnly ? '演示活动地图' : `活动城市 · ${points.length} 个`}</span>
          <p>按活动所在城市汇集，选择城市查看活动。{hasDemo && <><br/>演示活动的地点不代表协会实际到访。</>}</p>
        </div>
      </div>

      <div className="footprint-layout">
        <figure className="footprint-map-panel">
          <div className="footprint-map-topline"><span><Footprints size={17} aria-hidden="true"/> 山野之间，留下连接</span><span>CHINA / 活动城市</span></div>
          {/* 保留原始省界、投影及南海区域，只用本地城市坐标定位活动。 */}
          <svg className="footprint-map-svg" viewBox="112 8 788 604" role="group" aria-labelledby={`${uid}-map-title ${uid}-map-description`}>
            <title id={`${uid}-map-title`}>中国地图中的活动城市</title>
            <desc id={`${uid}-map-description`}>地图包含省界、台湾、海南和南海区域。绿色点表示已完成活动，蓝色点表示未来活动，同城兼有两种活动时使用蓝色。演示活动均有标记。可用 Tab 聚焦点位，按 Enter 或空格选择，也可使用地图旁的城市列表。</desc>
            <g aria-hidden="true" className="footprint-provinces">
              {chinaProvinces.map(province => <path key={province.adcode} d={province.path} fillRule="evenodd" className={province.adcode === selected?.provinceCode ? 'footprint-province footprint-province-selected' : 'footprint-province'}/>) }
              <text className="footprint-region-label" x={taiwanX + 14} y={taiwanY + 3}>台湾</text>
              <text className="footprint-region-label" x={hainanX + 15} y={hainanY + 5}>海南</text>
            </g>
            <g className="footprint-inset" aria-hidden="true">
              <rect x="770" y="407" width="114" height="187" rx="4"/>
              <text x="827" y="424" textAnchor="middle">南海诸岛</text>
              {southSeaPaths.map(shape => <path key={shape.adcode} d={shape.path} fillRule="evenodd" className={shape.adcode === '100000_JD' ? 'footprint-sea-boundary' : 'footprint-sea-islands'}/>)}
            </g>
            {points.map(point => {
              const [x, y] = projectChinaPoint(point.longitude, point.latitude);
              const active = point.id === selected?.id;
              const labelLeft = x > 690;
              return <g key={point.id} transform={`translate(${x} ${y})`} className={`footprint-marker footprint-marker-${point.status}${active ? ' footprint-marker-selected' : ''}`} role="button" tabIndex={0} aria-label={`${point.city}，${cityStatus(point)}${point.demoOnly ? '，演示活动' : ''}`} aria-pressed={active} aria-controls={storyId} onClick={() => setSelectedId(point.id)} onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedId(point.id); }
              }}>
                <circle className="footprint-marker-hit" r="21"/>
                <circle className="footprint-marker-halo" r="16"/>
                <circle className="footprint-marker-core" r="8"/>
                {active && <text className="footprint-marker-label" x={labelLeft ? -19 : 19} y="-18" textAnchor={labelLeft ? 'end' : 'start'} aria-hidden="true">{point.city}<tspan className="footprint-marker-number"> / {point.activities.length} 场</tspan></text>}
              </g>;
            })}
            <text className="footprint-map-watermark" x="145" y="600" aria-hidden="true">A TRAIL BEGINS WITH A STEP.</text>
          </svg>
          {!points.length && <div className="footprint-map-empty"><MapPin size={25} aria-hidden="true"/><strong>等待下一次出发</strong><span>已发布活动选择城市后，会自动出现在地图上。</span></div>}
          <figcaption className="footprint-map-caption"><div className="footprint-legend"><span><i className="footprint-legend-point"/>已完成活动</span><span><i className="footprint-legend-point footprint-legend-upcoming"/>未来活动</span></div><span>同城兼有两种活动时显示蓝色</span></figcaption>
        </figure>

        <aside className="footprint-side" aria-label="活动城市与相关活动">
          {selected ? <>
            <div className="footprint-places" aria-label="选择活动城市">
              {points.map((point, index) => <button type="button" key={point.id} className={`footprint-place${point.id === selected.id ? ' footprint-place-selected' : ''}`} aria-label={`${point.city}，${cityStatus(point)}${point.demoOnly ? '，演示活动' : ''}`} aria-pressed={point.id === selected.id} aria-controls={storyId} onClick={() => setSelectedId(point.id)}><span className={`footprint-place-number footprint-place-number-${point.status}`}>{String(index + 1).padStart(2, '0')}</span><span>{point.city}<small>{point.activities.length} 场 · {point.upcomingCount ? '含未来活动' : '已完成活动'}</small></span><ArrowUpRight size={16} aria-hidden="true"/></button>)}
            </div>
            <section className="footprint-city-activities" id={storyId} aria-labelledby={`${uid}-city-heading`}>
              <header className="footprint-city-heading"><span className="footprint-story-location"><MapPin size={15} aria-hidden="true"/>{selected.region}</span><h3 id={`${uid}-city-heading`}>{selected.city}的活动</h3><p>{cityStatus(selected)}{selected.demoOnly && <span className="footprint-activity-demo">演示活动</span>}</p></header>
              <ul key={selected.id} className="footprint-activity-list" aria-label={`${selected.city}的全部相关活动`} tabIndex={0}>
                {selected.activities.map(activity => <li key={activity.id}>
                  <div className="footprint-activity-meta"><span className={`footprint-activity-status footprint-activity-status-${activity.kind}`}>{activity.kind === 'past' ? '已完成' : '未来活动'}</span><time dateTime={activity.date}>{activity.date}</time>{activity.isDemo && <span className="footprint-activity-demo">示意</span>}</div>
                  <h4><Link to={`/activities/${activity.id}`}>{activity.title}<ArrowUpRight size={15} aria-hidden="true"/></Link></h4>
                  <p>路线：{activityRoute(activity) || '待公布'}</p>
                </li>)}
              </ul>
            </section>
          </> : <div className="footprint-side-empty" id={storyId}><MapPin size={30} aria-hidden="true"/><h3>暂无可定位的活动</h3><p>发布活动并选择所在城市后，这里会展示相关活动。</p></div>}
        </aside>
      </div>
      <p className="footprint-screenreader-status" role="status" aria-live="polite">{selected ? `当前选择：${selected.city}，${cityStatus(selected)}${selected.demoOnly ? '，演示活动，不代表协会实际到访。' : '。'}` : '暂无已发布且已选择城市的活动。'}</p>
      <div className="footprint-bottom"><p>点位代表城市位置，具体路线请查看活动详情。</p><a href="#calendar">看看当前公开活动 <ArrowUpRight size={16} aria-hidden="true"/></a></div>
    </div>
  </section>;
}

export default FootprintMap;
