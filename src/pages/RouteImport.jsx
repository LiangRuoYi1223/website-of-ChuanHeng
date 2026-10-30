import {useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {ArrowLeft,Save} from 'lucide-react';
import TrackUpload from '../tracks/TrackUpload.jsx';
import {saveImportedRouteDraft} from '../tracks/track-store.js';

export default function RouteImportPage(){
  const [track,setTrack]=useState(null),[title,setTitle]=useState(''),[status,setStatus]=useState(null);
  const [busy,setBusy]=useState(false),[uploading,setUploading]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState('');
  useEffect(()=>{const controller=new AbortController();fetch('/api/tracks/status',{signal:controller.signal}).then(r=>{if(!r.ok)throw new Error();return r.json()}).then(setStatus).catch(e=>{if(e.name!=='AbortError')setError('轨迹转换服务未连接，请重新启动本地网站。')});return()=>controller.abort()},[]);
  function update(value){setTrack(value);setTitle(value?.name||'');setSaved('');setError('')}
  async function save(e){
    e.preventDefault();if(!track||uploading||busy)return;
    setBusy(true);setError('');
    try{setSaved(await saveImportedRouteDraft(track,title))}catch(e){setError(e.message)}finally{setBusy(false)}
  }
  return <div className="container track-import-page"><div className="track-import-heading"><div><Link to="/routes"><ArrowLeft size={15}/> 返回路线库</Link><h1>把山野的轨迹，带回来。</h1><p className="track-import-intro">上传 GPX 或 KML，自动生成线路地图与分段海拔剖面。多段路线保留断点，在同一张地图上展示；下方每一段都有自己的里程、爬升与海拔曲线。</p></div><Link to="/admin/routes?preview=1">路线草稿管理 ↗</Link></div>
    <TrackUpload value={track} onChange={update} disabled={busy} local={status?.localPreview===true} onBusyChange={setUploading}/>
    {error&&<p className="track-import-error" role="alert">{error}</p>}
    {track&&status?.localPreview&&<form className="track-import-save" onSubmit={save}><label>路线名称<input value={title} onChange={e=>{setTitle(e.target.value);setSaved('')}} maxLength={120} required/></label><p>保存为此浏览器的路线草稿，可在路线管理中继续编辑。上传和转换不会自动公开发布。</p><button className="btn" type="submit" disabled={busy||uploading||!!saved}><Save size={17}/>{busy?'正在保存…':saved?'已保存草稿':'保存路线草稿'}</button></form>}
    {track&&status&&!status.localPreview&&<p className="track-import-hint">转换结果可下载保存；管理员可在路线管理的编辑器内导入并保存路线。领队上传需要已分配的领队账号权限。</p>}
    {saved&&<div className="track-import-success" role="status"><p>路线与全部分段已保存。刷新页面后可从路线管理再次打开。</p><Link to={`/routes/${saved}?draft=1`}>查看路线详情 ↗</Link><Link to="/admin/routes?preview=1">继续编辑路线 ↗</Link></div>}
    {!track&&<div className="track-empty"><strong>准备一个轨迹文件即可开始</strong><p>支持 GPX 轨迹/路线点、KML LineString 与 gx:Track。一个文件中的多条线不会被合并成连续路线。没有海拔的段落仍可显示地图，但不会伪造海拔曲线。</p></div>}
  </div>;
}
