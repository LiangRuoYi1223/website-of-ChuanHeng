import {useEffect,useId,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {X} from 'lucide-react';
import './payment.css';

const types=['image/jpeg','image/png','image/webp'];
export default function PaymentDialog({open,qrUrl='',onClose,onSubmit,busy=false}) {
  const [step,setStep]=useState('pay'),[file,setFile]=useState(null),[preview,setPreview]=useState(''),[error,setError]=useState(''),[submitting,setSubmitting]=useState(false),[qrBroken,setQrBroken]=useState(false);
  const dialog=useRef(null),closing=useRef(onClose),selection=useRef(null),generation=useRef(0),sending=useRef(false);
  closing.current=onClose;
  const titleId=useId(),inputId=useId();
  useEffect(()=>{setQrBroken(false);},[qrUrl]);
  useEffect(()=>{
    if(!open||!file){setPreview('');return undefined;}
    const url=URL.createObjectURL(file);setPreview(url);
    return()=>URL.revokeObjectURL(url);
  },[file,open]);
  useEffect(()=>{
    if(!open){setFile(null);return undefined;}
    const node=dialog.current,previous=document.activeElement;
    generation.current++;setStep('pay');setFile(null);setError('');setSubmitting(false);sending.current=false;
    try {if(typeof node.showModal==='function')node.showModal();else node.setAttribute('open','');}catch{node.setAttribute('open','');}
    node.querySelector('button')?.focus();
    return()=>{generation.current++;if(node.open){if(typeof node.close==='function')node.close();else node.removeAttribute('open');}if(previous?.isConnected)previous.focus();};
  },[open]);
  function selectFile(next){
    setError('');
    if(!next)return;
    if(!types.includes(next.type)||next.size<=0||next.size>8*1024*1024){setFile(null);setError('请选择非空且不超过 8 MiB 的 JPEG、PNG 或 WebP 缴费记录图片。');return;}
    setFile(next);
  }
  async function submit(event){
    event.preventDefault();if(!file||busy||sending.current)return;
    const current=generation.current;sending.current=true;setSubmitting(true);setError('');
    try{await onSubmit(file);}catch(caught){if(current===generation.current)setError(caught.message||'缴费记录未能提交，请重试。');}
    finally{if(current===generation.current){sending.current=false;setSubmitting(false);}}
  }
  function keydown(event){
    if(event.key==='Escape'){event.preventDefault();closing.current?.();return;}
    if(event.key!=='Tab')return;
    const focusable=[...dialog.current.querySelectorAll('button:not(:disabled),input:not(:disabled),a[href],[tabindex="0"]')].filter(node=>!node.closest('[hidden]'));
    const first=focusable[0],last=focusable.at(-1);
    if(event.shiftKey&&(document.activeElement===first||!dialog.current.contains(document.activeElement))){event.preventDefault();last?.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  }
  if(!open)return null;
  const processing=busy||submitting;
  return createPortal(<dialog ref={dialog} className="payment-dialog" aria-labelledby={titleId} onCancel={event=>{event.preventDefault();closing.current?.();}} onClick={event=>{if(event.target===event.currentTarget)closing.current?.();}} onKeyDown={keydown}>
    <section className="payment-dialog-panel">
      <header><h2 id={titleId}>{step==='pay'?'活动缴费':'提交缴费记录'}</h2><button type="button" aria-label="关闭缴费窗口" onClick={()=>closing.current?.()}><X size={21} aria-hidden="true"/></button></header>
      {step==='pay'?<div className="payment-dialog-content">
        <p className="payment-name-instruction">付款时请备注姓名</p>
        {qrUrl&&!qrBroken?<div className="payment-qr-frame"><img src={qrUrl} alt="微信收款二维码" onError={()=>setQrBroken(true)}/></div>:<p className="payment-empty-code" role="status">{qrBroken?'收款码暂时无法显示，请联系活动管理员核实。':'管理员尚未上传本活动收款码，请按正式活动通知联系管理员。'}</p>}
        <p>使用微信扫描活动收款码。付款金额以正式活动通知为准。</p>
        <button className="payment-primary" type="button" onClick={()=>setStep('proof')}>我已缴费</button>
        <small>完成付款后，请提交缴费记录图片，等待管理员核实。</small>
      </div>:<form className="payment-dialog-content" onSubmit={submit}>
        <p>上传微信缴费记录截图，保留收款人、金额和付款时间，方便管理员核实。</p>
        <label className="payment-file-label" htmlFor={inputId}>缴费记录图片</label>
        <input ref={selection} id={inputId} type="file" accept={types.join(',')} disabled={processing} onChange={event=>{selectFile(event.target.files?.[0]);event.target.value='';}}/>
        <small>JPEG、PNG 或 WebP，原图最多 8 MiB，自动压缩至 1 MiB 以内。图片仅对本人和协会管理员可见，活动结束后自动清理。</small>
        {preview&&<img className="payment-receipt-preview" src={preview} alt="待提交的缴费记录预览"/>}
        {error&&<p className="payment-upload-error" role="alert">{error}</p>}
        <button className="payment-primary" type="submit" disabled={!file||processing}>{processing?'正在提交缴费记录…':'提交缴费记录'}</button>
        <button className="payment-secondary" type="button" disabled={processing} onClick={()=>setStep('pay')}>返回收款码</button>
        {processing&&<p role="status">正在安全处理并提交图片，请稍候。</p>}
        <small>提交成功后显示“应已缴费”，管理员核实后变为“已缴费”。</small>
      </form>}
    </section>
  </dialog>,document.body);
}
