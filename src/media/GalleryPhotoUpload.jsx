import { useEffect, useId, useRef, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import { supabase } from '../backend.js';
import { uploadGalleryPhoto } from './gallery-photo.js';
import './activity-cover.css';
import './gallery-photo.css';

const formatBytes = bytes => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;

export default function GalleryPhotoUpload({ initialValue = '', onBusyChange, disabled = false, local = false }) {
  const inputId = useId();
  const [imageURL, setImageURL] = useState(initialValue);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [broken, setBroken] = useState(false);
  const [metrics, setMetrics] = useState(null);
  const input = useRef(null), pending = useRef(false), revision = useRef(0), controller = useRef(null), busyCallback = useRef(onBusyChange);
  busyCallback.current = onBusyChange;
  useEffect(() => () => {
    revision.current++;
    controller.current?.abort();
    if (pending.current) { pending.current = false; busyCallback.current?.(false); }
  }, []);

  async function upload(file) {
    if (!file || disabled || pending.current) return;
    const current = ++revision.current;
    controller.current = new AbortController();
    pending.current = true; setBusy(true); setError(''); busyCallback.current?.(true);
    try {
      const result = await uploadGalleryPhoto(supabase, file, { local, signal: controller.current.signal });
      if (current === revision.current) { setImageURL(result.url); setMetrics(result); setBroken(false); }
    } catch (caught) {
      if (current === revision.current) setError(`${caught?.message || '照片上传失败。'} 原照片已保留。`);
    } finally {
      if (current === revision.current) { pending.current = false; controller.current = null; setBusy(false); busyCallback.current?.(false); }
    }
  }

  return <section className="activity-cover-upload gallery-photo-upload" aria-label="影像照片" aria-busy={busy}>
    <input type="hidden" name="image" value={imageURL} />
    <div className="activity-cover-preview">
      {imageURL && !broken ? <img src={imageURL} alt="影像照片预览" onError={() => setBroken(true)} /> : <div className="activity-cover-empty"><ImagePlus size={28} aria-hidden="true" /><span>{broken ? '照片暂时无法显示，请重新上传' : '尚未上传照片'}</span></div>}
    </div>
    <div className="activity-cover-controls">
      <div><strong>影像照片</strong><p>JPEG、PNG 或 WebP，原图最多 20 MiB，保存每张最多 3 MiB。后台保持原比例处理、不放大，并移除图片元数据。{local ? '处理后的照片仅保存在当前浏览器草稿。' : '上传完成后保存即可使用。'}</p></div>
      <button type="button" className="btn" disabled={disabled || busy} onClick={() => input.current?.click()}>{busy ? '正在处理并上传…' : imageURL ? '更换照片' : '上传照片'}</button>
      <input ref={input} id={inputId} className="activity-cover-file" aria-label="影像照片文件" type="file" accept="image/jpeg,image/png,image/webp" disabled={disabled || busy} onChange={event => { upload(event.target.files?.[0]); event.target.value = ''; }} />
      {imageURL && <button type="button" className="activity-cover-remove" disabled={disabled || busy} onClick={() => { setImageURL(''); setMetrics(null); setBroken(false); setError(''); }}>移除照片</button>}
    </div>
    {busy && <p className="activity-cover-status" role="status">正在处理并上传照片，请稍候再保存。</p>}
    {metrics && <p className="activity-cover-status" role="status">处理完成：原图 {formatBytes(metrics.originalBytes)} → 保存 {formatBytes(metrics.outputBytes)}。</p>}
    {error && <p className="activity-cover-error" role="alert">{error}</p>}
  </section>;
}
