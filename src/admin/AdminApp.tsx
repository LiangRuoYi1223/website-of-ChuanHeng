import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Navigate, useBlocker } from 'react-router-dom';
import { ArrowUpRight, Mountain, LogOut, LayoutDashboard, CalendarDays, Users, Settings, KeyRound, Flag, RefreshCw, X } from 'lucide-react';
import { api, ApiError } from '../api';
import { useAuth } from '../auth/AuthContext';
import { roleLabels, roleDescriptions, canManageContent, hasPermission } from '../auth/permissions';
import type { PublicContent, User } from '../types';
import { AdminSettings } from './AdminSettings';
import { AdminUsers } from './AdminUsers';
import { Records } from './Records';
import './admin.css';

type View = 'overview' | 'activities' | 'projects' | 'settings' | 'users' | 'password';
const roles = ['founder', 'admin', 'member', 'viewer'] as const;
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
    <p className="admin-help">{user.mustChangePassword ? '当前使用的是临时密码，修改后即可使用已授权的功能。' : '修改后，其他设备上的登录会失效。'}</p>
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
  const { user, checking, setUser, logout: authLogout } = useAuth();
  const userScope = user ? JSON.stringify([user.id, user.role, user.permissions, Boolean(user.mustChangePassword)]) : 'guest';
  const [loadedContent, setLoadedContent] = useState<{ scope: string; data: PublicContent } | null>(null);
  const content = loadedContent?.scope === userScope ? loadedContent.data : null;
  function setContent(next: PublicContent | null) { setLoadedContent(next ? { scope: userScope, data: next } : null); }
  const [view, setView] = useState<View>('overview'), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const latestUserScope = useRef(userScope), contentRequest = useRef(0);
  latestUserScope.current = userScope;
  const blocker = useBlocker(({ currentLocation, nextLocation }) => currentLocation.pathname !== nextLocation.pathname && hasUnsaved());
  const grantedModules = modules.filter(module => hasPermission(user, module.permission));
  const permittedViews: View[] = ['overview', 'password', ...grantedModules.map(module => module.key), ...(user?.role === 'founder' ? ['users' as const] : [])];
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
    ...(user.role === 'founder' ? [{ key: 'users' as const, label: '账号与权限', icon: Users }] : []),
    { key: 'password' as const, label: '个人密码', icon: KeyRound },
  ];
  return <div className="admin-app"><div className="admin-shell">
    <aside className="admin-sidebar">
      <div className="admin-brand"><Mountain size={30} /><div><strong>川衡登山协会</strong><small>内容管理</small></div></div>
      <nav aria-label="后台导航">{nav.map(item => <button className="admin-nav-item" data-active={effectiveView === item.key} aria-current={effectiveView === item.key ? 'page' : undefined} key={item.key} disabled={user.mustChangePassword && item.key !== 'password'} onClick={() => changeView(item.key)}><item.icon size={19} />{item.label}</button>)}</nav>
      <div className="admin-user"><strong>{user.displayName}</strong><small>{roleLabels[user.role]}</small><button className="admin-button admin-secondary" onClick={() => void logout()}><LogOut size={16} />退出登录</button></div>
    </aside>
    <div className="admin-main">
      <header className="admin-topbar"><div><h1>{nav.find(n => n.key === effectiveView)?.label}</h1><p>{roleLabels[user.role]} · {user.role === 'founder' ? '可修改全站内容' : '仅开放已授权的管理接口'}</p></div><a className="admin-button admin-secondary" href="/" onClick={e => { if (hasUnsaved() && !confirm('有未保存的修改，是否返回网站？')) e.preventDefault(); }}>查看网站 <ArrowUpRight size={16} /></a></header>
      <div className="admin-content">
        {error && <div className="admin-alert" role="alert">{error}<button className="admin-icon-button" aria-label="关闭错误提示" onClick={() => setError('')}><X size={18} /></button></div>}
        {notice && <div className="admin-alert admin-success" role="status">{notice}</div>}
        {user.mustChangePassword && <div className="admin-password-banner">首次登录或密码重置后，需要先修改临时密码。</div>}
        {effectiveView === 'password' && <PasswordForm user={user} onSaved={next => { setUser(next); setNotice('密码已更新。'); if (user.mustChangePassword) setView('overview'); }} />}
        {effectiveView === 'overview' && <>
          <section className="admin-panel"><h2>{user.role === 'founder' ? '管理全站内容与权限' : '你的已授权接口'}</h2><p className="admin-help">{user.role === 'founder' ? '创始者可以修改网站全部部分，并为管理员开放具体内容接口。新增管理员默认没有内容修改权限。' : grantedModules.length ? '以下入口由创始者授权。你可以在授权范围内编辑、保存和发布内容。' : '当前尚未开放内容编辑接口。创始者授权后，对应管理入口会显示在侧栏。'}</p>
            {(grantedModules.length > 0 || user.role === 'founder') && <div className="admin-actions">{grantedModules.map(module => <button key={module.key} className="admin-button admin-secondary" onClick={() => changeView(module.key)}><module.icon size={17} />{module.action}</button>)}{user.role === 'founder' && <button className="admin-button admin-primary" onClick={() => changeView('users')}><Users size={17} />管理账号与授权</button>}</div>}
            <p className="admin-permission-note admin-help">图片上传：{canUpload ? '已开放，可在获授权的内容接口中使用。' : '尚未授权，可填写已有图片地址。'}</p>
          </section>
          {content && grantedModules.length > 0 && <div className="admin-stat-grid">{[
            ...(hasPermission(user, 'activities:write') ? [{ title: '公开活动', value: content.activities.filter(activity => activity.status === 'published').length }] : []),
            { title: '可编辑草稿', value: [...(hasPermission(user, 'activities:write') ? content.activities : []), ...(hasPermission(user, 'projects:write') ? content.projects : [])].filter(record => record.status === 'draft').length },
            ...(hasPermission(user, 'projects:write') ? [{ title: '攀登项目', value: content.projects.length }] : []),
          ].map(stat => <div className="admin-stat" key={stat.title}><span>{stat.title}</span><strong>{stat.value}</strong></div>)}</div>}
          <section className="admin-panel"><h2>四级权限</h2><div className="admin-table-wrap"><table className="admin-table admin-role-table"><thead><tr><th scope="col">身份</th><th scope="col">开放功能</th></tr></thead><tbody>{roles.map(role => <tr key={role} data-current={user.role === role}><th scope="row">{roleLabels[role]}{user.role === role && <span className="admin-status">当前身份</span>}</th><td>{roleDescriptions[role]}</td></tr>)}</tbody></table></div></section>
          {content && hasPermission(user, 'settings:write') && <section className="admin-panel"><h2>准备正式发布</h2><p className="admin-help">请补齐公众号入口与合作联系方式，并核对活动日期和参与要求。</p><ul className="admin-checklist"><li>公众号入口：{content.settings.officialSignupUrl || content.settings.officialQrImage ? '已配置' : '待补充'}</li><li>合作联系方式：{content.settings.contactEmail || content.settings.contactWechat ? '已配置' : '待补充'}</li><li>影像示意标注：{content.settings.demoMode === false ? '已关闭' : '已开启'}</li></ul></section>}
        </>}
        {effectiveView === 'users' && user.role === 'founder' && <AdminUsers currentUser={user} onError={setError} onUserSaved={next => { if (next.id === user.id) setUser(next); }} />}
        {(effectiveView === 'activities' || effectiveView === 'projects' || effectiveView === 'settings') && (!content ? <section className="admin-panel"><p role="status">{error ? '暂时无法加载内容，请重新加载。' : '正在加载内容…'}</p><button className="admin-button admin-secondary" onClick={() => void load()}><RefreshCw size={16} />重新加载</button></section> : <>
          {(effectiveView === 'activities' || effectiveView === 'projects') && <Records key={effectiveView} kind={effectiveView} content={content} canUpload={canUpload} onSaved={saved} onError={setError} onReload={load} />}
          {effectiveView === 'settings' && <AdminSettings settings={content.settings} canUpload={canUpload} onSaved={settings => saved({ ...content, settings })} onError={setError} />}
        </>)}
      </div>
    </div>
  </div></div>;
}
