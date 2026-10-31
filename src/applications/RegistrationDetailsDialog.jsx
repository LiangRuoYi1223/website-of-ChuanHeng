import {useEffect,useId,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {X} from 'lucide-react';
import {supabase} from '../backend.js';
import {readMemberProfile} from '../members/profile.js';
import {validateRegistrationDetails} from './registration.js';
import {formatActivityTime} from '../activities/schedule.js';
import '../members/member-settings.css';
const empty=()=>({realName:'',idNumber:'',phone:'',consent:false});
export default function RegistrationDetailsDialog({open,userId,activity,onClose,onSubmit,busy=false,supplement=false}) {
 const [form,setForm]=useState(empty),[loading,setLoading]=useState(true),[error,setError]=useState(''),[sending,setSending]=useState(false);
 const node=useRef(null),version=useRef(0),dirty=useRef(false),locked=useRef(false),title=useId();
 useEffect(()=>{
  const current=++version.current;setForm(empty());setError('');setLoading(true);setSending(false);locked.current=false;dirty.current=false;
  if(!open||!userId)return;
  let alive=true;const dialog=node.current,previous=document.activeElement;
  try{dialog.showModal();}catch{dialog.setAttribute('open','');}
  readMemberProfile(supabase,userId).then(profile=>{if(alive&&current===version.current&&!dirty.current)setForm({...empty(),realName:profile.realName,phone:profile.phone});}).catch(()=>{if(alive&&current===version.current)setError('个人资料未能读取，请手动填写本次活动资料。');}).finally(()=>{if(alive&&current===version.current){setLoading(false);dialog.querySelector('input')?.focus();}});
  return()=>{alive=false;version.current++;dialog.close?.();if(previous?.isConnected)previous.focus();};
 },[open,userId]);
 async function submit(event){event.preventDefault();if(loading||busy||locked.current)return;setError('');let value;try{value=validateRegistrationDetails(form);}catch(caught){setError(caught.message);return;}const current=version.current;locked.current=true;setSending(true);try{await onSubmit(value);}catch(caught){if(current===version.current)setError(caught.message||'资料未能保存，请重试。');}finally{if(current===version.current){locked.current=false;setSending(false);}}}
 function keydown(event){if(event.key==='Escape'){event.preventDefault();onClose();}if(event.key==='Tab'){const list=[...node.current.querySelectorAll('button:not(:disabled),input:not(:disabled)')],first=list[0],last=list.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}}
 if(!open||!userId)return null;
 const disabled=loading||busy||sending;
 return createPortal(<dialog ref={node} className="registration-details-dialog" aria-labelledby={title} onKeyDown={keydown} onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target===e.currentTarget)onClose();}}><div className="registration-details-panel"><header><h2 id={title}>{supplement?'补充 / 更正保险资料':'确认活动报名资料'}</h2><button type="button" aria-label="关闭报名资料窗口" onClick={onClose}><X size={22}/></button></header><form onSubmit={submit}>
 {loading&&<p role="status">正在读取个人资料…</p>}
 <p>身份证号收集用于社团帮社员统一购买保险；手机号收集用于活动中的紧急联系。</p>
 <p className="member-muted">{activity?.dateEnd?`本次资料保存至活动结束（${formatActivityTime(activity.dateEnd)}），结束后即关闭访问，并于最迟次日清理身份证号、活动手机号及缴费图片。`:'活动结束时间待确认，请关注管理员通知；结束后关闭访问并清理临时资料。'} 报名姓名和操作历史保留。个人设置中的手机号保留。</p>
 {[['realName','真实姓名','text',80],['idNumber','身份证号','text',18],['phone','本次活动手机号','tel',11]].map(([name,label,type,maxLength])=><label key={name} className="member-field">{label}<input name={name} type={type} maxLength={maxLength} autoComplete="off" required disabled={disabled} value={form[name]} onChange={e=>{dirty.current=true;setForm({...form,[name]:e.target.value});}}/></label>)}
 <p className="member-muted">仅检查号码格式，不代表真实身份核验。本次修改不会覆盖个人设置；身份证号不会存入个人设置。</p>
 <label className="member-consent"><input name="consent" type="checkbox" checked={form.consent} disabled={disabled} onChange={e=>setForm({...form,consent:e.target.checked})}/>我已阅读并同意上述资料用途与保存期限</label>
 {error&&<p role="alert" className="member-error">{error}</p>}
 <div className="member-form-actions"><button type="button" onClick={onClose}>取消</button><button className="btn" disabled={disabled} type="submit">{sending?'正在提交…':supplement?'确认保存活动资料':'确认提交报名'}</button></div>
 {supplement&&<small>补充资料保留原报名时间与排位，无需退出重报。</small>}
 </form></div></dialog>,document.body);
}
