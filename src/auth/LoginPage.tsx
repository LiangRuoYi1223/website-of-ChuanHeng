import { useState, type FormEvent } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, ChevronLeft, Eye, EyeOff } from 'lucide-react';
import { useAuth } from './AuthContext';
import { useSiteStatus } from './SiteStatusContext';
import { canManageContent, canViewMemberActivities } from './permissions';
import { usePageTitle } from '../components';

function safeRedirect(value: string | null): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\r\n]/.test(value)) return null;
  const path = value.split(/[?#]/)[0];
  if (path === '/login' || path === '/account') return null;
  return value;
}
export default function LoginPage() {
  usePageTitle('登录');
  const { user, checking, error: connectionError, login } = useAuth();
  const { status } = useSiteStatus();
  const paused = status?.paused === true;
  const [params] = useSearchParams();
  const [username, setUsername] = useState(''), [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const requested = safeRedirect(params.get('redirect'));
  const membershipRequired = params.get('membership') === 'required';
  if (!checking && user && (!paused || canManageContent(user)) && (!membershipRequired || canViewMemberActivities(user))) {
    const destination = user.mustChangePassword ? '/account' : paused ? '/admin' : requested?.startsWith('/admin') && !canManageContent(user) ? '/account' : requested || (canManageContent(user) ? '/admin' : '/account');
    return <Navigate to={destination} replace/>;
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setError('');
    try {
      const nextUser = await login(username.trim(), password); setPassword('');
      if (membershipRequired && !canViewMemberActivities(nextUser)) setError('该账号是浏览者，请使用社员账号登录。');
    }
    catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="auth-page container"><Link to="/" className="auth-back"><ChevronLeft size={16}/>返回活动与足迹</Link>
    <div className="auth-layout"><section className="auth-login-section" aria-labelledby="login-title">
      <h1 id="login-title">登录川衡。</h1><p className="auth-intro">{paused ? '网站暂停服务，管理员可登录维护。' : '回到你的账号，继续下一次出发。'}</p>
      {membershipRequired && !paused && <p className="auth-alert membership-login-notice" role="alert">你不是社员，请登录</p>}
      <form className="auth-form" onSubmit={submit} aria-busy={busy}>
        <label>账号<input name="username" autoComplete="username" required minLength={3} maxLength={40} autoCapitalize="none" spellCheck={false} value={username} onChange={event => setUsername(event.target.value)} disabled={busy} placeholder="输入协会分配的账号"/></label>
        <label>密码<span className="auth-password-input"><input name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required maxLength={128} value={password} onChange={event => setPassword(event.target.value)} disabled={busy}/><button type="button" aria-label={showPassword ? '隐藏密码' : '显示密码'} aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={18}/> : <Eye size={18}/>}</button></span></label>
        {(error || connectionError) && <p className="auth-alert" role="alert">{error || connectionError}</p>}
        <button className="button button-green auth-submit" type="submit" disabled={busy || checking}>{busy ? '正在登录…' : checking ? '正在连接…' : '登录'}<ArrowRight size={18}/></button>
      </form><p className="auth-login-help">还没有账号或忘记密码？请联系协会管理员分配账号或重置密码。</p>
      <Link to="/" className="text-link">{paused ? '返回服务提示页' : '以浏览者身份继续浏览'} <ArrowRight size={16}/></Link>
    </section></div>
  </div>;
}
