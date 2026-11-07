import {useEffect, useState} from 'react';
import {ArrowLeft, Check, Eye, MapPin, CalendarDays, Monitor, Smartphone, Pencil} from 'lucide-react';
import {OFFICIAL_BADGE} from '../Brand.jsx';
import ActivityCover from '../media/ActivityCover.jsx';
import ActivityPageSections from './ActivityPageSections.jsx';
import TrackVisualization from '../tracks/TrackVisualization.jsx';
import {getLocalTrack} from '../tracks/track-store.js';
import {formatActivityDistance, formatActivityAscent} from './presentation.js';
import {activityDateLabel} from './schedule.js';
import './activity-editor.css';

const chapters = [['editor-basic','基本信息'],['editor-overview','活动介绍'],['editor-itinerary','行程安排'],['editor-equipment','装备建议'],['editor-safety','安全须知']];

export default function ActivityEditorWorkspace({item, routeData, legacyTrack, local, editing, formId, busy, saveDisabled, error, onClose, children}) {
  const [panel, setPanel] = useState('edit');
  const [viewport, setViewport] = useState('desktop');
  const [storedTrack, setStoredTrack] = useState(null);
  useEffect(() => {
    if (error) setPanel('edit');
  }, [error]);
  const inlineTrack = routeData?.track || legacyTrack;
  const trackId = routeData?.trackLocalId;
  useEffect(() => {
    let alive = true;
    setStoredTrack(null);
    if (local && trackId && !inlineTrack) getLocalTrack(trackId).then(track => { if (alive) setStoredTrack(track); }).catch(() => {});
    return () => { alive = false; };
  }, [local, trackId, inlineTrack]);
  const previewTrack = inlineTrack || storedTrack;
  function showInvalidField(event) {
    if (panel !== 'preview') return;
    event.preventDefault();
    const field = event.target;
    setPanel('edit');
    const show = () => { field.focus(); field.reportValidity?.(); };
    const nextFrame = field.ownerDocument.defaultView?.requestAnimationFrame;
    if (nextFrame) nextFrame(show); else setTimeout(show, 0);
  }
  const trackContent = previewTrack ? <TrackVisualization track={previewTrack}/> : <div className="track-empty">{trackId ? '已关联历史轨迹，保存后可在活动详情查看。' : '尚未关联路线，可在左侧选择已有路线。'}</div>;
  return <section className="activity-editor-page" aria-label="活动编辑工作区" data-panel={panel} onInvalidCapture={showInvalidField} onSubmitCapture={() => setPanel('edit')}>
    <header className="activity-editor-header">
      <div className="activity-editor-heading"><button className="activity-editor-back" onClick={onClose} disabled={busy} aria-label="返回活动列表"><ArrowLeft size={20}/></button><img src={OFFICIAL_BADGE} alt="川衡官方徽章"/><div><h1>{editing ? '编辑活动' : '新建活动'}</h1><p>{local ? '本地草稿 · 确认后再同步网站' : '编辑活动内容与页面'}</p></div></div>
      <div className="activity-editor-header-actions"><span>{local ? '仅保存在此浏览器' : '保存前请核对内容'}</span><button type="submit" form={formId} className="admin-btn primary" disabled={saveDisabled}><Check size={17}/>{busy ? '正在保存…' : local ? '保存本地草稿' : '保存内容'}</button></div>
    </header>
    {error && <div className="activity-editor-save-error" role="alert">{error}</div>}
    <div className="activity-editor-mobile-tabs" role="group" aria-label="切换编辑与预览"><button type="button" onClick={() => setPanel('edit')} aria-pressed={panel === 'edit'}><Pencil size={16}/>编辑活动</button><button type="button" onClick={() => setPanel('preview')} aria-pressed={panel === 'preview'}><Eye size={16}/>页面预览</button></div>
    <div className="activity-editor-columns">
      <div className="activity-editor-edit">
        <nav className="activity-editor-chapters" aria-label="编辑章节">{chapters.map(([id,title]) => <a key={id} href={`#${id}`}>{title}</a>)}</nav>
        <div className="activity-editor-form">{children}</div>
      </div>
      <aside className="activity-editor-preview" aria-label="活动页面实时预览">
        <div className="activity-editor-preview-toolbar"><div><Eye size={17}/><strong>页面预览</strong><span>随编辑实时更新</span></div><div className="activity-editor-viewports" role="group" aria-label="预览尺寸"><button type="button" aria-label="桌面预览" aria-pressed={viewport === 'desktop'} onClick={() => setViewport('desktop')}><Monitor size={17}/></button><button type="button" aria-label="手机预览" aria-pressed={viewport === 'mobile'} onClick={() => setViewport('mobile')}><Smartphone size={17}/></button></div></div>
        <div className={`activity-editor-preview-scroll ${viewport === 'mobile' ? 'is-mobile' : ''}`}>
          <div className="activity-editor-preview-paper explore-detail">
            <div className="activity-editor-preview-disclosure">{local ? '本地页面预览，尚未发布' : '当前编辑预览，保存后生效'}</div>
            <div className="activity-editor-preview-heading"><div className="activity-editor-preview-tags"><span className="tag">{item.status || '即将开始'}</span><span>{item.type || '活动种类待选择'}</span></div><h2>{item.title || '为下一次出发起个名字'}</h2><div className="explore-heading-meta"><span><MapPin size={15}/>{item.location || '地点待确认'}</span><span><CalendarDays size={15}/>{activityDateLabel(item)}</span></div></div>
            <div className="explore-detail-cover"><ActivityCover item={item} loading="eager"/></div>
            <dl className="activity-editor-preview-metrics"><div><dt>路线里程</dt><dd>{formatActivityDistance(item.distance)}</dd></div><div><dt>累计爬升</dt><dd>{formatActivityAscent(item.ascent)}</dd></div><div><dt>活动难度</dt><dd>{item.difficulty || '入门'}</dd></div></dl>
            <article className="explore-detail-body"><ActivityPageSections item={item} trackContent={trackContent}/></article>
            <div className="activity-editor-preview-end">川衡 · 以山为衡，向野而行</div>
          </div>
        </div>
      </aside>
    </div>
  </section>;
}
