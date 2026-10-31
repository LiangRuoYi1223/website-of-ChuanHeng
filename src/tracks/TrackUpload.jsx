import {useEffect,useId,useRef,useState} from 'react';
import {Upload,Download,Trash2} from 'lucide-react';
import {supabase} from '../backend.js';
import {convertTrackFile,downloadTrackJson} from './import-client.js';
import TrackVisualization from './TrackVisualization.jsx';
import './track-import.css';
import {resolvedTrackMetrics,withManualTrackMetrics} from './metrics.js';

export function TrackMetricsDialog({track,onConfirm,onCancel}) {
  const dialog=useRef(null), title=useId();
  const [values,setValues]=useState({distanceM:track.manualMetrics?.distanceM?.toString()??'',ascentM:track.manualMetrics?.ascentM?.toString()??''}),[error,setError]=useState('');
  const metrics=resolvedTrackMetrics({stats:track.stats});
  useEffect(()=>{const previous=document.activeElement;dialog.current?.querySelector('input:not([readonly]),button')?.focus();return()=>previous?.focus()},[]);
  function confirm(skip=false) {
    try {onConfirm(withManualTrackMetrics(track,skip?{}:Object.fromEntries(Object.entries(values).filter(([,v])=>v.trim()!=='').map(([key,v])=>[key,Number(v)]))));}
    catch(caught){setError(caught.message)}
  }
  function keydown(event) {
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onCancel();}
    if(event.key==='Tab'){
      event.stopPropagation();const items=[...dialog.current.querySelectorAll('input:not([readonly]),button')];
      const first=items[0],last=items.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
    }
  }
  return <div className="track-metrics-overlay" onKeyDown={keydown} onMouseDown={e=>e.stopPropagation()}><section ref={dialog} className="track-metrics-dialog" role="dialog" aria-modal="true" aria-labelledby={title}><h3 id={title}>补充路线参数</h3><p>部分指标无法从轨迹中计算，请管理员核实后补充；也可暂不提供。自动计算结果不可修改，海拔曲线仍以源文件为准。</p>{[['distanceM','里程（m）'],['ascentM','累计爬升（m）']].map(([field,label])=><label key={field}>{label}<input type="number" min="0" step="any" readOnly={metrics[field]!==null} value={metrics[field]??values[field]} onChange={e=>setValues(old=>({...old,[field]:e.target.value}))}/><small>{metrics[field]!==null?'轨迹自动计算':'留空则暂不提供数据'}</small></label>)}{error&&<p role="alert">{error}</p>}<div className="track-metrics-actions"><button type="button" onClick={onCancel}>取消该次更换</button><button type="button" onClick={()=>confirm(true)}>暂不提供</button><button type="button" onClick={()=>confirm()}>确认补充</button></div></section></div>;
}

export default function TrackUpload({value,onChange,disabled=false,local=false,onBusyChange}) {
  const inputId = useId();
  const [busy,setBusy] = useState(false), [error,setError] = useState('');
  const [dragging,setDragging] = useState(false);
  const [pending,setPending]=useState(null);
  const controller = useRef(null), revision = useRef(0), busyCallback = useRef(onBusyChange);
  busyCallback.current=onBusyChange;
  useEffect(()=>()=>{revision.current++;controller.current?.abort();busyCallback.current?.(false)},[]);
  async function upload(file) {
    if (!file || disabled || busy) return;
    const current=++revision.current;
    setError('');setBusy(true);busyCallback.current?.(true);
    controller.current?.abort();controller.current=new AbortController();
    const timeout=setTimeout(()=>controller.current?.abort(),60000);
    let awaitingDecision=false;
    try {
      let token;
      if(!local && supabase) {
        const {data,error:authError}=await supabase.auth.getSession();
        if(authError) throw new Error('无法读取登录信息，请重新登录。');
        token=data.session?.access_token;
      }
      // Authorization is enforced by the server, never by this local UI flag.
      const track=await convertTrackFile(file,{token,signal:controller.current.signal});
      if(current===revision.current) {
        const metrics=resolvedTrackMetrics(track);
        if(metrics.distanceM===null||metrics.ascentM===null){awaitingDecision=true;setPending(track)}
        else onChange(track);
      }
    } catch(caught) {
      if(current===revision.current) setError(caught.name==='AbortError' ? '转换已取消或超时，原轨迹保留。请重试。' : caught.message);
    } finally {
      clearTimeout(timeout);
      if(current===revision.current&&!awaitingDecision) {setBusy(false);busyCallback.current?.(false);}
    }
  }
  return <section className="track-upload" aria-label="轨迹文件导入" aria-busy={busy}>
    <div className={`track-drop ${dragging?'is-dragging':''}`} onDragOver={e=>{e.preventDefault();if(!disabled&&!busy)setDragging(true)}} onDragLeave={()=>setDragging(false)} onDrop={e=>{e.preventDefault();setDragging(false);if(e.dataTransfer.files.length!==1){setError('请一次上传一个文件；一个文件中可包含多段轨迹。');return;}upload(e.dataTransfer.files[0]);}}>
      <Upload size={25} aria-hidden="true"/><div><h3>{value?'替换轨迹文件':'导入 GPX / KML'}</h3><p>拖放文件到这里，或点击选择。每个文件最多 5 MiB、30,000 点、100 段。</p></div>
      <label className="btn" htmlFor={inputId}>{busy?'正在转换…':'选择轨迹文件'}</label>
      <input id={inputId} className="track-file-input" type="file" accept=".gpx,.kml" disabled={busy||disabled} onChange={e=>{upload(e.target.files[0]);e.target.value=''}}/>
    </div>
    <p className="track-import-hint">分段路线显示在同一张地图，每段单独生成海拔图。KML 请使用绝对海拔；贴地或缺失海拔会标明未提供。</p>
    {busy&&!pending&&<p role="status">后端正在读取坐标、海拔并计算各段数据… <button type="button" className="track-text-button" onClick={()=>controller.current?.abort()}>取消</button></p>}
    {pending&&<TrackMetricsDialog track={pending} onConfirm={next=>{onChange(next);setPending(null);setBusy(false);busyCallback.current?.(false)}} onCancel={()=>{setPending(null);setBusy(false);busyCallback.current?.(false)}}/>}
    {value&&!pending&&(resolvedTrackMetrics(value).distanceM===null||resolvedTrackMetrics(value).ascentM===null)&&<button type="button" disabled={busy||disabled} onClick={()=>{setPending(value);setBusy(true);busyCallback.current?.(true)}}>补充缺失路线参数</button>}
    {error&&<p role="alert" className="track-import-error">{error}</p>}
    {value?.location&&<div className="track-location-info" role="status"><strong>省市自动识别</strong><p>{value.location.locations?.length ? [...new Set(value.location.locations.map(place=>`${place.province || ''} ${place.city || ''}`.trim()))].join(' / ') : '未匹配到省市边界，请核实坐标和轨迹位置。'}</p>{value.location.locationStatus!=='matched'&&<small>部分点位未能确定行政区。请在 Debug 查看并核实，不会按最近城市猜测归属。</small>}</div>}
    {value&&<><div className="track-import-result"><div><strong>{value.name}</strong><span>{value.sourceFile} · {value.pointCount.toLocaleString()} 个点 · {value.segmentCount} 段</span></div><div className="track-import-actions"><button type="button" onClick={()=>downloadTrackJson(value,true)}><Download size={15}/>GeoJSON</button><button type="button" onClick={()=>downloadTrackJson(value)}><Download size={15}/>完整结果</button><button type="button" disabled={disabled||busy} onClick={()=>{onChange(null);setError('')}}><Trash2 size={15}/>移除</button></div></div><TrackVisualization track={value}/></>}
  </section>;
}
