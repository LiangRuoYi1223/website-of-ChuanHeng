import { useEffect, useRef, useState } from 'react';
import { supabase } from '../backend.js';
import { readActivityRegistrations, setApplicationPayment } from './admin-registration.js';
import PaymentProofImage from '../payments/PaymentProofImage.jsx';
import { PAYMENT_STATUSES, paymentLabel } from '../payments/status.js';
import '../payments/payment-status.css';
import './admin-registration.css';
const selectionLabel = value => ({ confirmed: '入选', waitlisted: '候补', withdrawn: '已退出', unconfirmed: '名额待确认' }[value] || '待确认');
const actionLabel = value => ({ registered: '报名', rejoined: '重新报名', withdrawn: '退出', payment_changed: '缴费变更', payment_proof_submitted: '提交缴费记录', capacity_changed: '名额变更' }[value] || value);
const sourceLabel = value => ({ self_service: '会员自助', manual: '管理员手动', automatic: '自动（预留）' }[value] || '未知');
function timeLabel(value) { const date = new Date(value); return value && Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { hour12: false }) : '时间未记录'; }
function eventDetails(event) {
  const details = event.details || {};
  if (event.action === 'payment_changed' || event.action === 'payment_proof_submitted') return `${paymentLabel(details.paymentStatus?.before ?? details.previousPaymentStatus ?? details.oldPaymentStatus ?? details.before?.paymentStatus ?? details.before)} → ${paymentLabel(details.paymentStatus?.after ?? (typeof details.paymentStatus === 'string' ? details.paymentStatus : null) ?? details.newPaymentStatus ?? details.after?.paymentStatus ?? details.after)}`;
  if (event.action === 'capacity_changed') return `${details.capacity?.before ?? details.previousCapacity ?? details.oldCapacity ?? details.before?.capacity ?? details.before ?? '未设置'} → ${details.capacity?.after ?? (typeof details.capacity === 'number' ? details.capacity : null) ?? details.newCapacity ?? details.after?.capacity ?? details.after ?? '未设置'}`;
  if (['registered', 'withdrawn', 'rejoined'].includes(event.action)) {
    const statusLabel = value => value == null ? '无记录' : ({ active: '有效报名', withdrawn: '已退出' }[value] || value);
    const parts = [];
    if (details.status) parts.push(`报名状态：${statusLabel(details.status.before)} → ${statusLabel(details.status.after)}`);
    if (typeof details.registeredAt === 'string') parts.push(`报名时间：${timeLabel(details.registeredAt)}`);
    else if (details.registeredAt) parts.push(`报名时间：${timeLabel(details.registeredAt.before)} → ${timeLabel(details.registeredAt.after)}`);
    return parts.join('；');
  }
  return '';
}
function currentProofId(row) { return Object.hasOwn(row, 'currentPaymentProofId') ? row.currentPaymentProofId : row.paymentProofs?.[0]?.id || null; }
function compareEvents(a, b) {
  const byTime = String(b.occurredAt).localeCompare(String(a.occurredAt));
  if (byTime || !/^\d+$/.test(String(a.id)) || !/^\d+$/.test(String(b.id))) return byTime;
  return BigInt(a.id) < BigInt(b.id) ? 1 : BigInt(a.id) > BigInt(b.id) ? -1 : 0;
}
export default function ActivityRegistrationAdmin({ activity, onClose, local = false }) {
  const [state, setState] = useState(null), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [revision, setRevision] = useState(0), [view, setView] = useState('roster');
  const [proofApplicationId, setProofApplicationId] = useState(null), [selectedProofId, setSelectedProofId] = useState(null);
  const dialog = useRef(null), close = useRef(onClose), generation = useRef(0);
  close.current = onClose;
  const unavailable = local || activity?.localDraft || activity?.isDemo || activity?.payload?.isDemo;
  useEffect(() => {
    const previous = document.activeElement;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.querySelector('button')?.focus();
    function keydown(event) {
      if (event.key === 'Escape') { event.preventDefault(); close.current?.(); return; }
      if (event.key !== 'Tab') return;
      const elements = [...(dialog.current?.querySelectorAll('button:not(:disabled),select:not(:disabled),a[href],[tabindex="0"]') || [])];
      const first = elements[0], last = elements.at(-1);
      if (event.shiftKey && (document.activeElement === first || !dialog.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.current?.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
    }
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); document.body.style.overflow = oldOverflow; if (previous?.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    let alive = true;
    const current = ++generation.current;
    setState(null); setProofApplicationId(null); setSelectedProofId(null); setError(''); setBusy(false);
    if (unavailable) { setLoading(false); return () => { alive = false; generation.current++; }; }
    setLoading(true);
    readActivityRegistrations(supabase, activity?.id).then(data => { if (alive && current === generation.current) setState(data); }).catch(caught => { if (alive && current === generation.current) setError(caught.message); }).finally(() => { if (alive && current === generation.current) setLoading(false); });
    const subscription = supabase?.auth?.onAuthStateChange?.(event => { if (event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') return; generation.current++; setState(null); setBusy(false); setLoading(false); setError('登录状态已变化，请重新加载报名名单。'); })?.data?.subscription;
    return () => { alive = false; generation.current++; subscription?.unsubscribe(); };
  }, [activity?.id, unavailable, revision]);
  async function changePayment(row, value) {
    if (busy || loading || value === row.paymentStatus) return;
    const current = generation.current;
    setBusy(true); setError('');
    try { const updated = await setApplicationPayment(supabase, { applicationId: row.id, paymentStatus: value, expectedPaymentStatus: row.paymentStatus, expectedUserId: state.viewerId, expectedProofId: currentProofId(row) }); if (current === generation.current) setState(updated); }
    catch (caught) { if (current === generation.current) setError(caught.message); }
    finally { if (current === generation.current) setBusy(false); }
  }
  const rows = [...(state?.applications || [])].sort((a, b) => String(a.registeredAt).localeCompare(String(b.registeredAt)));
  const events = [...(state?.events || [])].sort(compareEvents);
  const proofRow = rows.find(row => row.id === proofApplicationId);
  const selectedProof = proofRow?.paymentProofs?.find(proof => proof.id === selectedProofId);
  const reviewingHistory = Boolean(proofRow && selectedProof && selectedProof.id !== currentProofId(proofRow));
  function openProofs(row) { setProofApplicationId(row.id); setSelectedProofId(currentProofId(row) || row.paymentProofs?.[0]?.id || null); }

  return <div className="registration-admin-backdrop"><section className="registration-admin" role="dialog" aria-modal="true" aria-labelledby="registration-admin-title" ref={dialog}>
    <header><div><h2 id="registration-admin-title">{activity?.payload?.title || activity?.title || '未命名活动'} · 报名管理</h2></div><button type="button" onClick={onClose} aria-label="关闭报名管理">关闭</button></header>
    {unavailable ? <p role="status">本地草稿或设计示例不能管理真实报名。请使用已保存的正式活动。</p> : <>
      <div className="registration-admin-toolbar"><nav aria-label="报名管理视图"><button type="button" aria-pressed={view === 'roster'} onClick={() => setView('roster')}>报名名单</button><button type="button" aria-pressed={view === 'events'} onClick={() => setView('events')}>操作日志</button></nav><button type="button" disabled={loading || busy} onClick={() => setRevision(value => value + 1)}>重新加载</button></div>
      {loading && <p role="status">正在加载报名名单…</p>}
      {error && <p className="registration-admin-error" role="alert">{error}</p>}
      {busy && <p role="status">正在保存缴费状态，请稍候…</p>}
      {state && <><dl className="registration-admin-stats">{[['活动名额', state.capacity ?? '未设置'], ['有效报名', state.activeCount], ['入选', state.confirmedCount], ['候补', state.waitlistCount], ['已退出', rows.filter(row => row.status === 'withdrawn').length]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      {view === 'roster' ? <><p className="registration-admin-note">按有效报名时间排序。蓝色“应已缴费”表示待核实，管理员查看记录并核实后再标记绿色“已缴费”。</p>{!rows.length ? <p>暂无报名记录。</p> : <div className="registration-admin-scroll" tabIndex={0} role="region" aria-label="报名名单，可横向滚动"><table><thead><tr><th>报名人员</th><th>报名时间</th><th>当前排位 / 名额</th><th>参与状态</th><th>缴费状态</th><th>缴费记录</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td><strong>{row.displayName || row.userId}</strong><small>{row.email || '邮箱未提供'}</small></td><td><time dateTime={row.registeredAt}>{timeLabel(row.registeredAt)}</time></td><td>{row.position ?? '—'} / {state.capacity ?? '未设置'}</td><td>{selectionLabel(row.selectionStatus)}</td><td><select className={`payment-status-${row.paymentStatus}`} aria-label={`${row.displayName || row.userId}的缴费状态`} value={row.paymentStatus} disabled={busy || loading || Boolean(reviewingHistory && proofRow.id === row.id)} onChange={event => changePayment(row, event.target.value)}>{PAYMENT_STATUSES.map(value => <option key={value} value={value}>{paymentLabel(value)}</option>)}</select></td><td className="registration-admin-proof-cell">{row.paymentProofs?.length ? <><button type="button" aria-controls="registration-proof-viewer" aria-expanded={proofApplicationId === row.id} onClick={() => openProofs(row)}>查看缴费记录（{row.paymentProofs.length}）</button><small>最新提交：{timeLabel(row.paymentProofs[0].submittedAt)}</small></> : <span>尚未提交</span>}</td></tr>)}</tbody></table></div>}
      {proofRow && selectedProof && <section className="registration-admin-proof-review" id="registration-proof-viewer" aria-label="缴费记录查看"><div className="registration-admin-proof-heading"><h3>{proofRow.displayName || proofRow.userId}的缴费记录</h3><button type="button" onClick={() => { setProofApplicationId(null); setSelectedProofId(null); }}>关闭记录</button></div><div className="registration-admin-proof-history" role="group" aria-label="缴费记录历史">{proofRow.paymentProofs.map(proof => <button type="button" key={proof.id} aria-pressed={selectedProof.id === proof.id} onClick={() => setSelectedProofId(proof.id)}>{proof.id === currentProofId(proofRow) ? '最新记录' : '历史记录'} · {timeLabel(proof.submittedAt)}</button>)}</div>{reviewingHistory && <p className="registration-admin-note">当前查看的是历史图片。请切回最新记录后审核缴费状态。</p>}<PaymentProofImage key={`${state.viewerId}:${selectedProof.id}`} proof={selectedProof} expectedUserId={state.viewerId}/></section>}
      </> : <><p className="registration-admin-note">按时间倒序展示；automatic 仅为预留来源。</p>{!events.length ? <p>暂无操作日志。</p> : <ol className="registration-admin-events">{events.map(event => <li key={event.id}><div><strong>{actionLabel(event.action)}</strong><time dateTime={event.occurredAt}>{timeLabel(event.occurredAt)}</time></div><p>对象：{event.subjectLabel || event.subjectUserId || (event.action === 'capacity_changed' ? '本活动' : '未记录')}</p><p>操作者：{event.actorLabel || event.actorId || '系统'} · {sourceLabel(event.source)}（{event.source}）</p>{eventDetails(event) && <p>{eventDetails(event)}</p>}</li>)}</ol>}</>}
      <p className="registration-admin-note">名单、邮箱与缴费信息仅供协会管理员查看。</p></>}
    </>}
  </section></div>;
}
