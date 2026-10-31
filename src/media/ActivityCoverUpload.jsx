import { useEffect, useId, useRef, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import { supabase } from '../backend.js';
import { uploadActivityCover } from './activity-cover.js';
import './activity-cover.css';

export default function ActivityCoverUpload({ initialValue = '', onBusyChange, disabled = false, local = false }) {
  const inputId = useId();
  const [imageURL, setImageURL] = useState(initialValue);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [broken, setBroken] = useState(false);
  const input = useRef(null), pending = useRef(false), revision = useRef(0), busyCallback = useRef(onBusyChange);
  busyCallback.current = onBusyChange;
  useEffect(() => () => { revision.current++; if (pending.current) busyCallback.current?.(false); }, []);

  async function upload(file) {
    if (!file || disabled || pending.current) return;
    const current = ++revision.current;
    pending.current = true; setBusy(true); setError(''); busyCallback.current?.(true);
    try {
      const value = await uploadActivityCover(supabase, file, { local });
      if (current === revision.current) { setImageURL(value); setBroken(false); }
    } catch (caught) {
      if (current === revision.current) setError(`${caught.message || '封面上传失败。'} 原封面已保留。`);
    } finally {
      if (current === revision.current) { pending.current = false; setBusy(false); busyCallback.current?.(false); }
    }
  }

  return <section className="activity-cover-upload" aria-label="活动封面" aria-busy={busy}>
    <input type="hidden" name="image" value={imageURL} />
    <div className="activity-cover-preview">
      {imageURL && !broken ? <img src={imageURL} alt="活动封面预览" onError={() => setBroken(true)} /> : <div className="activity-cover-empty"><ImagePlus size={28} aria-hidden="true" /><span>{broken ? '封面暂时无法显示，请重新上传' : '尚未设置活动封面'}</span></div>}
    </div>
    <div className="activity-cover-controls">
      <div><strong>活动封面</strong><p>JPEG、PNG 或 WebP，最多 {local ? '1' : '5'} MiB。{local ? '图片仅保存在当前浏览器草稿。' : '上传完成后保存活动即可使用。'}</p></div>
      <button type="button" className="btn" disabled={disabled || busy} onClick={() => input.current?.click()}>{busy ? '正在上传…' : imageURL ? '更换封面' : '上传封面'}</button>
      <input ref={input} id={inputId} className="activity-cover-file" aria-label="活动封面文件" type="file" accept="image/jpeg,image/png,image/webp" disabled={disabled || busy} onChange={event => { upload(event.target.files?.[0]); event.target.value = ''; }} />
      {imageURL && <button type="button" className="activity-cover-remove" disabled={disabled || busy} onClick={() => { setImageURL(''); setBroken(false); setError(''); }}>移除封面</button>}
    </div>
    {busy && <p className="activity-cover-status" role="status">正在处理封面，请稍候再保存活动。</p>}
    {error && <p className="activity-cover-error" role="alert">{error}</p>}
  </section>;
}
