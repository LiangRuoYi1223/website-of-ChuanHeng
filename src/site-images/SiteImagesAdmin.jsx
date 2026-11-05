import {useEffect,useRef,useState} from 'react';
import {ArrowDown,ArrowUp,Plus,Trash2} from 'lucide-react';
import {supabase} from '../backend.js';
import ImageUpload from './ImageUpload.jsx';
import {defaultSiteImages,getSlotImage,IMAGE_SLOTS,imageCredit,readLocalSiteImages,readSiteImages,saveLocalSiteImages,saveSiteImages} from './config.js';
import './site-images-admin.css';

export default function SiteImagesAdmin({local=false}){
  const [state,setState]=useState(null),[config,setConfig]=useState(null),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[uploading,setUploading]=useState(false),[dirty,setDirty]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[revision,setRevision]=useState(0);
  const generation=useRef(0),pending=useRef(false);
  useEffect(()=>{
    const current=++generation.current;let alive=true;
    setState(null);setConfig(null);setDirty(false);setNotice('');setError('');setLoading(true);setSaving(false);setUploading(false);pending.current=false;
    Promise.resolve().then(()=>local?readLocalSiteImages():readSiteImages(supabase,{admin:true})).then(next=>{if(alive&&current===generation.current){setState(next);setConfig(next.config);}}).catch(caught=>{if(alive&&current===generation.current)setError(caught.message||'无法读取图片配置，请重试。');}).finally(()=>{if(alive&&current===generation.current)setLoading(false);});
    const subscription=!local&&supabase?.auth?.onAuthStateChange?.(event=>{
      if(event==='INITIAL_SESSION'||event==='TOKEN_REFRESHED')return;
      generation.current++;pending.current=false;setState(null);setConfig(null);setDirty(false);setSaving(false);setUploading(false);setLoading(false);setNotice('');setError('登录状态已变化，请重新加载图片设置。');
    })?.data?.subscription;
    return()=>{alive=false;generation.current++;subscription?.unsubscribe?.();};
  },[local,revision]);
  useEffect(()=>{if(!dirty)return;const guard=event=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',guard);return()=>window.removeEventListener('beforeunload',guard);},[dirty]);
  function edit(update){setConfig(current=>update(current));setDirty(true);setNotice('');}
  function updateImage(target,patch){edit(current=>target.kind==='hero'?{...current,heroSlides:current.heroSlides.map(item=>item.id===target.id?{...item,...patch}:item)}:{...current,slots:{...current.slots,[target.id]:{...getSlotImage(current,target.id),...patch}}});}
  function add(){edit(current=>({...current,heroSlides:[...current.heroSlides,{...defaultSiteImages().heroSlides[0],id:crypto.randomUUID()}]}));}
  function move(index,offset){edit(current=>{const slides=[...current.heroSlides];[slides[index],slides[index+offset]]=[slides[index+offset],slides[index]];return {...current,heroSlides:slides};});}
  async function submit(event){
    event.preventDefault();if(!state||!config||!dirty||loading||uploading||pending.current)return;
    const current=generation.current;pending.current=true;setSaving(true);setError('');setNotice('');
    try{
      const next=local?saveLocalSiteImages(config,state.updatedAt):await saveSiteImages(supabase,{config,expectedUpdatedAt:state.updatedAt,expectedUserId:state.viewerId});
      if(current===generation.current){setState(next);setConfig(next.config);setDirty(false);setNotice(local?'图片设置仅保存在当前浏览器，未修改正式网站。':'全站图片已保存，网站将使用新的图片设置。');window.dispatchEvent(new window.Event('chuanheng-site-images-updated'));}
    }catch(caught){if(current===generation.current)setError(caught.message||'保存未完成，当前编辑已保留。');}
    finally{if(current===generation.current){pending.current=false;setSaving(false);}}
  }
  const blocked=loading||saving||uploading;
  function fields(target,value,label){return <div className="site-image-edit-fields">
    <ImageUpload name={null} value={value.url} label={label} onValueChange={url=>updateImage(target,{url,credit:''})} onBusyChange={setUploading} disabled={blocked} local={local}/>
    <div className="site-image-text-fields"><label>图片说明<input aria-label={`${label}说明`} value={value.alt} maxLength={200} onChange={event=>updateImage(target,{alt:event.target.value})}/></label><label>图片来源 / 署名<input aria-label={`${label}来源`} value={value.credit} maxLength={200} placeholder="如：摄影者姓名、授权说明；AI 图片请注明" onChange={event=>updateImage(target,{credit:event.target.value})}/></label>{imageCredit(value)&&<small>网站标注：{imageCredit(value)}</small>}</div>
  </div>;}
  return <section className="admin-panel site-images-admin" aria-labelledby="site-images-title">
    <div className="site-images-heading"><div><h2 id="site-images-title">网站图片</h2><p>首页轮播、栏目背景与页面配图统一管理。上传后保存，网站即使用新配置。</p></div><button type="button" className="admin-btn" disabled={blocked} onClick={()=>setRevision(value=>value+1)}>{dirty?'放弃修改并重新加载':'重新加载图片'}</button></div>
    {local&&<p className="site-images-note">本地设计预览：图片仅保存在当前浏览器，不会修改正式网站。</p>}
    {loading&&<p role="status">正在读取图片设置…</p>}{error&&<p className="site-images-error" role="alert">{error}</p>}{notice&&<p className="site-images-notice" role="status">{notice}</p>}
    {config&&<form onSubmit={submit}><fieldset disabled={blocked}><section className="site-images-hero"><div className="site-images-group-heading"><div><h3>首页轮播</h3><p>当前 {config.heroSlides.length} 张，按下方顺序显示。可增加或减少，至少保留一张。</p></div><button type="button" className="admin-btn" onClick={add}><Plus size={16}/>添加首页图片</button></div>
      {config.heroSlides.map((value,index)=><article className="site-image-row" key={value.id} data-hero-id={value.id}><div className="site-image-row-heading"><h4>首页图片 {index+1}</h4><div><button className="admin-btn" type="button" aria-label={`上移第${index+1}张首页图片`} disabled={blocked||index===0} onClick={()=>move(index,-1)}><ArrowUp size={16}/>上移</button><button className="admin-btn" type="button" aria-label={`下移第${index+1}张首页图片`} disabled={blocked||index===config.heroSlides.length-1} onClick={()=>move(index,1)}><ArrowDown size={16}/>下移</button><button className="admin-btn" type="button" aria-label={`移除第${index+1}张首页图片`} disabled={blocked||config.heroSlides.length===1} onClick={()=>edit(current=>({...current,heroSlides:current.heroSlides.filter(item=>item.id!==value.id)}))}><Trash2 size={16}/>移除</button></div></div>{fields({kind:'hero',id:value.id},value,`首页图片 ${index+1}`)}</article>)}
    </section>
    {[...new Set(IMAGE_SLOTS.map(slot=>slot.group))].map(group=><details className="site-image-group" open={group==='栏目背景'} key={group}><summary>{group}<span>{IMAGE_SLOTS.filter(slot=>slot.group===group).length} 个位置</span></summary>{IMAGE_SLOTS.filter(slot=>slot.group===group).map(slot=><article className="site-image-row" key={slot.key}><h4>{slot.label}</h4>{fields({kind:'slot',id:slot.key},getSlotImage(config,slot.key),slot.label)}</article>)}</details>)}
    </fieldset><div className="site-images-save"><p>{dirty?'有修改尚未保存。':'当前图片设置已加载。'}更换或移除配置不会删除旧图片。</p><button className="admin-btn primary" type="submit" disabled={blocked||!dirty}>{uploading?'正在处理图片…':saving?'正在保存…':local?'保存本地图片':'保存全站图片'}</button></div></form>}
    <div className="site-images-content-links"><p>各条内容的图片可在对应编辑器中上传和更换：</p><nav aria-label="内容图片管理">{[['活动封面','activities'],['路线封面','routes'],['影像照片','gallery'],['资讯封面','news']].map(([label,section])=><a key={section} href={`/admin/${section}${local?'?preview=1':''}`}>{label}</a>)}<a href={`/admin/services${local?'?preview=1':''}`}>全站收款码</a></nav><p>官方徽章沿用协会原图。缴费凭证只在受控报名流程中管理。</p></div>
  </section>;
}
