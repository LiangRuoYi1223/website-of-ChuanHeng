import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import TrackVisualization from '../tracks/TrackVisualization.jsx';
import { getLocalTrack, readLocalRouteDraft, readLocalContentDraft } from '../tracks/track-store.js';
import { downloadTrackJson } from '../tracks/import-client.js';
import { matchesAscent } from '../tracks/route-filters.js';
import '../tracks/track-import.css';
import { ArrowLeft, ArrowRight, CalendarDays, Camera, Check, ChevronLeft, ChevronRight, Clock3, Compass, Download, Layers3, Map, MapPin, Mountain, Route as RouteIcon, Search, ShieldCheck, X } from 'lucide-react';
import { useCatalog, isPreview } from '../catalog.jsx';
import { PageHero, SectionHeading, EmptyState, ButtonLink, StatusTag, SampleNote } from '../ui.jsx';
import './explore.css';
import ActivityApplication from '../applications/ActivityApplication.jsx';
import ActivityCover from '../media/ActivityCover.jsx';
import ActivityScheduleDetails from '../activities/ActivityScheduleDetails.jsx';
import { activityDateLabel } from '../activities/schedule.js';
import { resolveActivityView } from '../activities/presentation.js';

const illustrativeImage = item => item?.isDemo === true || !item?.image || String(item.image).startsWith('/images/redesign-v2/');
function ImageNote({ item, className = 'explore-image-label', children = 'AI 示意影像' }) {
  return illustrativeImage(item) ? <span className={className}>{children}</span> : null;
}

const choices = (data, key) => [...new Set(data.map(item => item[key]).filter(Boolean))];
const numberOf = value => Number.parseFloat(String(value ?? '').replace(/,/g, '')) || 0;
const distanceOf = item => typeof item.distance === 'number' && Number.isFinite(item.distance) ? `${Number(item.distance.toFixed(2))} km` : (item.distance || '待确认');
const ascentOf = item => typeof item.ascent === 'number' && Number.isFinite(item.ascent) ? `${Number(item.ascent.toFixed(1))} m` : (item.ascent || '海拔未提供');
const matches = (item, query) => `${item.title} ${item.location ?? ''} ${item.description ?? ''}`.toLowerCase().includes(query.trim().toLowerCase());

function SearchField({ value, onChange, placeholder = '搜索名称、地区或关键词' }) {
  return <label className="explore-search"><Search size={18} aria-hidden="true" /><input type="search" value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} aria-label={placeholder} /></label>;
}

function FilterSelect({ label, value, onChange, options }) {
  return <label className="explore-select"><span>{label}</span><select value={value} onChange={event => onChange(event.target.value)} aria-label={label}><option value="">全部{label}</option>{options.map(option => <option key={typeof option === 'string' ? option : option.value} value={typeof option === 'string' ? option : option.value}>{typeof option === 'string' ? option : option.label}</option>)}</select></label>;
}

function Specs({ item, inline = false }) {
  return <div className={`explore-specs ${inline ? 'is-inline' : ''}`}><div><RouteIcon size={17} aria-hidden="true" /><span>里程</span><strong>{distanceOf(item)}</strong></div><div><Mountain size={17} aria-hidden="true" /><span>累计爬升</span><strong>{ascentOf(item)}</strong></div><div><Compass size={17} aria-hidden="true" /><span>难度</span><strong>{item.difficulty || '待评估'}</strong></div></div>;
}

function Breadcrumb({ section, to, current }) {
  return <nav className="explore-breadcrumb container" aria-label="面包屑导航"><Link to="/">首页</Link><ChevronRight size={13} aria-hidden="true" /><Link to={to}>{section}</Link><ChevronRight size={13} aria-hidden="true" /><span aria-current="page">{current}</span></nav>;
}

function NoResults({ clear }) {
  return <div className="explore-no-results"><EmptyState title="暂时没有匹配的内容" description="试试其他关键词，或调整筛选条件，继续寻找你的下一段山野旅程。" /><button className="btn btn-outline" type="button" onClick={clear}>重置筛选</button></div>;
}

function CatalogLoading() {
  return <div className="explore-loading container" role="status"><span className="explore-loading-mark" /><p>正在打开这一段山野……</p></div>;
}

function CatalogFeedback({ loading, error, refresh }) {
  if (loading) return <div className="explore-catalog-feedback" role="status">正在读取已发布内容……</div>;
  if (error) return <div className="explore-catalog-feedback is-error" role="alert"><span>内容暂时未能加载，请稍后重试。</span><button type="button" onClick={refresh}>重新加载 <ArrowRight size={14} /></button></div>;
  return null;
}

function MissingPage({ kind, to }) {
  return <div className="explore-missing container section"><EmptyState title={`没有找到${kind === '路线' ? '这条' : kind === '活动' ? '这场' : '这篇'}${kind}`} description="链接可能已更新，或该内容尚未发布。" /><ButtonLink to={to}>返回{kind}列表</ButtonLink></div>;
}

export function ActivitiesPage() {
  const { activities, loading, error, refresh } = useCatalog();
  const [status, setStatus] = useState('全部活动');
  const [query, setQuery] = useState('');
  const [region, setRegion] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [type, setType] = useState('');
  const filtered = activities.filter(item => (status === '全部活动' || item.status === status) && (!region || item.location === region) && (!difficulty || item.difficulty === difficulty) && (!type || item.type === type) && matches(item, query));
  const reset = () => { setStatus('全部活动'); setQuery(''); setRegion(''); setDifficulty(''); setType(''); };
  return <div className="explore-activities"><PageHero title="一起，走向山野" description="与同路人出发，在每一次攀登与行走中，发现更辽阔的自己。" image="/images/redesign-v2/activities-snow.webp"></PageHero><section className="container section explore-list-section"><CatalogFeedback loading={loading} error={error} refresh={refresh} /><div className="explore-tabs" role="group" aria-label="活动状态">{['全部活动', '报名中', '即将开始', '进行中', '已结束'].map(value => <button key={value} type="button" onClick={() => setStatus(value)} className={status === value ? 'is-active' : ''} aria-pressed={status === value}>{value}</button>)}</div><div className="explore-filters"><SearchField value={query} onChange={setQuery} /><FilterSelect label="地区" value={region} onChange={setRegion} options={choices(activities, 'location')} /><FilterSelect label="难度" value={difficulty} onChange={setDifficulty} options={choices(activities, 'difficulty')} /><FilterSelect label="类型" value={type} onChange={setType} options={choices(activities, 'type')} /></div><div className="explore-results-meta"><span>共 <strong>{filtered.length}</strong> 场活动</span>{isPreview && <SampleNote />}</div><div className="explore-activity-list">{filtered.map(item => <article className="explore-activity-card" key={item.id}><Link to={`/activities/${item.id}`} className="explore-activity-image"><ActivityCover item={item}/><div className="explore-image-status"><StatusTag status={item.status || '待公布'} /></div></Link><div className="explore-activity-content"><div className="explore-card-kicker"><span>{item.type || '山野同行'}</span><span><MapPin size={14} aria-hidden="true" />{item.location || '地点待确认'}</span></div><h2><Link to={`/activities/${item.id}`}>{item.title}</Link></h2><p>{item.description}</p><Specs item={item} inline /><div className="explore-card-footer"><span><CalendarDays size={15} aria-hidden="true" />{activityDateLabel(item)}</span><Link to={`/activities/${item.id}`} className="explore-text-link">查看活动 <ArrowRight size={17} /></Link></div></div></article>)}</div>{!filtered.length && !loading && !error && <NoResults clear={reset} />}</section><div className="explore-bottom-banner container"><Mountain size={35} strokeWidth={1.25} /><div><h2>每一场出发，都从准备开始</h2><p>了解装备、体能与山野安全，让热爱走得更远。</p></div><ButtonLink to="/news" className="btn-outline">阅读户外指南</ButtonLink></div></div>;
}

export function ActivityDetailPage() {
  const { activities, routes, loading } = useCatalog();
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const localRequested = isPreview && searchParams.get('draft') === '1';
  const source = localRequested ? readLocalContentDraft(id,'activity') : activities.find(activity => String(activity.id) === id);
  const item = source ? resolveActivityView(source) : null;
  const [localTrack,setLocalTrack] = useState(null);
  const [trackError,setTrackError] = useState('');
  const [trackLoading,setTrackLoading] = useState(false);
  const localTrackId = item?.trackLocalId;
  useEffect(()=>{
    let active=true;setLocalTrack(null);setTrackError('');
    if(!localRequested||!localTrackId){setTrackLoading(false);return;}
    setTrackLoading(true);
    getLocalTrack(localTrackId).then(value=>{if(active){setLocalTrack(value);if(!value)setTrackError('历史轨迹无法读取，请在路线管理核对原始文件与活动关联。')}}).catch(e=>{if(active)setTrackError(e.message)}).finally(()=>{if(active)setTrackLoading(false)});
    return()=>{active=false};
  },[id,localTrackId,localRequested]);
  const activityTrack=item?.track||localTrack;
  if (!item) return loading ? <CatalogLoading /> : <MissingPage kind="活动" to="/activities" />;
  const related = routes.filter(route => route.location === item.location).slice(0, 2);
  const shownRoutes = related.length ? related : routes.slice(0, 2);
  return <div className="explore-detail"><Breadcrumb section="活动" to="/activities" current={item.title}/>{localRequested&&<div className="container track-draft-notice">本地活动草稿，尚未公开发布。 <Link to="/admin/activities?preview=1">编辑活动</Link></div>}<div className="container explore-detail-heading"><div className="explore-card-kicker"><StatusTag status={item.status || '待公布'} /><span>{item.type || '山野同行'}</span><span>{localRequested ? '本地活动草稿' : item.isDemo ? '示例活动' : '协会活动'}</span></div><h1>{item.title}</h1><div className="explore-heading-meta"><span><MapPin size={16} />{item.location}</span><span><CalendarDays size={16} />{activityDateLabel(item)}</span></div></div><div className="container"><div className="explore-detail-cover"><ActivityCover item={item} loading="eager"/></div></div><div className="container explore-detail-grid"><article className="explore-detail-body"><nav className="explore-anchor-nav" aria-label="活动章节"><a href="#activity-overview">活动介绍</a><a href="#activity-track">活动轨迹</a><a href="#activity-plan">行程安排</a><a href="#activity-equipment">装备建议</a><a href="#activity-safety">安全须知</a></nav><section id="activity-overview" className="explore-prose-section"><h2>走进这段山野</h2><p className="explore-lead">{item.description}</p><p>把脚步放慢，去留意一条山脊的延伸、一片森林的呼吸，以及同行伙伴之间自然生长的默契。川衡倡导有准备、有边界的山野探索。</p><div className="explore-note"><ShieldCheck size={21} /><div><strong>{item.isDemo ? '这里展示的是活动页面示例' : '活动资料与轨迹'}</strong><p>{item.isDemo ? '当前日期、地点与活动参数用于界面演示，尚未发布可报名的正式行程。' : '活动使用所选路线的历史轨迹版本，地图与海拔根据原始文件生成。'}领队、集合方式、费用及保障方案需由协会核实并另行公布。</p></div></div></section><section id="activity-track" className="explore-prose-section"><h2>活动轨迹与分段海拔</h2>{trackLoading ? <p role="status">正在读取轨迹…</p> : trackError ? <p className="track-import-error" role="alert">{trackError}</p> : activityTrack ? <TrackVisualization track={activityTrack}/> : <div className="track-empty">此活动尚未提供轨迹文件。</div>}{item.routeId&&<Link className="explore-text-link" to={`/routes/${item.routeId}${localRequested?'?draft=1':''}`}>查看关联路线 <ArrowRight size={16}/></Link>}</section><section id="activity-plan" className="explore-prose-section"><h2>行程安排</h2><p className="muted">以下为准备流程示例，不构成实际带队行程或导航依据。</p><div className="explore-timeline">{[['行前', '充分准备', '了解活动要求，评估体能与装备，确认天气、交通及撤退方案。'], ['出发', '集合与检查', '正式活动应由领队完成签到、装备检查和安全说明，确认同行伙伴状态。'], ['途中', '在山野中同行', '依照正式路线和队伍节奏行进，及时补水补给，尊重环境并关注彼此。'], ['归来', '完成与回顾', '确认全员安全返回，整理装备与垃圾，共同回顾这一次出发。']].map(([time, title, description], index) => <div key={time}><span className="explore-timeline-number">{String(index + 1).padStart(2, '0')}</span><div><small>{time}</small><h3>{title}</h3><p>{description}</p></div></div>)}</div></section><section id="activity-equipment" className="explore-prose-section"><h2>装备建议</h2><p>装备需求随海拔、季节、天气和技术条件变化。以下仅作通用准备提示，请以正式活动装备清单为准。</p><div className="explore-equipment-grid">{[['穿着与防护', '合脚徒步鞋、分层衣物、防风防雨外层、遮阳与防晒用品。'], ['补给与照明', '适量饮水与食物、备用能量补给、头灯及备用电源。'], ['应急与通信', '个人常用药、保温用品、离线地图与通信设备。']].map(([title, description]) => <div key={title}><Check size={17} /><h3>{title}</h3><p>{description}</p></div>)}</div></section><section id="activity-safety" className="explore-prose-section"><h2>安全，是每次出发的前提</h2><ul className="explore-safety-list"><li>如实评估健康与体能状况，主动告知领队可能影响参与的情况。</li><li>尊重天气与山地环境的变化，必要时调整计划或及时撤退。</li><li>遵循正式活动的领队安排，不擅自离队，不冒险追赶进度。</li><li>带走所有垃圾，减少对野生动植物和当地社区的干扰。</li></ul><p className="muted">本页不替代专业培训、实际风险评估及正式活动说明。</p></section></article><aside className="explore-detail-aside"><div className="explore-info-panel"><h2>活动信息</h2><Specs item={item} /><dl><div><dt>活动地点</dt><dd>{item.location || '待确认'}</dd></div><ActivityScheduleDetails activity={item}/><div><dt>组织与保障</dt><dd>正式发布时公布</dd></div><div><dt>活动费用</dt><dd>未公布</dd></div></dl><ActivityApplication key={item.id} activity={item} localDraft={localRequested}/><small className="explore-aside-note">{item.isDemo ? '示例内容 · 请勿据此安排行程' : '以正式领队通知及最新安排为准'}</small></div><div className="explore-quiet-panel"><ShieldCheck size={25} /><h3>认真准备，安心出发</h3><p>所有正式活动均应明确风险、装备要求与应急安排。</p></div></aside></div><section className="container section explore-related"><SectionHeading title="继续探索路线" description="了解山野，从认识一条路线开始。" to="/routes" linkText="查看全部路线" /><div className="explore-route-grid">{shownRoutes.map(route => <RouteCard item={route} key={route.id} />)}</div></section></div>;
}

function RouteCard({ item }) {
  return <article className="explore-route-card"><Link to={`/routes/${item.id}`} className="explore-route-image"><img src={item.image || '/images/redesign-v2/routes-coast.webp'} alt={item.title} loading="lazy" /><ImageNote item={item} /><span className="explore-route-difficulty">{item.difficulty || '待评估'}</span></Link><div className="explore-route-card-content"><span className="explore-card-location"><MapPin size={14} />{item.location || '地点待确认'}{item.isDemo && <span className="explore-demo-tag">示例路线</span>}</span><h3><Link to={`/routes/${item.id}`}>{item.title}</Link></h3><p>{item.description}</p><Specs item={item} inline /><div className="explore-route-card-foot"><span>{item.source || (item.isDemo ? '演示内容' : '来源待补充')}</span><Link to={`/routes/${item.id}`} aria-label={`查看${item.title}`}><ArrowRight size={20} /></Link></div></div></article>;
}

function TerrainMap({ items = [], selected, onSelect, detail = false }) {
  const uniqueId = useId().replace(/:/g, '');
  const coords = [[27, 56], [46, 32], [63, 57], [73, 27], [35, 74], [80, 72]];
  return <div className={`explore-terrain ${detail ? 'is-detail' : ''}`}><svg className="explore-topography" viewBox="0 0 1000 620" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs><radialGradient id={`terrain-${uniqueId}`}><stop offset="0" stopColor="#323c30" /><stop offset="1" stopColor="#18231c" /></radialGradient></defs><rect width="1000" height="620" fill={`url(#terrain-${uniqueId})`} />{Array.from({ length: 22 }, (_, index) => <path key={index} d={`M ${-240 + index * 24} -80 C ${40 + index * 14} ${120 + index * 6}, ${260 + index * 23} ${80 - index * 4}, ${210 + index * 27} 320 S ${630 + index * 19} ${240 + index * 10}, ${750 + index * 22} 690`} stroke={index % 4 === 0 ? '#6c795b' : '#53624b'} strokeOpacity={index % 4 === 0 ? .5 : .3} strokeWidth={index % 4 === 0 ? 1.5 : .75} fill="none" />)}<path d="M 770 -30 Q 660 120 730 220 T 660 440 T 550 680" stroke="#536f70" strokeWidth="7" opacity=".4" fill="none" /><path d="M 210 520 Q 325 420 295 360 T 390 275 T 475 190 T 625 135" stroke="#f07827" strokeWidth="4" strokeLinecap="round" strokeDasharray={detail ? undefined : '7 7'} fill="none" /><circle cx="210" cy="520" r="8" fill="#f07827" stroke="#fff" strokeWidth="3" /><circle cx="625" cy="135" r="8" fill="#fff" stroke="#f07827" strokeWidth="3" /><text x="470" y="395" className="explore-map-text">山地地形示意</text><text x="375" y="470" className="explore-map-text-small">示意地形，不可用于导航</text></svg><div className="explore-map-north"><span>N</span><Compass size={28} strokeWidth={1} /></div><div className="explore-map-label"><Layers3 size={15} />地形示意 · 非真实地图</div>{!detail && items.map((item, index) => { const [x, y] = coords[index % coords.length]; return <button key={item.id} type="button" className={`explore-map-pin ${selected === item.id ? 'is-selected' : ''}`} style={{ left: `${x}%`, top: `${y}%` }} onClick={() => onSelect(item.id)} aria-label={`查看示例路线：${item.title}`} aria-pressed={selected === item.id}><MapPin size={17} /><span>{item.title}</span></button>; })}{detail && <><span className="explore-map-point is-start">起点示意</span><span className="explore-map-point is-end">终点示意</span></>}<div className="explore-map-scale">示例 GPS · 不可用于导航</div></div>;
}

export function RoutesPage() {
  const { routes, loading, error, refresh } = useCatalog();
  const [view, setView] = useState('cards');
  const [query, setQuery] = useState('');
  const [region, setRegion] = useState('');
  const [distance, setDistance] = useState('');
  const [ascent, setAscent] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [source, setSource] = useState('');
  const [selected, setSelected] = useState(null);
  const filtered = routes.filter(item => matches(item, query) && (!region || item.location === region) && (!difficulty || item.difficulty === difficulty) && (!source || item.source === source) && (!distance || (distance === 'short' ? numberOf(item.distance) < 10 : distance === 'medium' ? numberOf(item.distance) >= 10 && numberOf(item.distance) <= 20 : numberOf(item.distance) > 20)) && matchesAscent(item.ascent, ascent));
  const selectedItem = filtered.find(item => item.id === selected) || filtered[0];
  const reset = () => { setQuery(''); setRegion(''); setDistance(''); setAscent(''); setDifficulty(''); setSource(''); };
  return <div className="explore-routes"><PageHero title="让脚步，丈量山野" description="从林间小径到高山垭口，认识一条路线，也认识自己的边界。" image="/images/redesign-v2/routes-coast.webp"></PageHero><section className="container section explore-list-section"><CatalogFeedback loading={loading} error={error} refresh={refresh} /><div className="explore-library-heading"><div><h2>路线库</h2><Link className="explore-text-link" to="/routes/import">导入 GPX / KML <ArrowRight size={15}/></Link></div><div className="explore-view-switch" role="group" aria-label="路线展示方式"><button type="button" className={view === 'cards' ? 'is-active' : ''} aria-pressed={view === 'cards'} onClick={() => setView('cards')}><Layers3 size={16} />卡片</button><button type="button" className={view === 'map' ? 'is-active' : ''} aria-pressed={view === 'map'} onClick={() => setView('map')}><Map size={16} />地图</button></div></div><div className="explore-route-filters"><SearchField value={query} onChange={setQuery} placeholder="搜索路线或目的地" /><FilterSelect label="地区" value={region} onChange={setRegion} options={choices(routes, 'location')} /><FilterSelect label="距离" value={distance} onChange={setDistance} options={[{ value: 'short', label: '10 km 以下' }, { value: 'medium', label: '10–20 km' }, { value: 'long', label: '20 km 以上' }]} /><FilterSelect label="爬升" value={ascent} onChange={setAscent} options={[{ value: 'low', label: '800 m 以下' }, { value: 'medium', label: '800–1500 m' }, { value: 'high', label: '1500 m 以上' }]} /><FilterSelect label="难度" value={difficulty} onChange={setDifficulty} options={choices(routes, 'difficulty')} /><FilterSelect label="来源" value={source} onChange={setSource} options={choices(routes, 'source')} /></div><div className="explore-results-meta"><span>找到 <strong>{filtered.length}</strong> 条路线</span><span><ShieldCheck size={14} />{isPreview ? '全部为示例路线，参数未经实地核验' : '出行前请核实轨迹与最新路况'}</span></div>{filtered.length ? view === 'cards' ? <div className="explore-route-grid">{filtered.map(item => <RouteCard item={item} key={item.id} />)}</div> : <div className="explore-map-layout"><TerrainMap items={filtered} selected={selectedItem?.id} onSelect={setSelected} /><div className="explore-map-selection"><span className="explore-eyebrow">选中路线</span><RouteCard item={selectedItem} /><p className="explore-map-disclaimer">点击示意点查看路线。点位仅用于展示交互，不代表真实地理位置。</p></div></div> : !loading && !error && <NoResults clear={reset} />}<div className="explore-route-disclaimer"><ShieldCheck size={22} /><div><strong>路线是起点，判断力让我们安全归来。</strong><p>山地条件始终在变化。正式出行前请核实开放情况、天气、轨迹与自身能力，本页信息不作导航或安全保证。</p></div></div></section></div>;
}

function ElevationProfile() {
  const id = useId().replace(/:/g, '');
  return <div className="explore-elevation"><div className="explore-elevation-header"><div><h3>海拔剖面示意</h3><span>归一化示例 · 非实测海拔</span></div><span className="explore-demo-tag">示例数据</span></div><svg viewBox="0 0 760 230" role="img" aria-label="示例海拔剖面图：路线从起点渐升至高点后回落，不代表本路线实际海拔或距离"><defs><linearGradient id={`profile-${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#f07827" stopOpacity=".32" /><stop offset="1" stopColor="#f07827" stopOpacity=".02" /></linearGradient></defs>{[50, 100, 150, 200].map(y => <line key={y} x1="45" x2="730" y1={y} y2={y} stroke="#333" strokeDasharray="3 6" />)}<path d="M45 190 L85 179 L120 185 L150 159 L185 143 L220 152 L260 112 L300 119 L330 78 L360 88 L405 40 L440 58 L470 82 L500 75 L535 107 L570 116 L610 148 L645 139 L680 161 L730 177 L730 200 L45 200Z" fill={`url(#profile-${id})`} /><path d="M45 190 L85 179 L120 185 L150 159 L185 143 L220 152 L260 112 L300 119 L330 78 L360 88 L405 40 L440 58 L470 82 L500 75 L535 107 L570 116 L610 148 L645 139 L680 161 L730 177" fill="none" stroke="#f07827" strokeWidth="2.5" strokeLinejoin="round" /><text x="45" y="225" fill="#aaa" fontSize="12">起点</text><text x="345" y="225" fill="#aaa" fontSize="12">路线进度 50%</text><text x="700" y="225" fill="#aaa" fontSize="12">终点</text><text x="8" y="57" fill="#888" fontSize="11">高</text><text x="8" y="198" fill="#888" fontSize="11">低</text><circle cx="405" cy="40" r="4" fill="#f07827" /><text x="418" y="32" fill="#ccc" fontSize="12">示意高点</text></svg></div>;
}

export function RouteDetailPage() {
  const { routes, loading } = useCatalog();
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const localRequested = isPreview && searchParams.get('draft') === '1';
  const localItem = localRequested ? readLocalRouteDraft(id) : null;
  const item = localRequested ? localItem : routes.find(route => String(route.id) === id);
  const [storedTrack, setStoredTrack] = useState(null);
  const [trackError, setTrackError] = useState('');
  const [trackLoading, setTrackLoading] = useState(false);
  const trackId = item?.trackLocalId;
  useEffect(() => {
    let active = true;setStoredTrack(null);setTrackError('');
    if (!localRequested || !trackId) {setTrackLoading(false);return;}
    setTrackLoading(true);
    getLocalTrack(trackId).then(value => {if(active){setStoredTrack(value);if(!value)setTrackError('此浏览器中的轨迹文件已丢失，请在路线管理重新导入。')}}).catch(error=>{if(active)setTrackError(error.message)}).finally(()=>{if(active)setTrackLoading(false)});
    return()=>{active=false};
  }, [id, trackId, localRequested]);
  const importedTrack = item?.track || storedTrack;
  const [trackNotice, setTrackNotice] = useState(false);
  useEffect(() => setTrackNotice(false), [id]);
  if (!item) return loading ? <CatalogLoading /> : <MissingPage kind="路线" to="/routes" />;
  return <div className="explore-detail explore-route-detail"><Breadcrumb section="路线库" to="/routes" current={item.title}/>{localRequested&&<div className="container track-draft-notice">本地草稿，仅在此浏览器可见，尚未公开发布。 <Link to="/admin/routes?preview=1">继续编辑</Link></div>}<div className="container explore-detail-heading"><span className="explore-eyebrow">{localRequested ? '本地路线草稿' : item.isDemo ? '示例路线' : '路线档案'}</span><h1>{item.title}</h1><div className="explore-heading-meta"><span><MapPin size={16} />{item.location}</span><span>{item.source || (item.isDemo ? '演示内容' : '来源待补充')}</span><span>未经实地核验</span></div></div><div className="container"><div className="explore-route-hero"><img src={item.image || '/images/redesign-v2/activities-snow.webp'} alt={item.title} /><div><ImageNote item={item}>AI 示意影像 · 非路线实拍</ImageNote><Specs item={item} inline /></div></div></div><div className="container explore-detail-grid"><article className="explore-detail-body"><nav className="explore-anchor-nav" aria-label="路线章节"><a href="#route-overview">路线概览</a><a href="#route-map">地图与剖面</a><a href="#route-stages">分段行程</a><a href="#route-preparation">装备与安全</a></nav><section id="route-overview" className="explore-prose-section"><h2>路线概览</h2><p className="explore-lead">{item.description || '轨迹已导入，路线介绍待补充。'}</p><p>一条路线的价值，不仅在于终点，也在于沿途的地形、环境和行走体验。出发前理解路线，现场保持判断，是每一位山野同行者的责任。</p><div className="explore-note"><Map size={21}/><div><strong>{item.isDemo ? '这是一份路线展示样例' : '根据上传文件生成'}</strong><p>{item.isDemo ? '示例参数用于界面展示，不作为实际出行依据。' : '里程与海拔来自轨迹文件，保留原始分段；导入并不代表路线已通过实地审核。'}</p></div></div></section><section id="route-map" className="explore-prose-section"><div className="explore-section-title"><h2>地图与海拔剖面</h2><span className="explore-demo-tag">{importedTrack ? importedTrack.format.toUpperCase() : '待导入轨迹'}</span></div>{trackLoading ? <p role="status">正在读取轨迹…</p> : trackError ? <p role="alert" className="track-import-error">{trackError}</p> : importedTrack ? <TrackVisualization track={importedTrack}/> : <div className="track-empty"><strong>尚未导入真实轨迹</strong><p>上传 GPX 或 KML 后将自动显示地图与各段海拔曲线。</p><Link to="/routes/import">导入轨迹文件 →</Link></div>}</section><section id="route-stages" className="explore-prose-section"><h2>分段行程</h2><p className="muted">以下仅展示行程组织框架，实际路段、时长和撤退点需在正式路线中核定。</p><div className="explore-stage-list">{[['01', '起点与适应段', '从确认过的入口出发，检查装备与队伍状态，在热身中建立适合全队的节奏。'], ['02', '主要行走段', '持续观察地形与天气，按既定方案行进，在安全位置休息和补给。'], ['03', '返程与撤离段', '预留充足返程时间；条件发生变化时，采用经核实的撤退方案。']].map(([number, title, text]) => <div key={number}><span>{number}</span><div><h3>{title}</h3><p>{text}</p></div></div>)}</div></section><section id="route-preparation" className="explore-prose-section"><h2>装备与安全</h2><div className="explore-equipment-grid"><div><Check size={17} /><h3>基础装备</h3><p>合脚鞋服、防风防雨外层、照明、充足饮水和能量补给。</p></div><div><Check size={17} /><h3>路线准备</h3><p>核实出入口与开放情况，准备经过确认的离线地图与撤退方案。</p></div><div><Check size={17} /><h3>尊重环境</h3><p>遵守当地规定，不留垃圾，不进入管控区域，不干扰野生动物。</p></div></div><div className="explore-note"><ShieldCheck size={21} /><div><strong>准备随环境调整</strong><p>高海拔、冰雪、暴露或技术地形需要额外能力与装备。若缺乏相应经验，请先接受专业训练，并与具备能力的伙伴同行。</p></div></div></section></article><aside className="explore-detail-aside"><div className="explore-info-panel"><h2>路线信息</h2><Specs item={item} /><dl><div><dt>所在地区</dt><dd>{item.location || '待确认'}</dd></div><div><dt>路线来源</dt><dd>{item.source || (item.isDemo ? '演示内容' : '来源待补充')}</dd></div><div><dt>轨迹状态</dt><dd>{importedTrack ? '文件已转换，待核验' : '尚未导入'}</dd></div><div><dt>适用季节</dt><dd>需实地确认</dd></div></dl><button type="button" className="btn explore-wide-button" onClick={() => importedTrack ? downloadTrackJson(importedTrack,true) : setTrackNotice(true)} aria-expanded={trackNotice}><Download size={17}/>{importedTrack ? '下载 GeoJSON 轨迹' : '轨迹文件说明'}</button>{trackNotice && <div className="explore-signup-notice" role="status"><strong>暂无真实 GPS 文件</strong><p>本站尚未发布经过审核的轨迹，因此当前不提供 GPX 下载。请勿将页面示意图作为导航依据。</p></div>}<small className="explore-aside-note">{item.isDemo ? '示例路线 · 请勿据此安排行程' : '请结合实地核验与最新天气安排行程'}</small></div><div className="explore-quiet-panel"><Mountain size={28} /><h3>山始终在那里</h3><p>及时调整与折返，也是成熟的山野选择。</p></div></aside></div><section className="container section explore-related"><SectionHeading title="更多山野路线" to="/routes" linkText="查看路线库" /><div className="explore-route-grid">{routes.filter(route => route.id !== item.id).slice(0, 3).map(route => <RouteCard key={route.id} item={route} />)}</div></section></div>;
}

function PhotoLightbox({ items, initialIndex, onClose, trigger }) {
  const [index, setIndex] = useState(initialIndex);
  const dialog = useRef(null);
  const closeButton = useRef(null);
  const titleId = useId();
  const photo = items[index];
  const step = direction => setIndex(current => (current + direction + items.length) % items.length);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousFocus = trigger || document.activeElement;
    document.body.style.overflow = 'hidden';
    closeButton.current?.focus();
    const onKey = event => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key === 'ArrowRight') { event.preventDefault(); setIndex(current => (current + 1) % items.length); }
      if (event.key === 'ArrowLeft') { event.preventDefault(); setIndex(current => (current - 1 + items.length) % items.length); }
      if (event.key === 'Tab') {
        const focusable = dialog.current?.querySelectorAll('button:not([disabled]), a[href], [tabindex="0"]');
        if (!focusable?.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && (document.activeElement === first || !dialog.current.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !dialog.current.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', onKey); if (previousFocus?.isConnected) previousFocus.focus(); };
  }, [items.length, onClose, trigger]);
  return createPortal(<div className="explore-lightbox" ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={event => { if (event.target === event.currentTarget) onClose(); }}><div className="explore-lightbox-top"><span><Camera size={17} />川衡 · 山野影像 {illustrativeImage(photo) && <small>示意影像</small>}</span><button ref={closeButton} type="button" className="explore-icon-button" onClick={onClose} aria-label="关闭影像灯箱"><X size={24} /></button></div><div className="explore-lightbox-stage"><button type="button" className="explore-lightbox-arrow is-prev" onClick={() => step(-1)} aria-label="上一张影像" disabled={items.length < 2}><ChevronLeft size={30} /></button><img src={photo.image || '/images/redesign-v2/home-summit.webp'} alt={photo.description || photo.title} /><button type="button" className="explore-lightbox-arrow is-next" onClick={() => step(1)} aria-label="下一张影像" disabled={items.length < 2}><ChevronRight size={30} /></button></div><div className="explore-lightbox-caption" aria-live="polite" aria-atomic="true"><div><h2 id={titleId}>{photo.title}</h2><p>{photo.description || (illustrativeImage(photo) ? 'AI 生成的山野视觉示意，非协会活动实拍。' : '川衡山野影像。')}</p></div><span>{String(index + 1).padStart(2, '0')} <i>/</i> {String(items.length).padStart(2, '0')}</span></div><div className="explore-lightbox-thumbnails" aria-label="选择影像">{items.map((item, itemIndex) => <button type="button" key={item.id} onClick={() => setIndex(itemIndex)} className={itemIndex === index ? 'is-active' : ''} aria-label={`查看影像：${item.title}`} aria-current={itemIndex === index ? 'true' : undefined}><img src={item.image || '/images/redesign-v2/home-summit.webp'} alt="" /></button>)}</div></div>, document.body);
}

export function GalleryPage() {
  const { photos, loading, error, refresh } = useCatalog();
  const [searchParams, setSearchParams] = useSearchParams();
  const [category, setCategory] = useState('全部影像');
  const [lightbox, setLightbox] = useState(null);
  const closeLightbox = useRef(() => setLightbox(null)).current;
  const photoCategories = [...new Set(photos.map(photo => photo.category || '待分类'))];
  const filtered = photos.filter(photo => category === '全部影像' || (photo.category || '待分类') === category);
  const photoQuery = searchParams.get('photo');
  useEffect(() => {
    if (!photoQuery) return;
    const index = photos.findIndex(photo => String(photo.id) === photoQuery);
    if (index < 0) return;
    setCategory('全部影像');
    setLightbox({ items: photos, initialIndex: index, trigger: null });
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('photo');
    setSearchParams(nextParams, { replace: true });
  }, [photoQuery, photos, searchParams, setSearchParams]);
  return <div className="explore-gallery"><PageHero title="山野，值得被看见" description="用影像留住一束光、一座山，以及同行的每一个瞬间。" image="/images/redesign-v2/gallery-sunset.webp"></PageHero><section className="container section explore-list-section"><CatalogFeedback loading={loading} error={error} refresh={refresh} /><div className="explore-gallery-toolbar"><div className="explore-tabs" role="group" aria-label="影像分类">{['全部影像', ...photoCategories].map(value => <button type="button" key={value} className={category === value ? 'is-active' : ''} aria-pressed={category === value} onClick={() => setCategory(value)}>{value}</button>)}</div><span className="explore-gallery-count">{String(filtered.length).padStart(2, '0')} 张影像</span></div>{isPreview && <div className="explore-gallery-note"><Camera size={16} /><span>本页为 AI 示意影像，用于展示山野摄影内容形式，非协会实拍记录。</span></div>}<div className="explore-photo-wall">{filtered.map((photo, index) => <button type="button" className={`explore-photo explore-photo-${index % 5}`} key={photo.id} onClick={event => setLightbox({ items: filtered, initialIndex: index, trigger: event.currentTarget })} aria-label={`放大查看：${photo.title}`}><img src={photo.image || '/images/redesign-v2/home-summit.webp'} alt={photo.description || photo.title} loading="lazy" /><ImageNote item={photo} className="explore-photo-label" /><span className="explore-photo-caption"><span>{photo.category || '待分类'}</span><strong>{photo.title}</strong><span className="explore-photo-plus">＋</span></span></button>)}</div>{!filtered.length && !loading && !error && <EmptyState title="这一组影像还在路上" description="请先浏览其他分类。" />}<div className="explore-gallery-end"><p>镜头之外，还有更辽阔的世界。</p><ButtonLink to="/activities" className="btn-outline">开启一场山野同行</ButtonLink></div></section>{lightbox && <PhotoLightbox {...lightbox} onClose={closeLightbox} />}</div>;
}

function ArticleMeta({ item }) {
  return <div className="explore-article-meta"><span>{activityDateLabel(item)}</span><span><Clock3 size={13} />{typeof item.readTime === 'number' ? `约 ${item.readTime} 分钟` : (item.readTime || '约 5 分钟')}</span></div>;
}

export function NewsPage() {
  const { articles, loading, error, refresh } = useCatalog();
  const [category, setCategory] = useState('全部资讯');
  const [query, setQuery] = useState('');
  const filtered = articles.filter(item => (category === '全部资讯' || item.category === category) && matches(item, query));
  const first = filtered[0];
  return <div className="explore-news"><PageHero title="读山野，也读自己" description="关于户外的知识、思考与故事，让每一次出发更有准备。" image="/images/redesign-v2/activities-snow.webp"></PageHero><section className="container section explore-list-section"><CatalogFeedback loading={loading} error={error} refresh={refresh} /><div className="explore-news-toolbar"><div className="explore-tabs" role="group" aria-label="资讯分类">{['全部资讯', ...choices(articles, 'category')].map(value => <button type="button" key={value} onClick={() => setCategory(value)} className={category === value ? 'is-active' : ''} aria-pressed={category === value}>{value}</button>)}</div><SearchField value={query} onChange={setQuery} placeholder="搜索文章" /></div><div className="explore-results-meta"><span>共 <strong>{filtered.length}</strong> 篇内容</span>{isPreview && <span>示例编辑内容</span>}</div>{first && <article className="explore-featured-article"><Link to={`/news/${first.id}`} className="explore-featured-image"><img src={first.image || '/images/redesign-v2/activities-snow.webp'} alt={first.title} /><ImageNote item={first} /></Link><div className="explore-featured-content"><span className="explore-eyebrow">{first.category}</span><h2><Link to={`/news/${first.id}`}>{first.title}</Link></h2><p>{first.description}</p><ArticleMeta item={first} /><Link to={`/news/${first.id}`} className="explore-text-link">阅读文章 <ArrowRight size={18} /></Link></div></article>}<div className="explore-article-grid">{filtered.slice(1).map(item => <article className="explore-article-card" key={item.id}><Link to={`/news/${item.id}`} className="explore-article-image"><img src={item.image || '/images/redesign-v2/routes-coast.webp'} alt={item.title} loading="lazy" /><ImageNote item={item} /></Link><div><span className="explore-eyebrow">{item.category}</span><h2><Link to={`/news/${item.id}`}>{item.title}</Link></h2><p>{item.description}</p><ArticleMeta item={item} /><Link to={`/news/${item.id}`} className="explore-text-link">阅读全文 <ArrowRight size={16} /></Link></div></article>)}</div>{!filtered.length && !loading && !error && <NoResults clear={() => { setCategory('全部资讯'); setQuery(''); }} />}</section></div>;
}

export function ArticlePage() {
  const { articles, loading } = useCatalog();
  const { id } = useParams();
  const item = articles.find(article => String(article.id) === id);
  if (!item) return loading ? <CatalogLoading /> : <MissingPage kind="资讯" to="/news" />;
  const body = Array.isArray(item.body) ? item.body.filter(section => section && typeof section === 'object') : [];
  return <div className="explore-article-detail"><Breadcrumb section="资讯" to="/news" current={item.title} /><header className="container explore-article-header"><span className="explore-eyebrow">{item.category}</span><h1>{item.title}</h1><p>{item.description}</p><div className="explore-article-byline"><span className="explore-author-mark">川</span><span>川衡编辑内容{item.isDemo && <span className="explore-demo-tag">示例文章</span>}</span><ArticleMeta item={item} /></div></header><div className="container"><div className="explore-detail-cover"><img src={item.image || '/images/redesign-v2/routes-coast.webp'} alt={item.title} /><ImageNote item={item}>AI 示意影像 · 非协会实拍</ImageNote></div></div><div className="container explore-article-reading"><aside className="explore-article-toc"><span className="explore-eyebrow">本文目录</span><nav aria-label="文章目录">{body.map((section, index) => <a href={`#article-section-${index}`} key={`${section.heading}-${index}`}>{section.heading || `第 ${index + 1} 节`}</a>)}</nav><Link to="/news"><ArrowLeft size={15} />返回全部资讯</Link></aside><article className="explore-article-prose"><p className="explore-article-intro">{item.description}</p>{body.map((section, index) => <section key={`${section.heading}-${index}`} id={`article-section-${index}`}><h2>{section.heading}</h2>{String(section.text || '').split('\n').filter(Boolean).map((paragraph, paragraphIndex) => <p key={paragraphIndex}>{paragraph}</p>)}</section>)}<div className="explore-note"><ShieldCheck size={21} /><div><strong>准备充分，保持判断</strong><p>{item.isDemo ? '本文为网站示例编辑内容。' : ''}户外环境、个体能力与装备情况各不相同，实际行动前请核实信息，并在需要时寻求专业指导。</p></div></div><div className="explore-article-bottom"><span>{item.category}</span><Link to="/news" className="explore-text-link">返回资讯 <ArrowRight size={17} /></Link></div></article></div><section className="container section explore-related"><SectionHeading title="继续阅读" to="/news" linkText="全部资讯" /><div className="explore-article-grid">{articles.filter(article => article.id !== item.id).slice(0, 3).map(article => <article className="explore-article-card" key={article.id}><Link className="explore-article-image" to={`/news/${article.id}`}><img src={article.image || '/images/redesign-v2/routes-coast.webp'} alt={article.title} loading="lazy" /><ImageNote item={article} /></Link><div><span className="explore-eyebrow">{article.category}</span><h2><Link to={`/news/${article.id}`}>{article.title}</Link></h2><ArticleMeta item={article} /></div></article>)}</div></section></div>;
}
