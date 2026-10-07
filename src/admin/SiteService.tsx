import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Power, RefreshCw, X } from 'lucide-react';
import { api, ApiError } from '../api';
import { useSiteStatus } from '../auth/SiteStatusContext';
import type { SiteStatus, User } from '../types';

type Confirmation = { paused: boolean; revision: number };

export function SiteService({ user }: { user: User }) {
  const { status, checking, error, refresh, setStatus } = useSiteStatus();
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [password, setPassword] = useState(''), [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState(''), [notice, setNotice] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null), passwordRef = useRef<HTMLInputElement>(null);
  const requestVersion = useRef(0), titleId = useId(), descriptionId = useId();
  const isPresident = user.role === 'admin' && user.isPresident && !user.mustChangePassword;
  const userScope = JSON.stringify([user.id, user.role, user.isPresident, Boolean(user.mustChangePassword)]);
  const latestScope = useRef(userScope);
  latestScope.current = userScope;
  const stale = !!confirmation && (!status || status.revision !== confirmation.revision);

  useEffect(() => {
    setConfirmation(null); setPassword(''); setDialogError(''); setNotice(''); setBusy(false);
    return () => { requestVersion.current++; };
  }, [userScope]);
  useEffect(() => {
    if (!confirmation || !isPresident) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    passwordRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [confirmation, isPresident]);
  useEffect(() => {
    if (!confirmation || !isPresident) return;
    if (busy) dialogRef.current?.focus();
    else passwordRef.current?.focus();
  }, [busy, confirmation, isPresident]);

  function openDialog() {
    if (!status || checking || busy || !isPresident) return;
    setPassword(''); setDialogError(''); setNotice('');
    setConfirmation({ paused: !status.paused, revision: status.revision });
  }
  function closeDialog() {
    if (busy) return;
    setConfirmation(null); setPassword(''); setDialogError('');
  }
  function dialogKeys(event: KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeDialog(); }
    if (event.key !== 'Tab') return;
    const elements = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled])') ?? []).filter(element => element.offsetParent !== null);
    const first = elements[0], last = elements[elements.length - 1];
    if (!first) { event.preventDefault(); dialogRef.current?.focus(); return; }
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!confirmation || !password || busy || stale || !isPresident) return;
    const scope = userScope, request = ++requestVersion.current;
    setBusy(true); setDialogError('');
    try {
      const next = await api<SiteStatus>('/admin/site-status', { method: 'POST', body: JSON.stringify({ ...confirmation, password }) });
      if (latestScope.current !== scope || requestVersion.current !== request) return;
      setStatus(next); setPassword('');
      await refresh();
      if (latestScope.current !== scope || requestVersion.current !== request) return;
      setBusy(false); setConfirmation(null);
      setNotice(next.paused ? '网站已关停，公开页面显示维护提示。' : '网站已重启，公开页面恢复正常。');
    } catch (failure) {
      if (latestScope.current !== scope || requestVersion.current !== request) return;
      setPassword('');
      setDialogError(failure instanceof Error ? failure.message : '操作失败，请重试。');
      if (failure instanceof ApiError && failure.status === 409) await refresh();
      passwordRef.current?.focus();
    } finally {
      if (latestScope.current === scope && requestVersion.current === request) setBusy(false);
    }
  }

  return <section className="admin-panel admin-site-service">
    <div className="admin-toolbar"><div><h2>网站服务</h2><p className="admin-help">{isPresident ? '关停后公开页面显示维护提示，管理后台仍可登录。' : '网站服务的关停与重启由社长操作。'}</p></div><span className="admin-status" data-status={status?.paused ? 'paused' : undefined}>{status ? status.paused ? '已关停' : '正常运行' : checking ? '正在检查…' : '状态未确认'}</span></div>
    {error && <p className="admin-alert" role="alert">{error}</p>}
    {notice && <p className="admin-alert admin-success" role="status">{notice}</p>}
    {isPresident && <div className="admin-actions">
      <button type="button" className={`admin-button ${status?.paused ? 'admin-primary' : 'admin-danger'}`} disabled={!status || checking || busy} onClick={openDialog}><Power size={17} />{status?.paused ? '重启网站' : '关停网站'}</button>
      <button type="button" className="admin-button admin-secondary" disabled={checking || busy} onClick={() => { setNotice(''); void refresh(); }}><RefreshCw size={16} />{checking ? '正在刷新…' : '刷新状态'}</button>
    </div>}
    {confirmation && isPresident && <div className="admin-modal" onKeyDown={dialogKeys}>
      <div ref={dialogRef} className="admin-modal-card admin-service-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} aria-busy={busy} tabIndex={-1}>
        <div className="admin-toolbar"><h2 id={titleId}>{confirmation.paused ? '确认关停网站' : '确认重启网站'}</h2><button type="button" className="admin-icon-button" aria-label="关闭确认" disabled={busy} onClick={closeDialog}><X size={20} /></button></div>
        <p id={descriptionId} className="admin-help">{confirmation.paused ? '确认后，公开页面将显示维护提示。输入你自己的登录密码以继续。' : '确认后，网站公开页面将恢复访问。输入你自己的登录密码以继续。'}</p>
        <form className="admin-form" onSubmit={submit}>
          <label className="admin-field">你的登录密码<input ref={passwordRef} type="password" autoComplete="current-password" required value={password} disabled={busy} onChange={event => { setPassword(event.target.value); setDialogError(''); }} /></label>
          {dialogError && <p className="admin-alert" role="alert">{dialogError}</p>}
          {stale && !busy && <p className="admin-alert" role="alert">网站状态已更新，请关闭此窗口后重新发起操作。</p>}
          <div className="admin-actions"><button type="button" className="admin-button admin-secondary" disabled={busy} onClick={closeDialog}>取消</button><button type="submit" className={`admin-button ${confirmation.paused ? 'admin-danger' : 'admin-primary'}`} disabled={!password || busy || stale}>{busy ? '正在确认…' : confirmation.paused ? '确认关停' : '确认重启'}</button></div>
        </form>
      </div>
    </div>}
  </section>;
}
