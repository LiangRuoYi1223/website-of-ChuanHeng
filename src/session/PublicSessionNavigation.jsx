import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowUpRight, UserRound } from 'lucide-react';
import { supabase } from '../backend.js';
import './public-session-navigation.css';
import {getPublicSession} from './public-session.js';

// Display the existing site session; protected operations still verify on the server.
export default function PublicSessionNavigation({ mobile = false }) {
  const { pathname } = useLocation();
  const [auth, setAuth] = useState(() => supabase ? getPublicSession(supabase).getSnapshot() : {status: 'anonymous', user: null});
  useEffect(() => {
    if (!supabase) return;
    const session = getPublicSession(supabase);
    const update = () => setAuth(session.getSnapshot());
    const unsubscribe = session.subscribe(update);
    update();
    const recheck = () => session.recover();
    const profileUpdated = () => session.refreshProfile();
    const visible = () => { if (document.visibilityState === 'visible') recheck(); };
    window.addEventListener('member-profile-updated', profileUpdated);
    window.addEventListener('pageshow', recheck);
    window.addEventListener('focus', recheck);
    document.addEventListener('visibilitychange', visible);
    return () => {
      unsubscribe();
      window.removeEventListener('member-profile-updated', profileUpdated);
      window.removeEventListener('pageshow', recheck);
      window.removeEventListener('focus', recheck);
      document.removeEventListener('visibilitychange', visible);
    };
  }, []);
  useEffect(() => { if (supabase) getPublicSession(supabase).recover(); }, [pathname]);

  const className = mobile ? 'public-session-status' : 'login-link';
  const arrow = mobile ? <ArrowUpRight /> : null;
  if (auth.status === 'anonymous') return <Link to="/login" className={className}>登录 / 注册{arrow}</Link>;
  if (auth.status === 'error') return <Link to="/login" className={className} title="无法确认登录状态，请检查网络或重新登录">登录状态待确认{arrow}</Link>;
  if (auth.status === 'checking') return <span className={className} role="status">正在确认登录…</span>;
  return <span className={mobile ? 'public-session-member public-session-member-mobile' : 'public-session-member'}><Link to="/settings" className={`${className} public-session-username`} title={auth.username ? `已登录：${auth.username}，打开个人设置` : '已登录，打开个人设置以设置用户名'}><UserRound size={15} aria-hidden="true"/><span className="public-session-name">{auth.username || '已登录'}</span>{arrow}</Link>{auth.user.app_metadata?.role === 'admin' && <Link to="/admin" className={className} target="_blank" rel="noopener noreferrer" title="在新标签页打开管理后台">管理后台{arrow}</Link>}</span>;
}
