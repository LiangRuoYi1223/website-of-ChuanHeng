import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { supabase } from '../backend.js';
import './public-session-navigation.css';
import {readMemberProfile} from '../members/profile.js';

// Display the existing site session; protected operations still verify on the server.
export default function PublicSessionNavigation({ mobile = false }) {
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
    const { data: { subscription } } = supabase.auth.onAuthStateChange(event => {
      // Invalidate pending results immediately, including requests from a previous account.
      const current = ++version;
      clearTimeout(timer);
      setAuth({ status: event === 'SIGNED_OUT' ? 'anonymous' : 'checking', user: null });
      // Auth callbacks run under a lock: defer all further Auth requests.
      if (event !== 'SIGNED_OUT') timer = setTimeout(() => verify(current), 0);
    });
    const profileUpdated=()=>verify(++version);
    window.addEventListener('member-profile-updated',profileUpdated);
    verify(++version);
    return () => { alive = false; window.removeEventListener('member-profile-updated',profileUpdated); version++; clearTimeout(timer); subscription.unsubscribe(); };
  }, []);

  const className = mobile ? 'public-session-status' : 'login-link';
  const arrow = mobile ? <ArrowUpRight /> : null;
  if (auth.status === 'anonymous') return <Link to="/login" className={className}>登录 / 注册{arrow}</Link>;
  if (auth.status === 'error') return <Link to="/login" className={className} title="无法确认登录状态，请检查网络或重新登录">登录状态待确认{arrow}</Link>;
  if (auth.status === 'checking') return <span className={className} role="status">正在确认登录…</span>;
  return <span className={mobile ? 'public-session-member public-session-member-mobile' : 'public-session-member'}><Link to="/settings" className={className}>{auth.username || '个人设置'}{arrow}</Link>{auth.user.app_metadata?.role === 'admin' && <Link to="/admin" className={className} target="_blank" rel="noopener noreferrer" title="在新标签页打开管理后台">管理后台{arrow}</Link>}</span>;
}
