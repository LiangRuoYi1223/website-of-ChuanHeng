import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../api';
import type { SiteSettings } from '../types';

type TextKey = Exclude<keyof SiteSettings, 'growthSteps' | 'revision' | 'demoMode'>;
const errorText = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试。';
function dataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('图片读取失败。'));
    reader.onerror = () => reject(new Error('图片读取失败，请重新选择。'));
    reader.onabort = () => reject(new Error('图片读取已取消。'));
    reader.readAsDataURL(file);
  });
}
function UploadField({ label, value, onChange, onError, onBusy, canUpload }: { label: string; value: string; onChange: (url: string) => void; onError: (message: string) => void; onBusy: (busy: boolean) => void; canUpload: boolean }) {
  const [uploading, setUploading] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  return <div className="admin-field admin-image-field">
    <label>{label}<input value={value} placeholder="图片路径或 https:// 链接" onChange={event => onChange(event.target.value)} disabled={uploading} /></label>
    {value && <img src={value} alt={`${label}预览`} style={{ width: 130, height: 78, objectFit: 'cover', borderRadius: 4 }} />}
    {canUpload && <><button type="button" className="admin-button admin-secondary" disabled={uploading} onClick={() => picker.current?.click()}>
      {uploading ? '上传中…' : '选择并上传图片'}
    </button>
      <input ref={picker} type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} style={{ display: 'none' }} onChange={async event => {
        const input = event.currentTarget, file = input.files?.[0];
        if (!file || !canUpload) return;
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || !file.size || file.size > 8 * 1024 * 1024) {
          onError('请选择不超过 8 MB 的 JPEG、PNG 或 WebP 图片。'); input.value = ''; return;
        }
        setUploading(true); onBusy(true);
        try { const result = await api<{ url: string }>('/admin/upload', { method: 'POST', body: JSON.stringify({ filename: file.name, dataUrl: await dataUrl(file) }) }); onChange(result.url); }
        catch (error) { onError(errorText(error)); }
        finally { setUploading(false); onBusy(false); input.value = ''; }
      }} /></>}
    <span className="admin-help">{canUpload ? 'JPEG、PNG、WebP，最大 8 MB；上传后保存本页生效。' : '图片上传尚未授权，可以填写已有图片地址。'}</span>
  </div>;
}

export function AdminSettings({ settings, onSaved, onError, canUpload }: { settings: SiteSettings; onSaved: (settings: SiteSettings) => void; onError: (message: string) => void; canUpload: boolean }) {
  const [form, setForm] = useState<SiteSettings>(settings), [saving, setSaving] = useState(false), [uploads, setUploads] = useState(0), [saved, setSaved] = useState(false), [dirty, setDirty] = useState(false);
  useEffect(() => { setForm(settings); setDirty(false); }, [settings]);
  const update = (key: TextKey, value: string) => { setDirty(true); setSaved(false); setForm(current => ({ ...current, [key]: value })); };
  const text = (key: TextKey, label: string, multiline = false, required = false) => <label className="admin-field" key={key}>{label}
    {multiline ? <textarea rows={4} value={form[key] ?? ''} onChange={event => update(key, event.target.value)} /> : <input type={key === 'contactEmail' ? 'email' : 'text'} required={required} value={form[key] ?? ''} onChange={event => update(key, event.target.value)} />}
  </label>;
  const image = (key: TextKey, label: string) => <UploadField key={key} canUpload={canUpload} label={label} value={form[key] ?? ''} onChange={value => update(key, value)} onError={onError} onBusy={busy => { if (busy) setDirty(true); setUploads(count => count + (busy ? 1 : -1)); }} />;
  async function submit(event: FormEvent) {
    event.preventDefault(); if (saving || uploads) return;
    setSaving(true); setSaved(false);
    try {
      const result = await api<{ settings: SiteSettings }>('/admin/settings', { method: 'PUT', body: JSON.stringify(form) });
      setForm(result.settings); setDirty(false); onSaved(result.settings); setSaved(true);
    } catch (error) { onError(errorText(error)); }
    finally { setSaving(false); }
  }
  return <section className="admin-panel">
    <div className="admin-toolbar"><div><h2>网站内容与素材</h2><p className="admin-help">统一编辑三页内容。保存时检查内容版本，避免多人编辑时覆盖他人的修改。</p></div></div>
    {saved && <p className="admin-alert" role="status">网站设置已保存。</p>}
    <form className="admin-form" data-dirty={dirty} onSubmit={submit}>
      <fieldset disabled={saving} style={{ border: 0, margin: 0, padding: 0 }}>
        <h3>社团介绍</h3><div className="admin-grid">{text('clubName', '社团名称', false, true)}{text('school', '所属学校', false, true)}{text('founded', '成立年份')}{text('intro', '首页简介', true)}{text('aboutDescription', '认识川衡正文', true)}</div>
        <label className="admin-field" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10 }}><input type="checkbox" checked={form.demoMode !== false} onChange={event => { setDirty(true); setSaved(false); setForm(current => ({ ...current, demoMode: event.target.checked })); }} style={{ width: 'auto' }} />显示示意素材提示</label>
        <p className="admin-help">全部影像替换为协会实拍后，可以关闭全站示意素材提示；活动与项目各自的示例标记单独编辑。</p>
        <h3>视觉素材</h3><div className="admin-grid">{image('logoUrl', '社团标志')}{image('heroActivities', '活动页首图')}{image('heroAbout', '认识川衡首图')}{image('heroTeam', '登山队首图')}{image('storyHiking', '徒步故事图片')}{image('storyClimbing', '攀登故事图片')}</div>
        <h3>公众号报名</h3><div className="admin-grid">{text('officialSignupUrl', '公众号报名链接')}{image('officialQrImage', '公众号二维码')}{text('signupInstructions', '报名说明', true)}</div>
        <h3>登山队</h3><div className="admin-grid">{text('teamDescription', '队伍介绍', true)}{text('teamTraining', '训练方向', true)}{text('teamAchievements', '训练与攀登成果', true)}</div>
        <h3>成长路径</h3><div className="admin-grid">{form.growthSteps.map((step, index) => <div className="admin-field" key={index}>
          <label>第 {index + 1} 步标题<input required value={step.title} onChange={event => { const value = event.target.value; setDirty(true); setSaved(false); setForm(current => ({ ...current, growthSteps: current.growthSteps.map((item, i) => i === index ? { ...item, title: value } : item) })); }} /></label>
          <label>说明<textarea rows={3} value={step.description} onChange={event => { const value = event.target.value; setDirty(true); setSaved(false); setForm(current => ({ ...current, growthSteps: current.growthSteps.map((item, i) => i === index ? { ...item, description: value } : item) })); }} /></label>
        </div>)}</div>
        <h3>合作与联系</h3><div className="admin-grid">{text('contactName', '联系人')}{text('contactEmail', '联系邮箱')}{text('contactWechat', '联系微信')}</div>
      </fieldset>
      <div className="admin-toolbar"><button className="admin-button admin-primary" type="submit" disabled={saving || uploads > 0}>{saving ? '保存中…' : uploads ? '等待图片上传…' : '保存网站设置'}</button><span className="admin-help">当前版本 {form.revision ?? 1}</span></div>
    </form>
  </section>;
}
