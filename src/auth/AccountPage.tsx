import { activityCity, activityRoute } from '../features/activity-location';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { ArrowUpRight, ChevronLeft, LogOut, ShieldCheck } from 'lucide-react';
import { useAuth } from './AuthContext';
import { canManageContent, canRegister, permissionLabels, roleDescriptions, roleLabels } from './permissions';
import type { ContentPermission, Registration, User } from '../types';
import { api } from '../api';
import { useContent } from '../App';
import { usePageTitle } from '../components';
import RoleOverview from './RoleOverview';

function PersonalPassword({ user, onSaved }: { user: User; onSaved: (user: User) => void }) {
  const [currentPassword, setCurrent] = useState(''), [newPassword, setNext] = useState(''), [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return; setError(''); setSaved(false);
    if (newPassword !== confirmation) { setError('两次输入的新密码不一致，请重新确认。'); return; }
    setBusy(true);
    try {
      const result = await api<{ user: User }>('/auth/password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });
      setCurrent(''); setNext(''); setConfirmation(''); setSaved(true); onSaved(result.user);
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="account-section"><h2>{user.mustChangePassword ? '先设置你的新密码' : '个人密码'}</h2><p>{user.mustChangePassword ? '你正在使用临时密码，修改后即可使用账号功能。' : '修改密码后，其他设备上的登录会失效。'}</p>
    <form className="auth-form account-password-form" onSubmit={submit}>
      <label>当前密码<input type="password" autoComplete="current-password" required maxLength={128} disabled={busy} value={currentPassword} onChange={e => setCurrent(e.target.value)}/></label>
      <label>新密码<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} disabled={busy} value={newPassword} onChange={e => setNext(e.target.value)}/><small>12–128 个字符，建议使用独立的长密码。</small></label>
      <label>确认新密码<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} disabled={busy} value={confirmation} onChange={e => setConfirmation(e.target.value)}/></label>
      {error && <p className="auth-alert" role="alert">{error}</p>}{saved && <p className="auth-success" role="status">密码已更新，可以继续使用账号。</p>}
      <button className="button button-green" disabled={busy}>{busy ? '正在保存…' : '保存新密码'}</button>
    </form>
  </section>;
}
export default function AccountPage() {
  usePageTitle('个人页面');
  const { user, checking, setUser, logout } = useAuth();
  const { activities } = useContent();
  const [registrations, setRegistrations] = useState<Registration[]>([]), [loading, setLoading] = useState(false);
  const [error, setError] = useState(''), [busy, setBusy] = useState('');
  const eligible = canRegister(user);
  const scope = `${user?.id ?? ''}:${user?.role ?? ''}:${user?.mustChangePassword ?? ''}`;
  const latestScope = useRef(scope); latestScope.current = scope;
  const loadVersion = useRef(0);
  async function load() {
    const requestScope = scope, version = ++loadVersion.current;
    setLoading(true); setError('');
    try {
      const result = await api<{ registrations: Registration[] }>('/registrations');
      if (latestScope.current === requestScope && version === loadVersion.current) setRegistrations(result.registrations);
    } catch (failure) { if (latestScope.current === requestScope && version === loadVersion.current) setError((failure as Error).message); }
    finally { if (latestScope.current === requestScope && version === loadVersion.current) setLoading(false); }
  }
  useEffect(() => {
    setRegistrations([]); setLoading(false); setBusy(''); setError(''); if (eligible) void load();
    return () => { loadVersion.current++; };
  }, [scope]);
  async function cancel(activityId: string) {
    const requestScope = scope;
    setBusy(activityId); setError('');
    try {
      await api(`/registrations/${encodeURIComponent(activityId)}`, { method: 'DELETE' });
      if (latestScope.current === requestScope) setRegistrations(current => current.filter(item => item.activityId !== activityId));
    } catch (failure) { if (latestScope.current === requestScope) setError((failure as Error).message); }
    finally { if (latestScope.current === requestScope) setBusy(''); }
  }
  async function signOut() {
    setBusy('logout'); setError('');
    try { await logout(); } catch (failure) { setError((failure as Error).message); } finally { setBusy(''); }
  }
  if (checking) return <div className="auth-loading" role="status">正在检查登录状态…</div>;
  if (!user) return <Navigate to="/login?redirect=/account" replace/>;
  return <div className="auth-page account-page container"><Link to="/" className="auth-back"><ChevronLeft size={16}/>返回活动与足迹</Link>
    <header className="account-heading"><div><h1>{user.displayName}</h1><p>@{user.username} <span className="account-role"><ShieldCheck size={15}/>{roleLabels[user.role]}</span></p></div><button className="button button-outline" disabled={!!busy} onClick={signOut}><LogOut size={17}/>{busy === 'logout' ? '正在退出…' : '退出登录'}</button></header>
    <div className="account-layout"><div>
      <section className="account-section account-access"><h2>你的权限</h2><p>{roleDescriptions[user.role]}</p>
        {user.role === 'admin' && <p>{user.permissions.length ? `已授权：${user.permissions.map(key => permissionLabels[key as ContentPermission] || key).join('、')}。` : '暂未开放编辑接口。创始者授权后，相应编辑功能会显示在内容管理中。'}</p>}
        {canManageContent(user) && !user.mustChangePassword && <Link className="button button-green" to="/admin">进入内容管理 <ArrowUpRight size={17}/></Link>}
      </section>
      {user.mustChangePassword && <p className="auth-alert" role="status">首次登录或密码重置后，请先修改临时密码。</p>}
      {error && <p className="auth-alert" role="alert">{error}{eligible && <button className="text-link" onClick={load}>重新加载</button>}</p>}
      {eligible && <section className="account-section"><h2>我的活动报名</h2>{loading ? <p role="status">正在加载报名记录…</p> : registrations.length ? <ul className="registration-list">{registrations.map(item => {
        const activity = activities.find(value => value.id === item.activityId);
        return <li key={item.id}><div>{activity ? <Link to={`/activities/${activity.id}`}>{activity.title}<ArrowUpRight size={15}/></Link> : <strong>活动暂未公开</strong>}<small>{activity ? `${activity.date} · ${[activityCity(activity),activityRoute(activity)].filter(Boolean).join(' · ')}` : '原活动已下架，报名记录仍保留。'}</small></div><button className="text-link" disabled={!!busy} onClick={() => cancel(item.activityId)}>{busy === item.activityId ? '正在取消…' : '取消报名'}</button></li>;
      })}</ul> : <div className="account-empty"><p>还没有报名记录，选一次喜欢的出发吧。</p><Link className="text-link" to="/#calendar">浏览活动预告 <ArrowUpRight size={16}/></Link></div>}</section>}
      <PersonalPassword key={user.id} user={user} onSaved={next => { if (latestScope.current === scope) setUser(next); }}/>
    </div><RoleOverview currentRole={user.role}/></div>
  </div>;
}
