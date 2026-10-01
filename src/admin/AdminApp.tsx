import { useEffect, useState, type FormEvent } from 'react';
import { useBlocker } from 'react-router-dom';
import { ArrowUpRight, Mountain, LogOut, LayoutDashboard, CalendarDays, Users, Settings, KeyRound, Flag, RefreshCw } from 'lucide-react';
import { api, ApiError } from '../api';
import type { PublicContent, User } from '../types';
import { AdminSettings } from './AdminSettings';
import { AdminUsers } from './AdminUsers';
import { Records } from './Records';
import './admin.css';

type View = 'overview' | 'activities' | 'projects' | 'settings' | 'users' | 'password';
function hasUnsaved() { return !!document.querySelector('.admin-app form[data-dirty="true"]'); }

function PasswordForm({ user, onSaved }: { user: User; onSaved: (user: User) => void }) {
  const [currentPassword, setCurrent] = useState(''), [newPassword, setNext] = useState(''), [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault(); setError('');
    if (newPassword !== confirmation) { setError('两次输入的新密码不一致。'); return; }
    setBusy(true);
    try { const result = await api<{user:User}>('/auth/password', { method:'POST', body:JSON.stringify({currentPassword,newPassword}) }); setCurrent('');setNext('');setConfirmation('');onSaved(result.user); }
    catch(e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section className="admin-panel"><h2>{user.mustChangePassword ? '设置你的新密码' : '修改个人密码'}</h2><p className="admin-help">{user.mustChangePassword ? '当前使用的是临时密码，修改后即可开始维护内容。' : '修改后，其他设备上的登录会失效。'}</p><form className="admin-form" onSubmit={submit} data-dirty={!!(currentPassword||newPassword||confirmation)}><label className="admin-field">当前密码<input type="password" autoComplete="current-password" required value={currentPassword} onChange={e=>setCurrent(e.target.value)}/></label><label className="admin-field">新密码<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={newPassword} onChange={e=>setNext(e.target.value)}/><small>12–128 个字符，建议使用长度足够的独立密码。</small></label><label className="admin-field">确认新密码<input type="password" autoComplete="new-password" required minLength={12} value={confirmation} onChange={e=>setConfirmation(e.target.value)}/></label>{error&&<p role="alert" className="admin-alert">{error}</p>}<button className="admin-button admin-primary" disabled={busy}>{busy?'正在保存…':'保存新密码'}</button></form></section>;
}

export default function AdminApp() {
  const [user,setUser]=useState<User|null>(null),[checking,setChecking]=useState(true),[content,setContent]=useState<PublicContent|null>(null);
  const [view,setView]=useState<View>('overview'),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const [username,setUsername]=useState(''),[password,setPassword]=useState('');
  const blocker=useBlocker(({currentLocation,nextLocation})=>currentLocation.pathname!==nextLocation.pathname&&hasUnsaved());
  useEffect(()=>{if(blocker.state==='blocked'){if(confirm('有未保存的修改，是否离开并放弃这些修改？'))blocker.proceed();else blocker.reset();}},[blocker]);
  useEffect(()=>{ document.title='内容管理 · 川衡登山协会'; api<{user:User|null}>('/auth/me').then(r=>setUser(r.user)).catch(e=>setError(e.message)).finally(()=>setChecking(false)); },[]);
  async function load() { setError('');try {setContent(await api<PublicContent>('/admin/content'));}catch(e){if(e instanceof ApiError && e.status===401)setUser(null);setError((e as Error).message);} }
  useEffect(()=>{ if(user&&!user.mustChangePassword)void load(); },[user?.id,user?.mustChangePassword]);
  useEffect(()=>{ const prevent=(e:BeforeUnloadEvent)=>{if(hasUnsaved()){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',prevent);return()=>window.removeEventListener('beforeunload',prevent);},[]);
  useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),6000);return()=>clearTimeout(timer);},[notice]);
  function changeView(next:View) { if(next===view)return;if(hasUnsaved()&&!confirm('有未保存的修改，是否离开并放弃这些修改？'))return;setView(next);setError(''); }
  async function login(event:FormEvent) {event.preventDefault();setError('');setBusy(true);try{const r=await api<{user:User}>('/auth/login',{method:'POST',body:JSON.stringify({username,password})});setUser(r.user);setPassword('');setView('overview');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function logout() {if(hasUnsaved()&&!confirm('有未保存的修改，仍要退出吗？'))return;try{await api('/auth/logout',{method:'POST'});setUser(null);setContent(null);setError('');}catch(e){setError((e as Error).message);}}
  function saved(next:PublicContent) {setContent(next);setNotice('内容已保存。已发布的内容会显示在前台。');}
  if(checking)return <div className="admin-app admin-login"><Mountain size={40}/><p>正在检查登录状态…</p></div>;
  if(!user)return <div className="admin-app admin-login"><div className="admin-login-card"><div className="admin-brand"><Mountain size={32}/><div><strong>川衡 · 内容管理</strong><small>让每一次出发被看见</small></div></div><h1>欢迎回来。</h1><p className="admin-help">使用协会管理员分配的账号登录。</p><form className="admin-form" onSubmit={login}><label className="admin-field">账号<input autoComplete="username" required value={username} onChange={e=>setUsername(e.target.value)}/></label><label className="admin-field">密码<input type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)}/></label>{error&&<p role="alert" className="admin-alert">{error}</p>}<button className="admin-button admin-primary" disabled={busy}>{busy?'正在登录…':'登录内容管理'}</button></form><a className="admin-back" href="/">返回网站 <ArrowUpRight size={16}/></a></div></div>;
  const nav=[{key:'overview' as const,label:'概览',icon:LayoutDashboard},{key:'activities' as const,label:'活动管理',icon:CalendarDays},{key:'projects' as const,label:'攀登项目',icon:Flag},{key:'settings' as const,label:'协会设置',icon:Settings},...(user.role==='admin'?[{key:'users' as const,label:'维护者账号',icon:Users}]:[]),{key:'password' as const,label:'个人密码',icon:KeyRound}];
  const effectiveView=user.mustChangePassword?'password':view;
  return <div className="admin-app"><div className="admin-shell"><aside className="admin-sidebar"><div className="admin-brand"><Mountain size={30}/><div><strong>川衡登山协会</strong><small>内容管理</small></div></div><nav aria-label="后台导航">{nav.map(item=><button className="admin-nav-item" data-active={effectiveView===item.key} key={item.key} disabled={user.mustChangePassword&&item.key!=='password'} onClick={()=>changeView(item.key)}><item.icon size={19}/>{item.label}</button>)}</nav><div className="admin-user"><strong>{user.displayName}</strong><small>{user.role==='admin'?'管理员':'内容维护者'}</small><button className="admin-button admin-secondary" onClick={logout}><LogOut size={16}/>退出登录</button></div></aside><div className="admin-main"><header className="admin-topbar"><div><span>CHUANHENG CMS</span><h1>{nav.find(n=>n.key===effectiveView)?.label}</h1></div><a className="admin-button admin-secondary" href="/" onClick={e=>{if(hasUnsaved()&&!confirm('有未保存的修改，是否返回网站？'))e.preventDefault();}}>查看网站 <ArrowUpRight size={16}/></a></header><div className="admin-content">{error&&<div className="admin-alert" role="alert">{error}<button className="admin-icon-button" aria-label="关闭错误提示" onClick={()=>setError('')}>×</button></div>}{notice&&<div className="admin-alert admin-success" role="status">{notice}</div>}{user.mustChangePassword&&<div className="admin-password-banner">首次登录或密码重置后，需要先修改临时密码。</div>}
      {effectiveView==='password'?<PasswordForm user={user} onSaved={next=>{setUser(next);setNotice('密码已更新。');if(user.mustChangePassword)setView('overview');}}/>:!content?<section className="admin-panel"><p>{error?'暂时无法加载内容。':'正在加载内容…'}</p><button className="admin-button admin-secondary" onClick={load}><RefreshCw size={16}/>重新加载</button></section>:<>
      {effectiveView==='overview'&&<><div className="admin-stat-grid">{[{title:'公开活动',value:content.activities.filter(a=>a.status==='published').length},{title:'草稿内容',value:[...content.activities,...content.projects].filter(a=>a.status==='draft').length},{title:'攀登项目',value:content.projects.length}].map(stat=><div className="admin-stat" key={stat.title}><span>{stat.title}</span><strong>{stat.value}</strong></div>)}</div><section className="admin-panel"><h2>下一次出发，从这里开始。</h2><p className="admin-help">发布活动预告、记录同行足迹，或为登山队新增攀登计划。草稿仅维护者可见。</p><div className="admin-actions"><button className="admin-button admin-primary" onClick={()=>changeView('activities')}>维护活动</button><button className="admin-button admin-secondary" onClick={()=>changeView('projects')}>添加攀登计划</button><button className="admin-button admin-secondary" onClick={()=>changeView('settings')}>替换素材与报名入口</button></div></section><section className="admin-panel"><h2>准备正式发布</h2><p className="admin-help">演示图与示例活动可逐步替换。请补齐公众号链接或二维码、合作联系方式，并核对活动日期与参与要求。</p><ul className="admin-checklist"><li>公众号入口：{content.settings.officialSignupUrl||content.settings.officialQrImage?'已配置':'待补充'}</li><li>合作联系方式：{content.settings.contactEmail||content.settings.contactWechat?'已配置':'待补充'}</li><li>影像演示标注：{content.settings.demoMode===false?'已关闭':'已开启'}</li></ul></section></>}
      {(effectiveView==='activities'||effectiveView==='projects')&&<Records key={effectiveView} kind={effectiveView} content={content} onSaved={saved} onError={setError} onReload={load}/>}
      {effectiveView==='settings'&&<AdminSettings settings={content.settings} onSaved={settings=>saved({...content,settings})} onError={setError}/>}
      {effectiveView==='users'&&user.role==='admin'&&<AdminUsers currentUser={user} onError={setError}/>}
      </>}</div></div></div></div>;
}
