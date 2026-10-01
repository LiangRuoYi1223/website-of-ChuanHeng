import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, CalendarDays, ChevronLeft, ChevronRight, Clock3, ExternalLink, Flag, MapPin, Mountain, Sunrise, Wallet, X } from 'lucide-react';
import type { Activity, SiteSettings } from '../types';
import './semester-calendar.css';

type CalendarActivity = Activity & { duration?: string; cost?: string; meetingPoint?: string; beginnerFriendly?: string; registrationStatus?: string };
type CalendarSettings = SiteSettings & { semesterName?: string; semesterStart?: string; semesterEnd?: string };
const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
const isoDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const parseDate = (value: string) => new Date(`${value}T12:00:00`);
const fullDate = (value: string) => parseDate(value).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
function validDate(value: string | undefined, fallback: string) { return value && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(+parseDate(value)) && isoDate(parseDate(value)) === value ? value : fallback; }

export default function SemesterCalendar({ activities, settings }: { activities: Activity[]; settings: SiteSettings }) {
  const config = settings as CalendarSettings;
  const start = validDate(config.semesterStart, '2026-09-01');
  const rawEnd = validDate(config.semesterEnd, '2027-01-31');
  const end = rawEnd >= start ? rawEnd : start;
  const months = useMemo(() => {
    const result: { key: string; year: number; month: number }[] = [];
    const cursor = parseDate(`${start.slice(0, 7)}-01`);
    for (let i = 0; i < 24 && isoDate(cursor).slice(0, 7) <= end.slice(0, 7); i++) {
      result.push({ key: isoDate(cursor).slice(0, 7), year: cursor.getFullYear(), month: cursor.getMonth() });
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return result;
  }, [start, end]);
  const today = isoDate(new Date());
  const initialIndex = Math.max(0, months.findIndex(item => item.key === today.slice(0, 7)));
  const [monthIndex, setMonthIndex] = useState(today > end ? months.length - 1 : initialIndex);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusedDate, setFocusedDate] = useState('');
  const calendarRef = useRef<HTMLDivElement>(null);
  const month = months[Math.min(Math.max(monthIndex, 0), months.length - 1)] ?? { key: start.slice(0, 7), year: parseDate(start).getFullYear(), month: parseDate(start).getMonth() };
  const semesterActivities = useMemo(() => activities.filter(item => item.status === 'published' && item.date >= start && item.date <= end).sort((a, b) => a.date.localeCompare(b.date)), [activities, start, end]);
  const dayMap = useMemo(() => {
    const result = new Map<string, CalendarActivity[]>();
    semesterActivities.forEach(item => result.set(item.date, [...(result.get(item.date) ?? []), item]));
    return result;
  }, [semesterActivities]);
  const selectedActivities = selectedDate ? dayMap.get(selectedDate) ?? [] : [];
  const selectedActivity = selectedActivities.find(item => item.id === selectedId) ?? selectedActivities[0];
  const nextActivity = semesterActivities.find(item => item.kind === 'upcoming' && item.date >= today);
  const monthActivityCount = semesterActivities.filter(item => item.date.startsWith(month.key)).length;
  const firstWeekday = (new Date(month.year, month.month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(month.year, month.month + 1, 0).getDate();
  const cellCount = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;

  function selectDate(date: string) { setFocusedDate(date); setSelectedDate(date); setSelectedId(dayMap.get(date)?.[0]?.id ?? null); }
  function changeMonth(index: number) { if (index < 0 || index >= months.length) return; setMonthIndex(index); setSelectedDate(null); setSelectedId(null); setFocusedDate(''); }
  function closePreview() {
    const date = selectedDate;
    setSelectedDate(null); setSelectedId(null);
    requestAnimationFrame(() => calendarRef.current?.querySelector<HTMLButtonElement>(`button[data-date="${date}"]`)?.focus());
  }
  function moveFocus(event: KeyboardEvent<HTMLButtonElement>, date: string) {
    let difference = 0;
    if (event.key === 'ArrowLeft') difference = -1;
    else if (event.key === 'ArrowRight') difference = 1;
    else if (event.key === 'ArrowUp') difference = -7;
    else if (event.key === 'ArrowDown') difference = 7;
    else if (event.key === 'Home') difference = -((parseDate(date).getDay() + 6) % 7);
    else if (event.key === 'End') difference = 6 - ((parseDate(date).getDay() + 6) % 7);
    else return;
    event.preventDefault();
    const next = parseDate(date); next.setDate(next.getDate() + difference);
    const key = isoDate(next);
    if (key < start || key > end) return;
    const nextMonth = months.findIndex(item => item.key === key.slice(0, 7));
    if (nextMonth !== monthIndex) { setMonthIndex(nextMonth); setSelectedDate(null); setSelectedId(null); }
    setFocusedDate(key);
    requestAnimationFrame(() => calendarRef.current?.querySelector<HTMLButtonElement>(`button[data-date="${key}"]`)?.focus());
  }

  return <section className="semester-section" id="semester-calendar" aria-labelledby="semester-heading">
    <div className="semester-section-head"><div><span className="semester-eyebrow">THIS SEMESTER / OUR NEXT ADVENTURES</span><h2 id="semester-heading">本学期，把出发排进日历。</h2><p>选一个日子，看看山野里的下一次相遇。</p></div><div className="semester-term-label"><span>{config.semesterName || '2026 秋季学期'}</span><small>{start.replaceAll('-', '.')} — {end.replaceAll('-', '.')}</small><em>示意安排 · 以公众号正式通知为准</em></div></div>
    <div className={`semester-layout ${selectedDate ? 'semester-layout-expanded' : ''}`}>
      <div className="semester-calendar" ref={calendarRef}>
        <div className="semester-month-tabs" aria-label="选择学期月份">{months.map((item, index) => {
          const count = semesterActivities.filter(activity => activity.date.startsWith(item.key)).length;
          return <button key={item.key} type="button" className="semester-month-tab" aria-label={`${item.year}年${item.month + 1}月，${count}场活动`} aria-pressed={monthIndex === index} onClick={() => changeMonth(index)}><span>{item.month === 0 && <b className="semester-tab-year">{item.year} · </b>}{String(item.month + 1).padStart(2, '0')}<small>月</small></span><em>{count ? `${count} 次出发` : '等待新的出发'}</em></button>;
        })}</div>
        <div className="semester-month-heading"><div><span className="semester-eyebrow">{month.year} / MONTHLY PLAN</span><h3>{month.month + 1}月<span>的山野邀约</span></h3></div><div className="semester-month-controls"><span>{monthActivityCount} 场活动</span><button type="button" aria-label="上一个月" disabled={monthIndex === 0} onClick={() => changeMonth(monthIndex - 1)}><ChevronLeft size={18}/></button><button type="button" aria-label="下一个月" disabled={monthIndex >= months.length - 1} onClick={() => changeMonth(monthIndex + 1)}><ChevronRight size={18}/></button></div></div>
        <div className="semester-weekdays" aria-hidden="true">{weekdays.map(day => <span key={day}>{day}</span>)}</div>
        <div className="semester-days" aria-label={`${month.year}年${month.month + 1}月日期，使用方向键浏览`}>
          {Array.from({ length: cellCount }, (_, index) => {
            const day = index - firstWeekday + 1;
            if (day < 1 || day > daysInMonth) return <div className="semester-day-blank" key={`blank-${index}`} aria-hidden="true"/>;
            const date = `${month.key}-${String(day).padStart(2, '0')}`;
            const items = dayMap.get(date) ?? [];
            const disabled = date < start || date > end;
            const label = `${fullDate(date)}，${items.length ? `${items.length}场活动：${items.map(item => item.title).join('、')}` : '暂无活动安排'}`;
            return <button key={date} type="button" className={`semester-day ${items.length ? 'semester-day-has-activity' : ''} ${date === today ? 'semester-day-today' : ''}`} data-date={date} disabled={disabled} aria-label={label} aria-pressed={selectedDate === date} aria-controls="semester-preview" tabIndex={focusedDate ? focusedDate === date ? 0 : -1 : day === (month.key === today.slice(0, 7) ? parseDate(today).getDate() : 1) ? 0 : -1} onClick={() => selectDate(date)} onFocus={() => setFocusedDate(date)} onKeyDown={event => moveFocus(event, date)}><span className="semester-day-number">{String(day).padStart(2, '0')}{date === today && <small>今天</small>}</span>{items.length > 0 && <><span className="semester-day-title">{items[0].title}</span><span className="semester-day-count"><i/>{items.length > 1 ? `${items.length} 场活动` : items[0].category || '户外活动'}</span></>}</button>;
          })}
        </div>
        <div className="semester-calendar-foot"><span><i/>有活动的日子</span><p>{selectedDate ? '选择其他日期，继续看看出发安排。' : '点选任意日期，展开当天的活动速览。'}</p><span>{semesterActivities.length} 次学期出发</span></div>
        {!selectedDate && nextActivity && <button type="button" className="semester-next" onClick={() => { const index = months.findIndex(item => item.key === nextActivity.date.slice(0, 7)); if (index >= 0) setMonthIndex(index); selectDate(nextActivity.date); }}><span>NEXT UP / 下一次出发</span><strong>{nextActivity.title}</strong><small>{fullDate(nextActivity.date)}</small><ArrowUpRight size={20}/></button>}
      </div>
      {selectedDate && <aside className="semester-preview" id="semester-preview" aria-label="当天活动速览"><div className="semester-preview-head"><div><span className="semester-eyebrow">A DAY OUT / 活动速览</span><p aria-live="polite">{fullDate(selectedDate)}</p></div><button type="button" className="semester-close" aria-label="关闭活动速览，返回完整日历" onClick={closePreview}><X size={20}/></button></div>
        {selectedActivities.length > 1 && <div className="semester-activity-switch"><span>当天有 {selectedActivities.length} 场活动</span><div>{selectedActivities.map(item => <button type="button" key={item.id} aria-pressed={selectedActivity?.id === item.id} onClick={() => setSelectedId(item.id)}>{item.title}</button>)}</div></div>}
        {selectedActivity ? <div className="semester-activity-content" key={selectedActivity.id}><div className="semester-preview-image"><img src={selectedActivity.image || settings.heroActivities || '/images/hiking.webp'} alt={`${selectedActivity.title}${selectedActivity.isDemo ? '的示意封面' : '的活动封面'}`}/><span>{selectedActivity.category || '户外活动'}</span>{selectedActivity.isDemo && <em>示意内容</em>}</div><div className="semester-preview-copy"><h3>{selectedActivity.title}</h3><p>{selectedActivity.summary || '更多安排将通过协会公众号公布。'}</p><dl className="semester-facts">{[{icon:CalendarDays,label:'活动日期',value:fullDate(selectedActivity.date)},{icon:MapPin,label:'地点 / 路线',value:selectedActivity.location},{icon:Mountain,label:'难度',value:selectedActivity.difficulty},{icon:Sunrise,label:'新手参与',value:selectedActivity.beginnerFriendly},{icon:Clock3,label:'预计时长',value:selectedActivity.duration},{icon:Wallet,label:'费用说明',value:selectedActivity.cost},{icon:Flag,label:'集合区域',value:selectedActivity.meetingPoint}].map(fact => <div key={fact.label}><dt><fact.icon size={15}/>{fact.label}</dt><dd>{fact.value || '待公布'}</dd></div>)}</dl><div className="semester-registration"><i/><div><span>报名状态</span><strong>{selectedActivity.registrationStatus || '待公布'}</strong></div></div>{selectedActivity.isDemo && <p className="semester-demo-note">此活动为示意安排，请以公众号正式发布的信息为准。</p>}<div className="semester-preview-actions"><Link to={`/activities/${selectedActivity.id}`} className="semester-detail-link">完整活动详情 <ArrowUpRight size={17}/></Link>{selectedActivity.signupUrl || settings.officialSignupUrl ? <a href={selectedActivity.signupUrl || settings.officialSignupUrl} target="_blank" rel="noopener noreferrer" className="semester-signup-link">公众号报名 <ExternalLink size={16}/></a> : <span className="semester-signup-pending">公众号入口待补充</span>}</div>{(selectedActivity.qrImage || settings.officialQrImage) && <details className="semester-qr"><summary>查看公众号二维码</summary><img src={selectedActivity.qrImage || settings.officialQrImage} alt="公众号报名二维码"/></details>}</div></div> : <div className="semester-empty"><Mountain size={48} strokeWidth={1}/><span>ROOM FOR THE OUTDOORS</span><h3>这一天，先留给期待。</h3><p>当天暂无公开活动安排。<br/>新的出发计划会在这里陆续更新。</p><button type="button" onClick={closePreview}>回到学期日历 <ArrowUpRight size={16}/></button></div>}
      </aside>}
    </div>
  </section>;
}
