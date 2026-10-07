import { lazy, Suspense, useMemo, useState } from 'react';
import { Link, Navigate, useLocation, useParams } from 'react-router-dom';
import { ArrowDown, ArrowUpRight, CalendarDays, MapPin, Mountain, Footprints, ChevronLeft, Clock3, Compass } from 'lucide-react';
import { useContent } from '../App';
import type { Activity } from '../types';
import { activityCity, activityRoute } from '../features/activity-location';
import { ParallaxImage, Reveal, DemoBadge, Signup, usePageTitle } from '../components';
import PageReader from '../features/PageReader';
import '../features/activity-reader.css';
import './activity-detail-reader.css';
import SemesterCalendar from '../features/SemesterCalendar';
import { ActivityFilters, filterActivities, initialActivityFilters } from '../features/ActivityFilters';
import ActivityPreparation from '../features/ActivityPreparation';
import TrailAlbum from '../features/TrailAlbum';
import ActivityRegistration from '../auth/ActivityRegistration';
import { useAuth } from '../auth/AuthContext';
import { canViewMemberActivities } from '../auth/permissions';

const FootprintMap = lazy(() => import('../features/FootprintMap'));

function dateParts(value: string) { const date = new Date(`${value}T12:00:00`); return { day: date.getDate().toString().padStart(2, '0'), month: `${date.getMonth() + 1}月`, full: date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' }) }; }

function ActivityCard({ activity, index = 0, archive = false }: { activity: Activity; index?: number; archive?: boolean }) {
  const date = dateParts(activity.date);
  return <Reveal delay={index * 60} className={`activity-card ${archive ? 'archive-card' : ''}`}><Link to={`/activities/${activity.id}`} className="card-image"><img src={activity.image || '/images/hiking.webp'} alt={`${activity.title}的${activity.isDemo ? '示意' : ''}山野影像`} loading="lazy"/><span className="card-category">{activity.category}</span>{activity.isDemo && <DemoBadge/>}<span className="card-image-action"><ArrowUpRight size={24}/></span></Link><div className="card-body">{!archive && <div className="date-block"><strong>{date.day}</strong><span>{date.month}</span></div>}<div className="card-copy"><div className="card-metadata">{archive && <span>{date.full}</span>}<span><MapPin size={14}/>{activityRoute(activity)}</span>{!archive && <span>{activity.difficulty}</span>}</div><h3><Link to={`/activities/${activity.id}`}>{activity.title}</Link></h3><p>{activity.summary}</p>{!archive && <div className="activity-preference-tags"><span><Clock3 size={13}/>{activity.duration || (activity.timeCommitment ? ({'half-day':'半日以内','full-day':'一整天','multi-day':'多日'}[activity.timeCommitment]) : '时长待公布')}</span>{activity.experience && <span><Compass size={13}/>{{relaxed:'轻松漫步',scenic:'山野探索',skills:'技能练习'}[activity.experience]}</span>}</div>}{archive ? <Link className="text-link" to={`/activities/${activity.id}`}>看看我们的足迹 <ArrowUpRight size={15}/></Link> : <Link className="text-link" to={`/activities/${activity.id}`}>活动详情与报名 <ArrowUpRight size={15}/></Link>}</div></div></Reveal>;
}

export function ActivitiesPage() {
  usePageTitle('活动与足迹');
  const { settings, activities } = useContent();
  const [filters, setFilters] = useState(initialActivityFilters);
  const upcomingActivities = useMemo(() => activities.filter(a => a.kind === 'upcoming'), [activities]);
  const upcoming = useMemo(() => filterActivities(upcomingActivities, filters).sort((a, b) => a.date.localeCompare(b.date)), [upcomingActivities, filters]);
  const past = activities.filter(a => a.kind === 'past').sort((a, b) => b.date.localeCompare(a.date));
  const hasFilters = Object.values(filters).some(value => value !== '全部');
  const next = activities.filter(a => a.kind === 'upcoming').sort((a, b) => a.date.localeCompare(b.date))[0];
  return <PageReader title="活动与足迹" className="activity-reader" chapters={[
    { id: 'departure', title: '向山而行', content: <>
    <section className="activities-hero"><ParallaxImage src={settings.heroActivities} alt={settings.demoMode !== false ? '青绿山脊与远处徒步者的示意影像' : '川衡户外活动影像'}/><div className="hero-shade"/><div className="hero-content container"><div className="hero-copy"><span className="eyebrow hero-eyebrow"><span className="tiny-line"/> INTO THE GREAT OUTDOORS</span><h1>把周末，<br/>交给山野<span className="lime-dot">。</span></h1><p>走一段山路，认识一群同路人。<br/>下一次出发，等你一起。</p><a className="button button-lime" href="#semester-calendar">查看本学期日历 <ArrowDown size={17}/></a></div>{next && <Link to={`/activities/${next.id}`} className="next-outing"><div className="next-label">NEXT UP · 下一次出发 {next.isDemo && <DemoBadge/>}</div><div className="next-date">{dateParts(next.date).full} <ArrowUpRight size={22}/></div><h2>{next.title}</h2><p>{activityRoute(next)} <span>·</span> {next.difficulty}</p></Link>}<div className="hero-bottom"><span>CHUANHENG MOUNTAINEERING ASSOCIATION</span><a href="#semester-calendar" aria-label="向下浏览本学期日历"><span>向山而行</span><ArrowDown size={16}/></a></div></div></section>
    <div className="activity-intro-strip"><div className="container"><span><Footprints size={18}/> 一起走出去</span><p>徒步 / 登山 / 攀岩 / 户外探索</p><span className="strip-location">{settings.school} · 川衡</span></div></div>
    </> },
    { id: 'semester-calendar', title: '学期日历', content: <SemesterCalendar activities={activities} settings={settings}/> },
    { id: 'calendar', title: '活动预告', content:
    <section className="calendar-section container" id="calendar">
      <Reveal><div className="section-heading"><div><span className="eyebrow">02 / UPCOMING ADVENTURES</span><h2>下一次，一起出发。</h2></div><div className="activity-selection-intro"><p>留出一点时间，<br/>找到你喜欢的出发方式。</p><a href="#semester-calendar" className="text-link"><CalendarDays size={16}/> 本学期日历 <ArrowUpRight size={14}/></a></div></div></Reveal>
      <ActivityFilters activities={upcomingActivities} filters={filters} onChange={setFilters}/>
      {upcoming.length ? <div className="upcoming-grid">{upcoming.map((a, i) => <ActivityCard key={a.id} activity={a} index={i}/>)}</div> : <div className="empty-state"><Mountain size={32}/><h3>{hasFilters ? '这个组合，暂时还没有活动。' : '新的出发，正在准备。'}</h3><p>{hasFilters ? '试试其他时间或体验，找到下一次出发。' : '下一次活动安排将在这里公布。'}</p>{hasFilters && <button className="text-link" onClick={() => setFilters({...initialActivityFilters})}>查看全部活动 <ArrowUpRight size={16}/></button>}</div>}
    </section>
    },
    { id: 'past-adventures', title: '活动回顾', content:
    <section className="past-section"><div className="container"><Reveal><div className="section-heading"><div><span className="eyebrow">03 / TRAILS WE'VE SHARED</span><h2>走过的路，都算数。</h2></div><p>把风景留下，<br/>也把一起出发的记忆留下。</p></div></Reveal>{past.length ? <div className="past-grid">{past.map((a, i) => <ActivityCard key={a.id} activity={a} archive index={i}/>)}</div> : <div className="empty-state"><Footprints size={28}/><h3>我们的足迹，陆续记录。</h3><p>活动回顾将在这里更新。</p></div>}</div></section>
    },
    { id: 'trail-album', title: '山野相册', content: <TrailAlbum activities={activities}/> },
    { id: 'footprints', title: '足迹地图', content: <Suspense fallback={<section id="footprints" className="container footprint-loading" aria-label="中国足迹地图"><span className="eyebrow">05 / OUR FOOTPRINTS</span><h2>中国足迹地图</h2><p>正在打开地图…</p></section>}><FootprintMap/></Suspense> },
    { id: 'outdoors-story', title: '同行故事', content:
    <section className="outdoors-story"><ParallaxImage src={settings.storyHiking} alt={settings.demoMode !== false ? '阳光透过森林与山野小径的示意影像' : '同行的山野记忆'}/><div className="story-shade"/><div className="container story-content"><Reveal><span className="eyebrow">MORE THAN A DESTINATION</span><h2>目的地是山野，<br/>收获是我们。</h2><p>从校园到山间，从陌生到同行。<br/>在川衡，每一次出发都是新的相遇。</p><Link to="/about" className="button button-white">认识川衡 <ArrowUpRight size={18}/></Link></Reveal></div>{settings.demoMode !== false && <span className="image-caption">AI 生成示意影像</span>}</section>
    },
    { id: 'join', title: '一起出发', content: <section className="container home-signup"><Signup settings={settings}/></section> },
  ]}/>;
}

export function ActivityDetail() {
  const { id } = useParams();
  const location = useLocation();
  const { user, checking } = useAuth();
  const { activities, settings } = useContent();
  const activity = activities.find(a => a.id === id);
  usePageTitle(activity?.title || '活动详情');
  if (activity?.kind === 'upcoming') {
    if (checking) return <div className="auth-loading" role="status">正在检查登录状态…</div>;
    if (!canViewMemberActivities(user)) return <Navigate replace to={`/login?membership=required&redirect=${encodeURIComponent(location.pathname + location.search + location.hash)}`}/>;
  }
  if (!activity) return <PageReader title="活动详情" className="activity-detail-page" chapters={[{ id: 'unavailable', title: '活动暂未公开', content: <div className="not-found container"><h1>活动暂未公开。</h1><p>这项活动可能正在筹备或已下架。</p><Link className="button button-green" to="/">浏览公开活动</Link></div> }]}/>;
  return <PageReader title={activity.title} className="detail-page activity-detail-page" chapters={[
    { id: 'activity-overview', title: '活动概览', content: <section><div className="container detail-header"><Link to="/" className="back-link"><ChevronLeft size={16}/> 活动与足迹</Link><div className="detail-tags"><span className="eyebrow">{activity.kind === 'past' ? 'TRAIL JOURNAL / 活动回顾' : 'NEXT ADVENTURE / 活动预告'}</span>{activity.isDemo && <DemoBadge/>}</div><h1>{activity.title}</h1><p className="detail-lead">{activity.summary}</p><div className="detail-facts"><span><CalendarDays size={18}/>{dateParts(activity.date).full}</span><span><MapPin size={18}/>{activityCity(activity) || '城市待确认'}</span><span><Footprints size={18}/>{activityRoute(activity) || '路线待公布'}</span><span><Mountain size={18}/>{activity.difficulty}</span></div></div><div className="detail-cover container"><img src={activity.image || settings.heroActivities} alt={`${activity.title}的${activity.isDemo ? '示意' : ''}影像`}/></div></section> },
    { id: 'activity-plan', title: activity.kind === 'past' ? '活动回顾' : '活动安排与报名', content: <div className="detail-columns container"><section className="prose"><span className="eyebrow">{activity.kind === 'past' ? 'OUR EXPERIENCE' : 'THE PLAN'}</span><h2>{activity.kind === 'past' ? '一起走过的这一天' : '这次，我们这样出发'}</h2><div className="preserve-lines">{activity.description}</div>{activity.isDemo && <div className="demo-note">此活动为版式演示，日期、地点与安排均为示意。请以公众号正式发布的活动信息为准。</div>}</section><aside>{activity.kind === 'past' ? <><h3>下一次，和我们一起</h3><p>正式活动安排通过协会公众号公布。</p><Signup settings={settings} signupUrl={activity.signupUrl} qrImage={activity.qrImage} compact/></> : <ActivityRegistration key={activity.id} activity={activity}/>}</aside></div> },
    { id: 'activity-preparation', title: activity.kind === 'past' ? '准备清单回顾' : '出发准备', content: <><div className="container detail-preparation"><ActivityPreparation key={activity.id} activity={activity}/></div><div className="container detail-bottom"><Link className="text-link" to="/">返回全部活动 <ArrowUpRight size={17}/></Link></div></> },
  ]}/>;
}
