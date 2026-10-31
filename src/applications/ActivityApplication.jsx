import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, LoaderCircle } from 'lucide-react';
import { supabase } from '../backend.js';
import { readActivityRegistration, registrationAvailability, submitActivityApplication, withdrawActivityRegistration } from './registration.js';
import './application.css';

const labels = { confirmed: '入选', waitlisted: '候补', withdrawn: '已退出', unconfirmed: '名额尚未确认' };
export default function ActivityApplication({ activity, localDraft = false }) {
  const record = { ...activity, localDraft: localDraft || activity?.localDraft };
  const [clock, setClock] = useState(Date.now());
  const availability = registrationAvailability(record, clock);
  const [checking, setChecking] = useState(Boolean(supabase && availability.isPublic));
  const [busy, setBusy] = useState('');
  const [user, setUser] = useState(null);
  const [registration, setRegistration] = useState(null);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const authRevision = useRef(0);

  useEffect(() => {
    if (!availability.isPublic) return undefined;
    const timer = window.setInterval(() => { setClock(Date.now()); setRefresh(value => value + 1); }, 30000);
    return () => window.clearInterval(timer);
  }, [availability.isPublic]);

  useEffect(() => {
    if (!supabase || !availability.isPublic) { setChecking(false); return undefined; }
    let alive = true, revision = 0, timer;
    async function check() {
      const current = ++revision;
      const active = () => alive && current === revision;
      if (active()) { setChecking(true); setError(''); setUser(null); setRegistration(null); }
      try {
        const { data: session, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        if (!session?.session) return;
        const { data: identity, error: identityError } = await supabase.auth.getUser();
        if (identityError) throw identityError;
        const verified = identity?.user;
        if (!verified?.id || verified.is_anonymous === true) return;
        const state = await readActivityRegistration(supabase, activity.id, verified.id);
        if (active()) { setUser(verified); setRegistration({ ...state, activityId: activity.id }); }
      } catch {
        if (active()) setError('暂时无法确认账号与报名记录，请重试后再提交。');
      } finally { if (active()) setChecking(false); }
    }
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      if (!alive) return;
      revision++; authRevision.current++;
      setBusy(''); setChecking(true); setUser(null); setRegistration(null);
      window.clearTimeout(timer); timer = window.setTimeout(check, 0);
    });
    check();
    return () => { alive = false; revision++; authRevision.current++; window.clearTimeout(timer); subscription.unsubscribe(); };
  }, [activity?.id, availability.isPublic, refresh]);

  const state = registration?.activityId === activity?.id ? registration : null;
  const application = state?.application;
  const withdrawn = application?.status === 'withdrawn';
  async function mutate(action) {
    if (busy || checking || !user || (action === 'register' && application && !withdrawn)) return;
    const current = authRevision.current;
    setError(''); setBusy(action);
    try {
      const saved = action === 'withdraw'
        ? await withdrawActivityRegistration(supabase, activity.id, { expectedUserId: user.id })
        : await submitActivityApplication(supabase, record, { expectedUserId: user.id });
      if (current === authRevision.current) setRegistration({ ...saved, activityId: activity.id });
    } catch (caught) {
      if (current !== authRevision.current) return;
      setError(caught.message || '操作未完成，请重新检查后重试。');
      if (caught.code === 'LOGIN_REQUIRED' || caught.code === 'LOGIN_CHANGED') { setUser(null); setRegistration(null); setRefresh(value => value + 1); }
    } finally { if (current === authRevision.current) { setBusy(''); setClock(Date.now()); } }
  }

  const returnPath = `/activities/${encodeURIComponent(activity?.id || '')}#application`;
  const canWithdraw = state?.canWithdraw && application?.status === 'active' && new Date(activity.dateStart).getTime() > clock;
  return <section className="activity-application" id="application" aria-label="活动报名" aria-busy={checking || Boolean(busy)}>
    <h3>活动报名</h3>
    {!availability.isPublic ? <p className="application-closed">{availability.reason}</p> : !supabase ? <p className="application-error" role="status">报名服务暂时不可用，请稍后重试。</p> : checking ? <p className="application-checking" role="status"><LoaderCircle size={15} aria-hidden="true" />正在确认账号与报名记录…</p> : <>
      {application && <div className={`application-confirmed application-status-${application.selectionStatus}`} role="status"><CheckCircle2 size={21} aria-hidden="true" /><div>
        <strong>{withdrawn ? '已退出本次报名' : '报名申请已提交'}</strong>
        <div className="application-status-line"><span>{labels[application.selectionStatus]}</span><span>{application.paymentStatus === 'paid' ? '已缴费' : '未缴费'}</span></div>
        {!withdrawn && application.position !== null && state.capacity !== null && <p className="application-ranking"><span>当前排位 / 活动名额</span><b>{application.position}/{state.capacity}</b></p>}
        {application.selectionStatus === 'waitlisted' && <p>按报名顺序候补，前方人员退出后自动递补。请等候入选后再缴费。</p>}
        {application.selectionStatus === 'unconfirmed' && <p>活动名额尚未确认，现有报名记录已保留。</p>}
        {withdrawn && <p>退出记录与缴费状态保留。报名开放期间可重新报名，排在当前队尾；退款请联系管理员。</p>}
      </div></div>}
      {application?.selectionStatus === 'confirmed' && application.paymentStatus === 'unpaid' && <div className="application-payment-reminder" role="note"><strong>入选待缴费</strong><p>{activity.paymentInstructions || '请按活动通知完成缴费，联系管理员确认。'}</p><small>缴费状态由管理员确认后更新。</small></div>}
      {state && <p className="application-totals">有效报名 {state.activeCount} 人 · 入选 {state.confirmedCount} 人 · 候补 {state.waitlistCount} 人</p>}
      {canWithdraw && <><p>活动开始前可退出，退出后将由后续报名者递补。</p><button className="application-secondary-action" type="button" disabled={Boolean(busy) || Boolean(error)} onClick={() => mutate('withdraw')}>{busy === 'withdraw' ? '正在退出…' : '退出本次报名'}</button></>}
      {(!application || withdrawn) && <>
        {!availability.open && <p className="application-closed">{availability.reason}</p>}
        {availability.open && !user && !error && <><p>登录后可使用当前账号提交申请。</p><Link className="btn application-action" to={`/login?next=${encodeURIComponent(returnPath)}`}>登录后报名<ArrowRight size={15} /></Link></>}
        {availability.open && user && !error && <form onSubmit={event => { event.preventDefault(); mutate('register'); }}><p>{withdrawn ? '重新报名将按本次提交时间排到当前队尾。' : '按报名时间排序，名额内入选，其余候补。'}</p>{user.email && <span className="application-account">当前账号：{user.email}</span>}<button className="btn application-action" type="submit" disabled={Boolean(busy)}>{busy === 'register' ? '正在提交…' : withdrawn ? '重新报名' : '确认提交报名申请'}<ArrowRight size={15} aria-hidden="true" /></button></form>}
      </>}
      {state && <button className="application-refresh" type="button" disabled={Boolean(busy)} onClick={() => setRefresh(value => value + 1)}>刷新报名状态</button>}
    </>}
    {error && <div className="application-error" role="alert"><p>{error}</p><button type="button" onClick={() => setRefresh(value => value + 1)} disabled={Boolean(busy) || checking}>重新检查</button></div>}
    <small className="application-private-note">报名记录仅对本人及协会管理员可见。</small>
  </section>;
}
