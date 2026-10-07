import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Navigate, useBlocker } from 'react-router-dom';
import { ArrowUpRight, Mountain, LogOut, LayoutDashboard, CalendarDays, Users, Settings, KeyRound, Flag, RefreshCw, Power, X } from 'lucide-react';
import { api, ApiError } from '../api';
import { useAuth } from '../auth/AuthContext';
import { userRoleLabel, canManageContent, hasPermission } from '../auth/permissions';
import type { PublicContent, User } from '../types';
import { AdminSettings } from './AdminSettings';
import { AdminUsers } from './AdminUsers';
import { Records } from './Records';
import { SiteService } from './SiteService';
import './admin.css';

type View = 'overview' | 'activities' | 'projects' | 'settings' | 'users' | 'password' | 'service';
const modules = [
  { key: 'activities', permission: 'activities:write', label: '活动管理', action: '维护活动', icon: CalendarDays },
  { key: 'projects', permission: 'projects:write', label: '攀登项目', action: '维护攀登计划', icon: Flag },
  { key: 'settings', permission: 'settings:write', label: '协会设置', action: '修改网站设置', icon: Settings },
] as const;
function hasUnsaved() { return !!document.querySelector('.admin-app form[data-dirty="true"]'); }

function PasswordForm({ user, onSaved }: { user: User; onSaved: (user: User) => void }) {
  const [currentPassword, setCurrent] = useState(''), [newPassword, setNext] = useState(''), [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault(); setError('');
    if (newPassword !== confirmation) { setError('两次输入的新密码不一致。'); return; }
    setBusy(true);
    try {
      const result = await api<{ user: User }>('/auth/password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });
      setCurrent(''); setNext(''); setConfirmation(''); onSaved(result.user);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section className="admin-panel">
    <h2>{user.mustChangePassword ? '设置你的新密码' : '修改个人密码'}</h2>
    <p className="admin-help">{user.mustChangePassword ? '当前使用的是临时密码，修改后即可使用管理功能。' : '修改后，其他设备上的登录会失效。'}</p>
    <form className="admin-form" onSubmit={submit} data-dirty={!!(currentPassword || newPassword || confirmation)}>
      <label className="admin-field">当前密码<input type="password" autoComplete="current-password" required value={currentPassword} onChange={e => setCurrent(e.target.value)} /></label>
      <label className="admin-field">新密码<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={newPassword} onChange={e => setNext(e.target.value)} /><small>12–128 个字符，建议使用长度足够的独立密码。</small></label>
      <label className="admin-field">确认新密码<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={confirmation} onChange={e => setConfirmation(e.target.value)} /></label>
      {error && <p role="alert" className="admin-alert">{error}</p>}
      <button className="admin-button admin-primary" disabled={busy}>{busy ? '正在保存…' : '保存新密码'}</button>
    </form>
  </section>;
}

export default function AdminApp() {
  const { user, checking, setUser, refresh: refreshAuth, logout: authLogout } = useAuth();
  const userScope = user ? JSON.stringify([user.id, user.role, user.isPresident, Boolean(user.mustChangePassword)]) : 'guest';
  const [loadedContent, setLoadedContent] = useState<{ scope: string; data: PublicContent } | null>(null);
  const content = loadedContent?.scope === userScope ? loadedContent.data : null;
  function setContent(next: PublicContent | null) { setLoadedContent(next ? { scope: userScope, data: next } : null); }
  const [view, setView] = useState<View>('overview'), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const latestUserScope = useRef(userScope), contentRequest = useRef(0);
  latestUserScope.current = userScope;
  const blocker = useBlocker(({ currentLocation, nextLocation }) => currentLocation.pathname !== nextLocation.pathname && hasUnsaved());
  const grantedModules = modules;
  const permittedViews: View[] = ['overview', 'password', ...grantedModules.map(module => module.key), ...(user?.role === 'admin' ? ['users' as const] : []), ...(user?.role === 'admin' && user.isPresident ? ['service' as const] : [])];
  const effectiveView = user?.mustChangePassword ? 'password' : permittedViews.includes(view) ? view : 'overview';

  useEffect(() => {
    if (blocker.state === 'blocked') {
      if (confirm('有未保存的修改，是否离开并放弃这些修改？')) blocker.proceed();
      else blocker.reset();
    }
  }, [blocker]);
  useEffect(() => { document.title = '内容管理 · 川衡登山协会'; }, []);
  async function load() {
    const scope = userScope, request = ++contentRequest.current;
    setError('');
    try {
      const next = await api<PublicContent>('/admin/content');
      if (latestUserScope.current !== scope || contentRequest.current !== request) return;
      setContent(next);
    }
    catch (e) {
      if (latestUserScope.current !== scope || contentRequest.current !== request) return;
      if (e instanceof ApiError && e.status === 401) setContent(null);
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    setContent(null); setError('');
    if (user && canManageContent(user) && !user.mustChangePassword) void load();
    return () => { contentRequest.current++; };
  }, [userScope]);
  useEffect(() => {
    const prevent = (e: BeforeUnloadEvent) => { if (hasUnsaved()) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, []);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 6000); return () => clearTimeout(timer); }, [notice]);
  function changeView(next: View) {
    if (next === effectiveView || !permittedViews.includes(next)) return;
    if (hasUnsaved() && !confirm('有未保存的修改，是否离开并放弃这些修改？')) return;
    setView(next); setError('');
  }
  async function logout() {
    if (hasUnsaved() && !confirm('有未保存的修改，仍要退出吗？')) return;
    try { await authLogout(); setContent(null); setError(''); }
    catch (e) { setError((e as Error).message); }
  }
  function saved(next: PublicContent) { setContent(next); setNotice('内容已保存。已发布的内容会显示在前台。'); }
  if (checking) return <div className="admin-app admin-login"><Mountain size={40} /><p role="status">正在检查登录状态…</p></div>;
  if (!user) return <Navigate to="/login?redirect=%2Fadmin" replace />;
  if (!canManageContent(user)) return <Navigate to="/" replace />;
  const canUpload = hasPermission(user, 'uploads:write');
  const nav = [
    { key: 'overview' as const, label: '概览', icon: LayoutDashboard },
    ...grantedModules,
    { key: 'users' as const, label: '账号与权限', icon: Users },
    ...(user.isPresident ? [{ key: 'service' as const, label: '网站服务', icon: Power }] : []),
    { key: 'password' as const, label: '个人密码', icon: KeyRound },
  ];
  return <div className="admin-app"><div className="admin-shell">
    <aside className="admin-sidebar">
      <div className="admin-brand"><Mountain size={30} /><div><strong>川衡登山协会</strong><small>内容管理</small></div></div>
      <nav aria-label="后台导航">{nav.map(item => <button className="admin-nav-item" data-active={effectiveView === item.key} aria-current={effectiveView === item.key ? 'page' : undefined} key={item.key} disabled={user.mustChangePassword && item.key !== 'password'} onClick={() => changeView(item.key)}><item.icon size={19} />{item.label}</button>)}</nav>
      <div className="admin-user"><strong>{user.displayName}</strong><small>{userRoleLabel(user)}</small><button className="admin-button admin-secondary" onClick={() => void logout()}><LogOut size={16} />退出登录</button></div>
    </aside>
    <div className="admin-main">
      <header className="admin-topbar"><div><h1>{nav.find(n => n.key === effectiveView)?.label}</h1><p>{userRoleLabel(user)} · 可修改全站内容</p></div><a className="admin-button admin-secondary" href="/" onClick={e => { if (hasUnsaved() && !confirm('有未保存的修改，是否返回网站？')) e.preventDefault(); }}>查看网站 <ArrowUpRight size={16} /></a></header>
      <div className="admin-content">
        {error && <div className="admin-alert" role="alert">{error}<button className="admin-icon-button" aria-label="关闭错误提示" onClick={() => setError('')}><X size={18} /></button></div>}
        {notice && <div className="admin-alert admin-success" role="status">{notice}</div>}
        {user.mustChangePassword && <div className="admin-password-banner">首次登录或密码重置后，需要先修改临时密码。</div>}
        {effectiveView === 'password' && <PasswordForm user={user} onSaved={next => { setUser(next); setNotice('密码已更新。'); if (user.mustChangePassword) setView('overview'); }} />}
        {effectiveView === 'overview' && <>
          <section className="admin-panel"><h2>管理全站内容与账号</h2><p className="admin-help">管理员可以修改全部网站内容、上传素材，并管理管理员、社员和浏览者账号。</p>
            <div className="admin-actions">{grantedModules.map(module => <button key={module.key} className="admin-button admin-secondary" onClick={() => changeView(module.key)}><module.icon size={17} />{module.action}</button>)}<button className="admin-button admin-primary" onClick={() => changeView('users')}><Users size={17} />管理账号与身份</button></div>
          </section>
          {content && grantedModules.length > 0 && <div className="admin-stat-grid">{[
            ...(hasPermission(user, 'activities:write') ? [{ title: '公开活动', value: content.activities.filter(activity => activity.status === 'published').length }] : []),
            { title: '可编辑草稿', value: [...(hasPermission(user, 'activities:write') ? content.activities : []), ...(hasPermission(user, 'projects:write') ? content.projects : [])].filter(record => record.status === 'draft').length },
            ...(hasPermission(user, 'projects:write') ? [{ title: '攀登项目', value: content.projects.length }] : []),
          ].map(stat => <div className="admin-stat" key={stat.title}><span>{stat.title}</span><strong>{stat.value}</strong></div>)}</div>}
          <SiteService user={user} />
          {content && hasPermission(user, 'settings:write') && <section className="admin-panel"><h2>准备正式发布</h2><p className="admin-help">请补齐公众号入口与合作联系方式，并核对活动日期和参与要求。</p><ul className="admin-checklist"><li>公众号入口：{content.settings.officialSignupUrl || content.settings.officialQrImage ? '已配置' : '待补充'}</li><li>合作联系方式：{content.settings.contactEmail || content.settings.contactWechat ? '已配置' : '待补充'}</li><li>影像示意标注：{content.settings.demoMode === false ? '已关闭' : '已开启'}</li></ul></section>}
        </>}
        {effectiveView === 'users' && user.role === 'admin' && <AdminUsers currentUser={user} onError={setError} onUserSaved={next => { if (next.id === user.id) { setUser(next); void refreshAuth(); } }} />}
        {effectiveView === 'service' && user.isPresident && <SiteService user={user} />}
        {(effectiveView === 'activities' || effectiveView === 'projects' || effectiveView === 'settings') && (!content ? <section className="admin-panel"><p role="status">{error ? '暂时无法加载内容，请重新加载。' : '正在加载内容…'}</p><button className="admin-button admin-secondary" onClick={() => void load()}><RefreshCw size={16} />重新加载</button></section> : <>
          {(effectiveView === 'activities' || effectiveView === 'projects') && <Records key={effectiveView} kind={effectiveView} content={content} canUpload={canUpload} onSaved={saved} onError={setError} onReload={load} />}
          {effectiveView === 'settings' && <AdminSettings settings={content.settings} canUpload={canUpload} onSaved={settings => saved({ ...content, settings })} onError={setError} />}
        </>)}
      </div>
    </div>
  </div></div>;
}
