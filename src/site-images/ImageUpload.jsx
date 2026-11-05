import {useEffect,useRef,useState} from 'react';
import {ImagePlus} from 'lucide-react';
import {supabase} from '../backend.js';
import {uploadActivityCover} from '../media/activity-cover.js';

export default function ImageUpload({initialValue='',value,onValueChange,onBusyChange,label='封面图片',name='image',allowUrl=false,disabled=false,local=false}){
  const [stored,setStored]=useState(initialValue),[busy,setBusy]=useState(false),[error,setError]=useState(''),[broken,setBroken]=useState('');
  const url=value===undefined?stored:value;
  const input=useRef(null),generation=useRef(0),pending=useRef(false),controller=useRef(null),busyCallback=useRef(onBusyChange);
  busyCallback.current=onBusyChange;
  useEffect(()=>()=>{generation.current++;controller.current?.abort();if(pending.current)busyCallback.current?.(false);},[]);
  function change(next){setStored(next);setBroken('');setError('');onValueChange?.(next);}
  async function upload(file){
    if(!file||disabled||pending.current)return;
    const current=++generation.current;controller.current=new AbortController();pending.current=true;setBusy(true);setError('');busyCallback.current?.(true);
    try{const next=await uploadActivityCover(supabase,file,{local,signal:controller.current.signal});if(current===generation.current)change(next);}
    catch(caught){if(current===generation.current)setError(`${caught.message||'图片上传失败。'} 原图片已保留。`);}
    finally{if(current===generation.current){pending.current=false;setBusy(false);busyCallback.current?.(false);}}
  }
  return <section className="site-image-upload" aria-label={label} aria-busy={busy}>
    {name&&!allowUrl&&<input type="hidden" name={name} value={url}/>}
    <div className="site-image-upload-preview">{url&&broken!==url?<img src={url} alt={`${label}预览`} onError={()=>setBroken(url)}/>:<span><ImagePlus size={25}/>{url?'图片暂不可用，请更换':'尚未设置图片'}</span>}</div>
    <div className="site-image-upload-controls"><strong>{label}</strong><p>JPEG、PNG 或 WebP，最多 {local?'1':'3'} MiB。{local?'仅保存在当前浏览器。':'上传后自动压缩，保存后生效。'}</p>
      <button type="button" className="admin-btn" disabled={disabled||busy} onClick={()=>input.current?.click()}>{busy?'正在上传…':url?'更换图片':'上传图片'}</button>
      <input ref={input} className="site-image-file" type="file" aria-label={`${label}文件`} accept="image/jpeg,image/png,image/webp" disabled={disabled||busy} onChange={event=>{upload(event.target.files?.[0]);event.target.value='';}}/>
      {allowUrl&&<label>封面图片地址<input type="text" name={name} value={url} disabled={disabled||busy} placeholder="https://… 或 /images/…" onChange={event=>change(event.target.value)}/><small>可以上传新图片，也可以继续使用已有图片地址。</small></label>}
      {name&&url&&<button type="button" className="admin-btn" disabled={disabled||busy} onClick={()=>change('')}>移除图片</button>}
      {error&&<p role="alert" className="site-images-error">{error}</p>}
    </div>
  </section>;
}
