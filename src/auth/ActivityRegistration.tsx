import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, ExternalLink } from 'lucide-react';
import type { Activity, Registration } from '../types';
import { useAuth } from './AuthContext';
import { api } from '../api';
import { canRegister, roleLabels } from './permissions';

function currentDay() {
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)?.value).join('-');
}
export default function ActivityRegistration({ activity }: { activity: Activity }) {
  const { user, checking } = useAuth();
  const [registered, setRegistered] = useState(false), [loading, setLoading] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const eligible = canRegister(user);
  const scope = `${activity.id}:${user?.id ?? ''}:${user?.role ?? ''}:${user?.mustChangePassword ?? ''}`;
  const latestScope = useRef(scope); latestScope.current = scope;
  const available = activity.registrationOpen === true && !activity.isDemo && activity.status === 'published' && activity.kind === 'upcoming' && activity.date >= currentDay();
  const loginUrl = `/login?redirect=${encodeURIComponent(`/activities/${activity.id}#activity-plan`)}`;
  useEffect(() => {
    let current = true; setRegistered(false); setError(''); setNotice(''); setBusy(false); setLoading(eligible);
    if (eligible) api<{ registrations: Registration[] }>('/registrations').then(result => {
      if (current) setRegistered(result.registrations.some(item => item.activityId === activity.id));
    }).catch(failure => { if (current) setError((failure as Error).message); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [activity.id, user?.id, user?.role, user?.mustChangePassword]);
  async function submit() {
    if (busy || !eligible || !available) return; setBusy(true); setError(''); setNotice('');
    const requestScope = scope;
    try {
      await api('/registrations', { method: 'POST', body: JSON.stringify({ activityId: activity.id }) });
      if (latestScope.current === requestScope) { setRegistered(true); setNotice('已报名，期待和你一起出发。'); }
    } catch (failure) { if (latestScope.current === requestScope) setError((failure as Error).message); }
    finally { if (latestScope.current === requestScope) setBusy(false); }
  }
  return <section className="activity-registration" aria-label="社员活动报名"><h3>一起出发，先留个位置。</h3>
    <p>{registered ? '你已报名本次活动，请留意协会发布的集合与出发通知。' : activity.isDemo ? '这是一场示例活动，暂不接受实际报名。' : !available ? '本次活动尚未开放报名或报名已结束。' : '报名已开放，社员登录后可提交报名。'}</p>
    {user && <div className="registration-identity">当前身份 <strong>{roleLabels[user.role]}</strong></div>}
    {checking || loading ? <p role="status">正在检查报名状态…</p> : user?.role === 'viewer' ? <p className="registration-restricted">浏览者可查看活动。报名需要社员身份，请联系协会管理员确认身份。</p> : user?.mustChangePassword ? <Link to="/account" className="button button-green">设置账号密码 <ArrowRight size={16}/></Link> : registered ? <><span className="registration-confirmed"><Check size={18}/>已报名</span><Link className="text-link" to="/account">查看我的报名 <ArrowRight size={16}/></Link></> : !user ? <Link className="button button-green" to={loginUrl}>登录社员账号 <ArrowRight size={16}/></Link> : <button className="button button-green" disabled={busy || !available} onClick={submit}>{busy ? '正在提交…' : available ? '报名参加活动' : '暂未开放报名'}<ArrowRight size={16}/></button>}
    {error && <p className="auth-alert" role="alert">{error}</p>}{notice && <p className="auth-success" role="status">{notice}</p>}
    {activity.signupUrl && <a className="text-link registration-announcement" href={activity.signupUrl} target="_blank" rel="noopener noreferrer">查看公众号活动通知 <ExternalLink size={15}/></a>}
  </section>;
}
