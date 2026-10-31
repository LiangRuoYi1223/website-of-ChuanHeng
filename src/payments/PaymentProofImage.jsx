import {useEffect,useRef,useState} from 'react';
import {supabase} from '../backend.js';
import {downloadPaymentProof} from './payment-proof.js';
import './payment.css';

export default function PaymentProofImage({proof,expectedUserId}){
  const [url,setUrl]=useState(''),[loading,setLoading]=useState(false),[error,setError]=useState('');
  const revision=useRef(0),objectUrl=useRef(''),request=useRef(null);
  function clearImage(){revision.current++;request.current?.abort();if(objectUrl.current){URL.revokeObjectURL(objectUrl.current);objectUrl.current='';}}
  useEffect(()=>{
    clearImage();setUrl('');setLoading(false);setError('');
    const subscription=supabase?.auth?.onAuthStateChange?.(event=>{
      if(event==='INITIAL_SESSION'||event==='TOKEN_REFRESHED')return;
      clearImage();setUrl('');setLoading(false);setError('登录状态已变化，请重新加载报名记录。');
    })?.data?.subscription;
    return()=>{clearImage();subscription?.unsubscribe();};
  },[proof?.id,proof?.objectPath,expectedUserId]);
  async function show(){
    if(loading||!proof)return;
    if(url){clearImage();setUrl('');return;}
    const current=++revision.current;const controller=new AbortController();request.current=controller;setLoading(true);setError('');
    try{
      const blob=await downloadPaymentProof(supabase,proof,{expectedUserId,signal:controller.signal});
      if(current!==revision.current||controller.signal.aborted)return;
      const next=URL.createObjectURL(blob);objectUrl.current=next;setUrl(next);
    }catch(caught){if(current===revision.current)setError(caught.message||'缴费记录暂时无法读取，请重试。');}
    finally{if(current===revision.current)setLoading(false);}
  }
  return <div className="payment-proof-viewer">
    <button type="button" className="payment-proof-toggle" disabled={loading||!proof} onClick={show}>{loading?'正在读取图片…':url?'收起图片':'查看缴费记录'}</button>
    {error&&<p role="alert">{error}</p>}
    {url&&<a href={url} target="_blank" rel="noopener noreferrer" aria-label="在新窗口查看缴费记录原图"><img src={url} alt="缴费记录" onError={()=>{clearImage();setUrl('');setError('图片暂时无法显示，请重试或联系管理员。');}}/><span>点击图片放大查看</span></a>}
  </div>;
}
