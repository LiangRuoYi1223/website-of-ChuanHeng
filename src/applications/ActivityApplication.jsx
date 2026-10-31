import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, LoaderCircle } from 'lucide-react';
import { supabase } from '../backend.js';
import { readOwnApplication, registrationAvailability, submitActivityApplication } from './registration.js';
import './application.css';

export default function ActivityApplication({ activity, localDraft = false }) {
  const record = { ...activity, localDraft: localDraft || activity?.localDraft };
  const [clock, setClock] = useState(Date.now());
  const availability = registrationAvailability(record, clock);
  const [checking, setChecking] = useState(Boolean(supabase && availability.isPublic));
  const [busy, setBusy] = useState(false);
  const [user, setUser] = useState(null);
  const [application, setApplication] = useState(null);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const authRevision = useRef(0);

  useEffect(() => {
    if (!availability.open) return undefined;
    const timer = window.setInterval(() => setClock(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, [availability.open]);

  useEffect(() => {
    if (!supabase || !availability.isPublic) { setChecking(false); return undefined; }
    let alive = true, revision = 0, timer;
    async function check() {
      const current = ++revision;
      const active = () => alive && current === revision;
      if (active()) { setChecking(true); setError(''); setUser(null); setApplication(null); }
      try {
        const { data: session, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        if (!session?.session) { if (active()) { setUser(null); setApplication(null); } return; }
        const { data: identity, error: identityError } = await supabase.auth.getUser();
        if (identityError) throw identityError;
        const verified = identity?.user;
        if (!verified?.id || verified.is_anonymous === true) { if (active()) { setUser(null); setApplication(null); } return; }
        const existing = await readOwnApplication(supabase, activity.id, verified.id);
        if (active()) { setUser(verified); setApplication(existing ? { ...existing, activityId: activity.id } : null); }
      } catch {
        if (active()) setError('暂时无法确认账号与报名记录，请重试后再提交。');
      } finally { if (active()) setChecking(false); }
    }
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      if (!alive) return;
      revision++; authRevision.current++;
      setBusy(false); setChecking(true); setUser(null); setApplication(null);
      window.clearTimeout(timer); timer = window.setTimeout(check, 0);
    });
    check();
    return () => { alive = false; revision++; authRevision.current++; window.clearTimeout(timer); subscription.unsubscribe(); };
  }, [activity?.id, availability.isPublic, refresh]);

  async function submit(event) {
    event.preventDefault();
    if (busy || checking || application?.activityId === activity?.id) return;
    const current = authRevision.current;
    setError(''); setBusy(true);
    try {
      const saved = await submitActivityApplication(supabase, record, { expectedUserId: user?.id });
      if (current === authRevision.current) setApplication({ ...saved, activityId: activity.id });
    } catch (caught) {
      if (current !== authRevision.current) return;
      setError(caught.message || '报名未完成，请稍后重试。');
      if (caught.code === 'LOGIN_REQUIRED') { setUser(null); setApplication(null); }
    } finally { if (current === authRevision.current) { setBusy(false); setClock(Date.now()); } }
  }

  const returnPath = `/activities/${encodeURIComponent(activity?.id || '')}#application`;
  return <section className="activity-application" id="application" aria-label="活动报名"><h3>活动报名</h3>{!availability.isPublic ? <p className="application-closed">{availability.reason}</p> : !supabase ? <p className="application-error" role="status">报名服务暂时不可用，请稍后重试。</p> : checking ? <p className="application-checking" role="status"><LoaderCircle size={15} aria-hidden="true" />正在确认账号与报名记录…</p> : application?.activityId === activity?.id ? <div className="application-confirmed" role="status"><CheckCircle2 size={21} aria-hidden="true" /><div><strong>报名申请已提交</strong><p>申请已记录，参与安排以协会后续通知为准。</p></div></div> : <>{!availability.open && <p className="application-closed">{availability.reason}</p>}{availability.open && !user && !error && <><p>登录后可使用当前账号提交申请。</p><Link className="btn application-action" to={`/login?next=${encodeURIComponent(returnPath)}`}>登录后报名<ArrowRight size={15} /></Link></>}{availability.open && user && !error && <form onSubmit={submit}><p>使用当前登录账号提交申请，参与安排以正式通知为准。</p>{user.email && <span className="application-account">当前账号：{user.email}</span>}<button className="btn application-action" type="submit" disabled={busy}>{busy ? '正在提交…' : '确认提交报名申请'}<ArrowRight size={15} aria-hidden="true" /></button></form>}</>}{error && <div className="application-error" role="alert"><p>{error}</p><button type="button" onClick={() => setRefresh(value => value + 1)} disabled={busy || checking}>重新检查</button></div>}<small className="application-private-note">报名记录仅对本人及协会管理员可见。</small></section>;
}
