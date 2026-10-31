import { useEffect, useId, useRef, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import { supabase } from '../backend.js';
import { uploadActivityCover } from './activity-cover.js';
import './payment-qr.css';

export default function PaymentQrUpload({ initialValue = '', onBusyChange, onValueChange, disabled = false, local = false }) {
  const inputId = useId();
  const [imageURL, setImageURL] = useState(initialValue);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [broken, setBroken] = useState(false);
  const input = useRef(null), pending = useRef(false), revision = useRef(0), busyCallback = useRef(onBusyChange);
  busyCallback.current = onBusyChange;
  useEffect(() => () => { revision.current++; if (pending.current) busyCallback.current?.(false); }, []);

  async function upload(file) {
    if (!file || disabled || pending.current) return;
    const current = ++revision.current;
    pending.current = true; setBusy(true); setError(''); busyCallback.current?.(true);
    try {
      const value = await uploadActivityCover(supabase, file, { local });
      if (current === revision.current) { setImageURL(value); setBroken(false); onValueChange?.(value); }
    } catch {
      if (current === revision.current) setError('收款码上传未完成，请选择有效的 JPEG、PNG 或 WebP 图片后重试。原收款码已保留。');
    } finally {
      if (current === revision.current) { pending.current = false; setBusy(false); busyCallback.current?.(false); }
    }
  }

  return <section className="payment-qr-upload" aria-label="微信收款二维码" aria-busy={busy}>
    <input type="hidden" name="paymentQrUrl" value={imageURL}/>
    <div className="payment-qr-preview">{imageURL && !broken ? <img src={imageURL} alt="全站微信收款二维码预览" onError={() => setBroken(true)}/> : <div className="payment-qr-empty"><ImagePlus size={26} aria-hidden="true"/><span>{broken ? '收款码暂时无法显示，请重新上传' : '尚未上传真实收款码'}</span></div>}</div>
    <div className="payment-qr-controls"><div><strong>全站共用微信收款二维码</strong><p>请上传真实收款码。JPEG、PNG 或 WebP，最多 {local ? '1' : '3'} MiB，保留完整二维码和四周留白。</p><p>{local ? '图片仅保存在当前浏览器草稿。' : '上传后保存全站设置生效；付款窗口会提示“付款时请备注姓名”。'}</p></div><button type="button" className="btn" disabled={disabled || busy} onClick={() => input.current?.click()}>{busy ? '正在上传…' : imageURL ? '更换收款码' : '上传收款码'}</button><input ref={input} id={inputId} className="payment-qr-file" aria-label="微信收款码文件" type="file" accept="image/jpeg,image/png,image/webp" disabled={disabled || busy} onChange={event => { upload(event.target.files?.[0]); event.target.value = ''; }}/>{imageURL && <button type="button" className="payment-qr-remove" disabled={disabled || busy} onClick={() => { setImageURL(''); setBroken(false); setError(''); onValueChange?.(''); }}>移除收款码</button>}</div>
    {busy && <p className="payment-qr-status" role="status">正在处理收款码，请稍候再保存设置。</p>}
    {error && <p className="payment-qr-error" role="alert">{error}</p>}
  </section>;
}
