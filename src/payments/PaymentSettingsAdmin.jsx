import {useEffect,useRef,useState} from 'react';
import {supabase} from '../backend.js';
import PaymentQrUpload from '../media/PaymentQrUpload.jsx';
import {readPaymentSettings,savePaymentSettings} from './settings.js';
import './payment-settings.css';

export default function PaymentSettingsAdmin({local=false}) {
  const [state,setState]=useState(null),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[uploading,setUploading]=useState(false),[dirty,setDirty]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[revision,setRevision]=useState(0);
  const generation=useRef(0),pending=useRef(false);
  useEffect(()=>{
    const current=++generation.current;let alive=true;
    setState(null);setDirty(false);setNotice('');setError('');setUploading(false);setSaving(false);pending.current=false;
    if(local || !supabase){setLoading(false);return()=>{alive=false;generation.current++;};}
    setLoading(true);
    readPaymentSettings(supabase).then(value=>{if(alive&&generation.current===current)setState(value);}).catch(caught=>{if(alive&&generation.current===current)setError(caught.message);}).finally(()=>{if(alive&&generation.current===current)setLoading(false);});
    const subscription=supabase.auth?.onAuthStateChange?.(event=>{if(event==='INITIAL_SESSION'||event==='TOKEN_REFRESHED')return;generation.current++;setState(null);setDirty(false);setSaving(false);setUploading(false);setLoading(false);setNotice('');setError('登录状态已变化，请重新加载全站收款码设置。');})?.data?.subscription;
    return()=>{alive=false;generation.current++;subscription?.unsubscribe();};
  },[local,revision]);
  async function submit(event){
    event.preventDefault();if(!state||loading||uploading||pending.current||!dirty)return;
    const current=generation.current;const wechatQrUrl=String(new FormData(event.currentTarget).get('paymentQrUrl')||'');
    pending.current=true;setSaving(true);setError('');setNotice('');
    try{const saved=await savePaymentSettings(supabase,{wechatQrUrl,expectedUpdatedAt:state.updatedAt,expectedUserId:state.viewerId});if(current===generation.current){setState(saved);setDirty(false);setNotice('全站微信收款码已保存，所有活动使用此设置。');}}
    catch(caught){if(current===generation.current)setError(caught.message);}
    finally{if(current===generation.current){pending.current=false;setSaving(false);}}
  }
  return <section className="admin-panel payment-settings-admin" aria-labelledby="payment-settings-title"><div className="payment-settings-heading"><div><h2 id="payment-settings-title">全站微信收款码</h2><p>所有活动共用此收款二维码。付款时提醒会员备注姓名，上传记录后由管理员核实。</p></div>{!local&&<button className="admin-btn" type="button" disabled={loading||saving||uploading} onClick={()=>setRevision(value=>value+1)}>重新加载收款码</button>}</div>
    {local||!supabase?<p className="payment-settings-note">全站收款码需要在正式云端后台设置。本地预览不会修改真实收款配置。</p>:<>
      {loading&&<p role="status">正在读取全站收款码…</p>}
      {error&&<p className="payment-settings-error" role="alert">{error}</p>}
      {notice&&<p className="payment-settings-notice" role="status">{notice}</p>}
      {state&&<form onSubmit={submit}><PaymentQrUpload key={`${state.updatedAt||'empty'}:${revision}`} initialValue={state.wechatQrUrl||''} onBusyChange={setUploading} onValueChange={()=>{setDirty(true);setNotice('');}} disabled={loading||saving}/><p className="payment-settings-note">请确认收款人和二维码正确后保存。更换或移除配置不会删除旧图片，修改记录由系统保留。</p>{state.updatedAt&&<p className="payment-settings-note">最后保存：{new Date(state.updatedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}（北京时间）</p>}<button type="submit" className="admin-btn primary" disabled={loading||saving||uploading||!dirty}>{uploading?'正在处理收款码…':saving?'正在保存…':'保存全站收款码'}</button></form>}
    </>}
  </section>;
}
