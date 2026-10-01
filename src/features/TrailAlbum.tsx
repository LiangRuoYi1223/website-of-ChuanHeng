import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { ArrowLeft, ArrowRight, ArrowUpRight, Images, X } from 'lucide-react';
import type { Activity } from '../types';
import './trail-album.css';

export interface TrailAlbumProps { activities: Activity[]; compact?: boolean; }

function formatDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }).format(date);
}

export default function TrailAlbum({ activities, compact = false }: TrailAlbumProps) {
  const id = useId();
  const albums = useMemo(() => activities.filter(activity => activity.kind === 'past' && activity.album?.some(photo => photo.src.trim())).sort((a, b) => b.date.localeCompare(a.date)), [activities]);
  const [selectedId, setSelectedId] = useState('');
  const selected = albums.find(activity => activity.id === selectedId) ?? albums[0];
  const photos = useMemo(() => (selected?.album ?? []).filter(photo => photo.src.trim()), [selected]);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const activeIndex = photos.length ? lightboxIndex % photos.length : 0;
  const activePhoto = photos[activeIndex];
  const hasPhotos = photos.length > 0;
  const hasDemoPhotos = photos.some(photo => photo.isDemo ?? selected?.isDemo);

  useEffect(() => {
    setLightboxIndex(0);
    setLightboxOpen(false);
    if (dialogRef.current?.open) dialogRef.current.close();
  }, [selected?.id]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!lightboxOpen || !hasPhotos || !dialog) return;
    if (!dialog.open) dialog.showModal();
    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.documentElement.style.overflow = previousOverflow;
      if (dialog.open) dialog.close();
    };
  }, [lightboxOpen, hasPhotos]);

  function openPhoto(index: number, trigger: HTMLButtonElement) {
    triggerRef.current = trigger;
    setLightboxIndex(index);
    setLightboxOpen(true);
  }

  function restoreFocus() {
    setLightboxOpen(false);
    if (triggerRef.current?.isConnected) triggerRef.current.focus({ preventScroll: true });
  }

  function movePhoto(direction: number) {
    setLightboxIndex(current => (current + direction + photos.length) % photos.length);
  }

  function handleDialogKey(event: KeyboardEvent<HTMLDialogElement>) {
    if (photos.length < 2 || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
    event.preventDefault();
    movePhoto(event.key === 'ArrowLeft' ? -1 : 1);
  }

  function handleBackdropClick(event: MouseEvent<HTMLDialogElement>) {
    if (event.target !== event.currentTarget) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) event.currentTarget.close();
  }

  return <section id="trail-album" className={`trail-album-section${compact ? ' trail-album-compact' : ''}`} aria-labelledby={`${id}-heading`}>
    <div className="trail-album-container">
      <header className="trail-album-heading">
        <div><span className="trail-album-eyebrow">04 / MOMENTS OUTSIDE</span><h2 id={`${id}-heading`}>山野相册<span>。</span></h2></div>
        <p>把风景收进镜头，<br />也把同行的片刻留在这里。</p>
      </header>

      {selected && hasPhotos ? <>
        <div className="trail-album-selector" role="group" aria-label="选择活动相册">
          {albums.map(activity => <button key={activity.id} type="button" className="trail-album-choice" aria-pressed={activity.id === selected.id} aria-controls={`${id}-photos`} onClick={() => setSelectedId(activity.id)}>
            <span>{activity.title}</span><time dateTime={activity.date}>{formatDate(activity.date)}</time>
          </button>)}
        </div>

        <div className="trail-album-meta">
          <div><span className="trail-album-category">{selected.category}</span><time dateTime={selected.date}>{formatDate(selected.date)}</time><span>{selected.location}</span></div>
          <span className="trail-album-photo-count">{photos.length} 张照片{selected.isDemo ? ' · 回顾示例' : ''}</span>
        </div>

        <div id={`${id}-photos`} className="trail-album-mosaic" data-count={Math.min(photos.length, 3)} aria-label={`${selected.title}的活动照片`}>
          {photos.slice(0, 3).map((photo, index) => <button key={photo.id} type="button" className={`trail-album-photo trail-album-photo-${index + 1}`} aria-label={`查看大图：${photo.alt || photo.caption || `第 ${index + 1} 张活动照片`}${(photo.isDemo ?? selected.isDemo) ? '（示意照片）' : ''}`} aria-haspopup="dialog" onClick={event => openPhoto(index, event.currentTarget)}>
            <img src={photo.src} alt={photo.alt || photo.caption || '活动照片'} loading="lazy" decoding="async" width="1536" height="1024" />
            {(photo.isDemo ?? selected.isDemo) && <span className="trail-album-demo">示意照片</span>}
            <span className="trail-album-photo-bottom"><span><small>{String(index + 1).padStart(2, '0')} / {String(photos.length).padStart(2, '0')}</small><span>{photo.caption}</span></span><ArrowUpRight size={23} strokeWidth={1.5} aria-hidden="true" /></span>
          </button>)}
        </div>

        <footer className="trail-album-footer">
          <p>{hasDemoPhotos ? '示意照片用于展示相册效果，并非协会活动实拍；真实影像待补充。' : '点击照片，慢慢看这一段同行的路。'}</p>
          <button type="button" className="trail-album-view-all" aria-haspopup="dialog" onClick={event => openPhoto(0, event.currentTarget)}>浏览全部 {photos.length} 张<ArrowRight size={18} aria-hidden="true" /></button>
        </footer>

        <dialog ref={dialogRef} className="trail-album-dialog" aria-labelledby={`${id}-dialog-heading`} aria-describedby={`${id}-caption`} onClose={restoreFocus} onKeyDown={handleDialogKey} onClick={handleBackdropClick}>
          <div className="trail-album-lightbox">
            <header className="trail-album-lightbox-header">
              <div><h3 id={`${id}-dialog-heading`}>{selected.title} · 山野相册</h3><time dateTime={selected.date}>{formatDate(selected.date)}</time></div>
              <button type="button" className="trail-album-icon-button" aria-label="关闭大图" onClick={() => dialogRef.current?.close()} autoFocus><X size={24} strokeWidth={1.5} aria-hidden="true" /></button>
            </header>
            {activePhoto && <div className="trail-album-lightbox-image">
              <img src={activePhoto.src} alt={activePhoto.alt || activePhoto.caption || '活动照片'} decoding="async" />
              {(activePhoto.isDemo ?? selected.isDemo) && <span className="trail-album-demo">示意照片 · 非活动实拍</span>}
            </div>}
            <footer className="trail-album-lightbox-footer">
              <div className="trail-album-lightbox-caption"><p id={`${id}-caption`}>{activePhoto?.caption || '活动影像'}</p><span role="status" aria-live="polite" aria-atomic="true">{activeIndex + 1} / {photos.length}</span></div>
              <div className="trail-album-lightbox-controls">
                <button type="button" className="trail-album-icon-button" disabled={photos.length < 2} aria-label="上一张照片" onClick={() => movePhoto(-1)}><ArrowLeft size={22} aria-hidden="true" /></button>
                <button type="button" className="trail-album-icon-button" disabled={photos.length < 2} aria-label="下一张照片" onClick={() => movePhoto(1)}><ArrowRight size={22} aria-hidden="true" /></button>
              </div>
            </footer>
          </div>
        </dialog>
      </> : <div className="trail-album-empty"><Images size={35} strokeWidth={1.2} aria-hidden="true" /><h3>相册正在整理</h3><p>真实活动的风景与同行瞬间，将在这里慢慢更新。</p></div>}
    </div>
  </section>;
}
