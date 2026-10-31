import {useEffect,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import {supabase} from '../backend.js';
import {readMemberProfile,saveMemberProfile,readMemberHistory} from './profile.js';
import {formatActivityTime} from '../activities/schedule.js';
import {paymentLabel} from '../payments/status.js';
import '../payments/payment-status.css';
import './member-settings.css';
const identityFailure = error => ['LOGIN_CHANGED', 'LOGIN_REQUIRED'].includes(error?.code);

export default function MemberSettings() {
 const [user,setUser]=useState(null),[profile,setProfile]=useState(null),[history,setHistory]=useState(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[refresh,setRefresh]=useState(0);
 const version=useRef(0),saving=useRef(false),invalidate=useRef(() => {});
 useEffect(() => {
  if (!supabase) { setLoading(false); return; }
  let alive = true, timer;
  function clear() {
   setUser(null); setProfile(null); setHistory(null); setError('');
   setNotice(''); setBusy(false); saving.current = false; setLoading(true);
  }
  function recheck() {
   version.current++;
   clear();
   clearTimeout(timer);
   timer = setTimeout(load, 0);
  }
  invalidate.current = recheck;
  async function load() {
   const current = ++version.current;
   clear();
   const active = () => alive && current === version.current;
   try {
    const session = await supabase.auth.getSession();
    if (session.error) throw new Error();
    if (!session.data?.session) return;
    const identity = await supabase.auth.getUser();
    if (identity.error || !identity.data?.user?.id || identity.data.user.is_anonymous) throw new Error();
    const id = identity.data.user.id;
    const [p,h] = await Promise.allSettled([readMemberProfile(supabase,id),readMemberHistory(supabase,id)]);
    if (!active()) return;
    if ([p,h].some(result => result.status === 'rejected' && identityFailure(result.reason))) {
     recheck();
     return;
    }
    setUser(identity.data.user);
    if (p.status === 'fulfilled') setProfile(p.value);
    if (h.status === 'fulfilled') setHistory(h.value);
    if (p.status === 'rejected' || h.status === 'rejected') setError('部分资料未能读取，请重新检查。');
   } catch {
    if (active()) setError('暂时无法确认登录或个人资料，请重试。');
   } finally {
    if (active()) setLoading(false);
   }
  }
  const {data:{subscription}} = supabase.auth.onAuthStateChange(recheck);
  load();
  return () => {
   alive = false; version.current++; invalidate.current = () => {};
   clearTimeout(timer); subscription.unsubscribe();
  };
 }, [refresh]);

 async function save(event) {
  event.preventDefault();
  if (!profile || !user || saving.current) return;
  const current = version.current;
  saving.current = true; setBusy(true); setError(''); setNotice('');
  try {
   const saved = await saveMemberProfile(supabase,profile,{expectedUserId:user.id});
   if (current === version.current) {
    setProfile(saved); setNotice('个人资料已保存。');
    window.dispatchEvent(new Event('member-profile-updated'));
   }
  } catch (caught) {
   if (current !== version.current) return;
   if (identityFailure(caught)) invalidate.current();
   else setError('资料未能保存，可能已在其他页面修改。请重新检查后重试。');
  } finally {
   if (current === version.current) { setBusy(false); saving.current = false; }
  }
 }
 return <section className="member-settings container"><header><h1>个人设置</h1><p>保存日常联系资料，查看本人的活动报名记录。</p></header>{loading?<p role="status">正在确认个人资料…</p>:!user?<p>{error||'请先登录，查看本人的个人设置。'} <Link to="/login?next=%2Fsettings">前往登录</Link></p>:<div className="member-settings-layout"><section><h2>账户资料</h2><p className="member-muted">真实姓名和手机号可不长期保存。这里的修改不会改写已确认的活动报名资料。</p>{profile&&<form onSubmit={save}>{[['username','用户名',40],['realName','真实姓名（选填）',80],['phone','个人手机号（选填）',11]].map(([name,label,maxLength])=><label key={name} className="member-field">{label}<input name={name} type={name==='phone'?'tel':'text'} maxLength={maxLength} value={profile[name]} disabled={busy} autoComplete="off" onChange={e=>setProfile({...profile,[name]:e.target.value})}/></label>)}<button type="submit" className="btn" disabled={busy}>{busy?'正在保存…':'保存个人资料'}</button></form>}{notice&&<p role="status">{notice}</p>}</section><section className="member-history"><h2>活动记录</h2><p className="member-muted">保留本人报名、退出、入选及缴费结果。</p>{history?.length===0&&<p>暂无活动记录。</p>}{history?.map(item=><article key={item.activityId}><h3>{item.title||'历史活动'}</h3><p>{formatActivityTime(item.dateStart)} — {formatActivityTime(item.dateEnd)}</p><p>{item.status==='withdrawn'?'已退出':item.selectionStatus==='confirmed'?'入选':item.selectionStatus==='waitlisted'?'候补':'报名已记录'} · <span className={`payment-status payment-status-${item.paymentStatus}`}>{paymentLabel(item.paymentStatus)}</span> · {item.insuranceStatus==='insured'?'保险已购买':'保险未购买'}</p><small>报名时间：{formatActivityTime(item.registeredAt)}</small></article>)}</section></div>}{error&&user&&<p role="alert" className="member-error">{error}</p>}{!loading&&<button className="member-refresh" type="button" disabled={busy} onClick={()=>setRefresh(v=>v+1)}>重新检查</button>}</section>;
}
