import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowUpRight, UserRound } from 'lucide-react';
import { supabase } from '../backend.js';
import './public-session-navigation.css';
import {readMemberProfile} from '../members/profile.js';

// Display the existing site session; protected operations still verify on the server.
export default function PublicSessionNavigation({ mobile = false }) {
  const { pathname } = useLocation();
  const [auth, setAuth] = useState({ status: supabase ? 'checking' : 'anonymous', user: null });
  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    let version = 0;
    let timer;
    const verify = async current => {
      const update = value => { if (alive && current === version) setAuth(value); };
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (!data?.session) return update({ status: 'anonymous', user: null });
        const { data: verified, error: verificationError } = await supabase.auth.getUser();
        if (verificationError || !verified?.user) throw verificationError || new Error('Missing verified user');
        if(verified.user.is_anonymous) return update({status:'anonymous',user:null});
        update({ status: 'authenticated', user: verified.user, username: '' });
        try { const profile=await readMemberProfile(supabase,verified.user.id); update({status:'authenticated',user:verified.user,username:profile.username}); } catch { /* Profile failure does not invalidate a verified session. */ }
      } catch {
        update({ status: 'error', user: null });
      }
    };
    const recheck = () => {
      if (!alive) return;
      const current = ++version;
      clearTimeout(timer);
      setAuth({ status: 'checking', user: null });
      // Auth callbacks run under a lock: defer all further Auth requests.
      timer = setTimeout(() => verify(current), 0);
    };
    const { data: { subscription } } = supabase.auth.onAuthStateChange(event => {
      if (event !== 'SIGNED_OUT') return recheck();
      version++;
      clearTimeout(timer);
      setAuth({ status: 'anonymous', user: null });
    });
    const visible = () => { if (document.visibilityState === 'visible') recheck(); };
    window.addEventListener('member-profile-updated', recheck);
    window.addEventListener('pageshow', recheck);
    window.addEventListener('focus', recheck);
    document.addEventListener('visibilitychange', visible);
    recheck();
    return () => {
      alive = false; version++; clearTimeout(timer); subscription.unsubscribe();
      window.removeEventListener('member-profile-updated', recheck);
      window.removeEventListener('pageshow', recheck);
      window.removeEventListener('focus', recheck);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [pathname]);

  const className = mobile ? 'public-session-status' : 'login-link';
  const arrow = mobile ? <ArrowUpRight /> : null;
  if (auth.status === 'anonymous') return <Link to="/login" className={className}>登录 / 注册{arrow}</Link>;
  if (auth.status === 'error') return <Link to="/login" className={className} title="无法确认登录状态，请检查网络或重新登录">登录状态待确认{arrow}</Link>;
  if (auth.status === 'checking') return <span className={className} role="status">正在确认登录…</span>;
  return <span className={mobile ? 'public-session-member public-session-member-mobile' : 'public-session-member'}><Link to="/settings" className={`${className} public-session-username`} title={auth.username ? `已登录：${auth.username}，打开个人设置` : '已登录，打开个人设置以设置用户名'}><UserRound size={15} aria-hidden="true"/><span className="public-session-name">{auth.username || '已登录'}</span>{arrow}</Link>{auth.user.app_metadata?.role === 'admin' && <Link to="/admin" className={className} target="_blank" rel="noopener noreferrer" title="在新标签页打开管理后台">管理后台{arrow}</Link>}</span>;
}
