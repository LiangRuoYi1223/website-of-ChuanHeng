import { useEffect, useId, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Compass, Mountain, Route as RouteIcon, X } from 'lucide-react';
import ActivityApplication from '../applications/ActivityApplication.jsx';
import ActivityScheduleDetails from './ActivityScheduleDetails.jsx';
import { formatActivityTime, scheduleInstant } from './schedule.js';
import { formatRegistrationFee } from './registration-fee.js';
import './activity-sidebar.css';

const MOBILE_QUERY = '(max-width: 800px)';
function metric(value, unit, digits) {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? `${Number(value.toFixed(digits))} ${unit}` : '暂不提供数据';
  return typeof value === 'string' && value.trim() ? value : '暂不提供数据';
}
function useMobileScreen() {
  const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && (window.matchMedia ? window.matchMedia(MOBILE_QUERY).matches : window.innerWidth <= 800));
  useEffect(() => {
    if (!window.matchMedia) {
      const update = () => setMobile(window.innerWidth <= 800);
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const media = window.matchMedia(MOBILE_QUERY);
    const update = event => setMobile(event.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return mobile;
}
function closeDialog(dialog) {
  if (!dialog?.open) return;
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
}

function SidebarPanel({ activity, summary, details, actions, shortLabel, detailsLabel = '查看报名详情', checking }) {
  const mobile = useMobileScreen();
  const location = useLocation();
  const [tab, setTab] = useState('information');
  const [open, setOpen] = useState(false);
  const mobileRef = useRef(mobile);
  mobileRef.current = mobile;
  const anchor = useRef(null);
  const dialog = useRef(null);
  const trigger = useRef(null);
  const closeButton = useRef(null);
  const returnFocus = useRef(null);
  const tabRefs = useRef([]);
  const scrolling = useRef(null);
  const wasModal = useRef(false);
  const uid = useId();
  const titleId = `${uid}-title`;
  const tabs = [
    { key: 'information', label: '活动资料', tabId: `${uid}-information-tab`, panelId: `${uid}-information` },
    { key: 'registration', label: '报名详情', tabId: `${uid}-registration-tab`, panelId: `${uid}-registration` },
  ];

  useEffect(() => {
    setTab('information');
    setOpen(false);
  }, [activity.id]);

  useEffect(() => {
    let frame;
    const revealRegistration = hash => {
      if (hash !== '#application') return;
      setTab('registration');
      if (mobileRef.current) {
        returnFocus.current = trigger.current;
        setOpen(true);
      } else {
        frame = window.requestAnimationFrame(() => anchor.current?.scrollIntoView?.({ block: 'start' }));
      }
    };
    const handleHashChange = () => revealRegistration(window.location.hash);
    revealRegistration(location.hash);
    window.addEventListener('hashchange', handleHashChange);
    return () => { window.removeEventListener('hashchange', handleHashChange); window.cancelAnimationFrame(frame); };
  }, [activity.id, location.hash]);

  useEffect(() => {
    if (scrolling.current) scrolling.current.scrollTop = 0;
  }, [tab]);

  useEffect(() => {
    if (!mobile) setOpen(false);
    const node = dialog.current;
    if (!node) return;
    if (!mobile) {
      const exitingModal = wasModal.current;
      if (exitingModal) closeDialog(node);
      wasModal.current = false;
      node.setAttribute('open', '');
      if (exitingModal) tabRefs.current.find(item => item?.getAttribute('aria-selected') === 'true')?.focus();
      return;
    }
    if (node.open && !wasModal.current) closeDialog(node);
    if (open && !node.open) {
      if (typeof node.showModal === 'function') {
        try { node.showModal(); } catch { node.setAttribute('open', ''); }
      } else node.setAttribute('open', '');
      wasModal.current = true;
    } else if (!open) {
      closeDialog(node);
      wasModal.current = false;
    }
  }, [mobile, open]);

  useEffect(() => {
    if (!mobile || !open) return undefined;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = returnFocus.current || document.activeElement;
    document.body.style.overflow = 'hidden';
    closeButton.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      const target = mobileRef.current ? previousFocus : tabRefs.current.find(node => node?.getAttribute('aria-selected') === 'true');
      if (target?.isConnected) target.focus();
      returnFocus.current = null;
    };
  }, [mobile, open]);

  function selectTab(index, focus = false) {
    setTab(tabs[index].key);
    if (focus) tabRefs.current[index]?.focus();
  }
  function tabKeys(event, index) {
    const target = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : event.key === 'ArrowRight' ? (index + 1) % 2 : event.key === 'ArrowLeft' ? (index + 1) % 2 : null;
    if (target === null) return;
    event.preventDefault();
    selectTab(target, true);
  }
  function showPanel() {
    returnFocus.current = document.activeElement;
    setOpen(true);
  }
  function modalKeys(event) {
    if (!mobile || !open) return;
    if (event.key === 'Escape') { event.preventDefault(); setOpen(false); return; }
    if (event.key !== 'Tab') return;
    const focusable = [...dialog.current.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex="0"]')].filter(node => !node.closest('[hidden]'));
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || !dialog.current.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }

  return <aside ref={anchor} className="activity-sidebar activity-application" id="application" aria-label="活动信息与报名">
    <dialog ref={dialog} className="activity-sidebar-dialog" role={mobile ? 'dialog' : 'region'} aria-modal={mobile && open ? 'true' : undefined} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); setOpen(false); }} onClose={() => { if (mobileRef.current) setOpen(false); }} onClick={event => { if (mobile && event.target === event.currentTarget) setOpen(false); }} onKeyDown={modalKeys}>
      <div className="activity-sidebar-panel">
        <header className="activity-sidebar-header">
          <div className="activity-sidebar-heading"><h2 id={titleId}>活动信息</h2><button ref={closeButton} className="activity-sidebar-close" type="button" aria-label="关闭活动信息" onClick={() => setOpen(false)}><X size={20} aria-hidden="true"/><span>关闭活动信息</span></button></div>
          <dl className="activity-sidebar-metrics"><div><dt><RouteIcon size={13} aria-hidden="true"/>里程</dt><dd>{metric(activity.distance, 'km', 2)}</dd></div><div><dt><Mountain size={13} aria-hidden="true"/>累计爬升</dt><dd>{metric(activity.ascent, 'm', 1)}</dd></div><div><dt><Compass size={13} aria-hidden="true"/>难度</dt><dd>{activity.difficulty || '待评估'}</dd></div></dl>
          <p className="activity-sidebar-when"><span>{activity.location || '地点待确认'}</span><time dateTime={Number.isFinite(scheduleInstant(activity.dateStart)) ? activity.dateStart : undefined}>{formatActivityTime(activity.dateStart)}</time></p>
        </header>
        <div className="activity-sidebar-tabs" role="tablist" aria-label="活动资料与报名详情">
          {tabs.map((item, index) => <button key={item.key} ref={node => { tabRefs.current[index] = node; }} type="button" role="tab" id={item.tabId} aria-controls={item.panelId} aria-selected={tab === item.key} tabIndex={tab === item.key ? 0 : -1} onClick={() => selectTab(index)} onKeyDown={event => tabKeys(event, index)}>{item.label}</button>)}
        </div>
        <div ref={scrolling} className="activity-sidebar-content" tabIndex={0} aria-label="可滚动的活动详情">
          <section role="tabpanel" id={tabs[0].panelId} aria-labelledby={tabs[0].tabId} hidden={tab !== 'information'}><dl className="activity-sidebar-information"><div><dt>活动地点</dt><dd>{activity.location || '待确认'}</dd></div><ActivityScheduleDetails activity={activity}/><div><dt>组织与保障</dt><dd>正式发布时公布</dd></div><div><dt>活动费用</dt><dd>{formatRegistrationFee(activity.registrationFeeCents)}</dd></div></dl><p className="activity-sidebar-note">{activity.isDemo ? '示例内容 · 请勿据此安排行程' : '以正式领队通知及最新安排为准'}</p></section>
          <section role="tabpanel" id={tabs[1].panelId} aria-labelledby={tabs[1].tabId} hidden={tab !== 'registration'}>{details}</section>
        </div>
        <footer className="activity-sidebar-footer" aria-busy={checking || undefined}><p className="application-registration-fee"><span>报名费用</span><strong>{formatRegistrationFee(activity.registrationFeeCents)}</strong></p>{summary}{detailsLabel && tab !== 'registration' && detailsLabel === '查看缴费提醒' && <button className="activity-sidebar-registration-link is-payment-reminder" type="button" onClick={() => selectTab(1, true)}>{detailsLabel}</button>}{actions}{detailsLabel && tab !== 'registration' && detailsLabel !== '查看缴费提醒' && <button className="activity-sidebar-registration-link" type="button" onClick={() => selectTab(1, true)}>{detailsLabel}</button>}</footer>
      </div>
    </dialog>
    <div className="activity-sidebar-mobile-bar"><span className="activity-sidebar-mobile-status" role="status">{shortLabel}</span><button ref={trigger} type="button" aria-haspopup="dialog" aria-expanded={mobile && open} onClick={showPanel}>活动信息与报名</button></div>
  </aside>;
}

export default function ActivitySidebar({ activity, localDraft = false }) {
  return <ActivityApplication activity={activity} localDraft={localDraft}>{slots => <SidebarPanel activity={activity} {...slots}/>}</ActivityApplication>;
}
