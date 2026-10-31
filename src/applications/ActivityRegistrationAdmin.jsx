import { useEffect, useRef, useState } from 'react';
import { supabase } from '../backend.js';
import { createPortal } from 'react-dom';
import { readActivityRegistrations, setApplicationPayment, setApplicationInsurance, readInsuranceExport, prepareActivityCleanup, confirmActivityCleanup, executeActivityCleanup, verifyRegistrationAdmin, isAdminIdentityError } from './admin-registration.js';
import PaymentProofImage from '../payments/PaymentProofImage.jsx';
import { PAYMENT_STATUSES, paymentLabel } from '../payments/status.js';
import '../payments/payment-status.css';
import './admin-registration.css';
const selectionLabel = value => ({ confirmed: '入选', waitlisted: '候补', withdrawn: '已退出', unconfirmed: '名额待确认' }[value] || '待确认');
function timeLabel(value) { const date = new Date(value); return value && Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { hour12: false }) : '时间未记录'; }
function currentProofId(row) { return Object.hasOwn(row, 'currentPaymentProofId') ? row.currentPaymentProofId : row.paymentProofs?.[0]?.id || null; }
function ConfirmationDialog({ title, children, confirmLabel, onConfirm, onCancel, busy }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement, node = ref.current;
    if (node.showModal) node.showModal(); else node.setAttribute('open','');
    node.querySelector('button')?.focus();
    return () => { if (node.close) node.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  return createPortal(<dialog ref={ref} className="registration-confirm" aria-labelledby="registration-confirm-title" onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }} onKeyDown={event => { event.stopPropagation(); if(event.key==='Escape'){event.preventDefault();if(!busy)onCancel();} if(event.key==='Tab'){const buttons=[...ref.current.querySelectorAll('button:not(:disabled)')],first=buttons[0],last=buttons.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}} }}><h3 id="registration-confirm-title">{title}</h3>{children}<div className="registration-confirm-actions"><button type="button" disabled={busy} onClick={onCancel}>取消</button><button type="button" disabled={busy} onClick={onConfirm}>{confirmLabel}</button></div></dialog>, document.body);
}
const retentionLabel = status => ({waiting:'等待到期清理',cleaning:'正在清理',verifying:'正在核验（尚未完成）',completed:'清理已完成',missing_end:'清理时间待确认'}[status] || '清理状态暂不可用');
const accessBlocked = (state, now = Date.now()) => ['cleaning','verifying','completed'].includes(state?.retention?.status) || Boolean(state?.retention?.dueAt && Date.parse(state.retention.dueAt) <= now);
const rowName = row => row.realName || row.displayName || row.username || '未设置姓名';
export default function ActivityRegistrationAdmin({ activity, onClose, local = false }) {
  const [state, setState] = useState(null), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [revision, setRevision] = useState(0);
  const [now, setNow] = useState(Date.now);
  const [confirmation, setConfirmation] = useState(null), [notice, setNotice] = useState('');
  const [proofApplicationId, setProofApplicationId] = useState(null), [selectedProofId, setSelectedProofId] = useState(null);
  const dialog = useRef(null), close = useRef(onClose), generation = useRef(0);
  close.current = onClose;
  const latestState = useRef(state); latestState.current = state;
  function invalidateIdentity() {
    generation.current++; latestState.current = null; setState(null); setConfirmation(null); setNotice(''); setProofApplicationId(null); setSelectedProofId(null); setBusy(false); setLoading(false); setError('管理员登录状态已变化，请重新加载报名名单核实身份。');
  }
  const unavailable = local || activity?.localDraft || activity?.isDemo || activity?.payload?.isDemo;
  useEffect(() => {
    const previous = document.activeElement;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.querySelector('button')?.focus();
    function keydown(event) {
      if (document.querySelector('dialog[open]')) return;
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
    setState(null); setConfirmation(null); setNotice(''); setProofApplicationId(null); setSelectedProofId(null); setError(''); setBusy(false);
    if (unavailable) { setLoading(false); return () => { alive = false; generation.current++; }; }
    setLoading(true);
    readActivityRegistrations(supabase, activity?.id).then(data => { if (alive && current === generation.current) setState(data); }).catch(caught => { if (alive && current === generation.current) setError(caught.message); }).finally(() => { if (alive && current === generation.current) setLoading(false); });
    const subscription = supabase?.auth?.onAuthStateChange?.(event => { if (event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') return; generation.current++; setState(null); setConfirmation(null); setNotice(''); setProofApplicationId(null); setSelectedProofId(null); setBusy(false); setLoading(false); setError('登录状态已变化，请重新加载报名名单。'); })?.data?.subscription;
    return () => { alive = false; generation.current++; subscription?.unsubscribe(); };
  }, [activity?.id, unavailable, revision]);
  async function changePayment(row, value) {
    if (busy || loading || sensitiveBlocked || value === row.paymentStatus) return;
    const current = generation.current;
    setBusy(true); setError('');
    try { const updated = await setApplicationPayment(supabase, { applicationId: row.id, paymentStatus: value, expectedPaymentStatus: row.paymentStatus, expectedUserId: state.viewerId, expectedProofId: currentProofId(row) }); if (current === generation.current) setState(updated); }
    catch (caught) { if (current === generation.current) { if(isAdminIdentityError(caught)) invalidateIdentity(); else setError(caught.message); } }
    finally { if (current === generation.current) setBusy(false); }
  }
  const rows = [...(state?.applications || [])].sort((a, b) => String(a.registeredAt).localeCompare(String(b.registeredAt)));
  const sensitiveBlocked = accessBlocked(state, now);
  useEffect(() => {
    const due = Date.parse(state?.retention?.dueAt);
    if (!Number.isFinite(due) || due <= now) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.min(Math.max(0,due-Date.now()),2147483647));
    return () => clearTimeout(timer);
  }, [state?.retention?.dueAt, now]);
  useEffect(() => {
    if (!confirmation?.token) return;
    const remaining = Date.parse(confirmation.token.expiresAt) - Date.now();
    const timer = setTimeout(() => { setConfirmation(null); setError('清理确认已过期，请重新发起。'); }, Math.max(0,Math.min(remaining,2147483647)));
    return () => clearTimeout(timer);
  }, [confirmation]);
  async function perform(operation, apply) {
    if (busy || loading) return;
    const current=generation.current; setBusy(true);setError('');setNotice('');
    try { const result=await operation(); if(current===generation.current) apply(result); }
    catch (caught) { if(current===generation.current){if(isAdminIdentityError(caught)) invalidateIdentity(); else {setConfirmation(null);setError('操作未完成，确认可能已过期或资料、身份已变化。请重新加载后核对。');}} }
    finally { if(current===generation.current)setBusy(false); }
  }
  function insuranceChange(row,value) {
    if(busy||sensitiveBlocked||value===(row.insuranceStatus||'uninsured'))return;
    if(value==='insured')setConfirmation({kind:'insurance',row});
    else saveInsurance(row,value);
  }
  function saveInsurance(row,value){return perform(()=>setApplicationInsurance(supabase,{applicationId:row.id,insuranceStatus:value,expectedInsuranceStatus:row.insuranceStatus||'uninsured',expectedUserId:state.viewerId,expectedDetailsUpdatedAt:row.detailsUpdatedAt}),updated=>{setState(updated);setConfirmation(null);});}
  function prepareCleanup(){return perform(()=>prepareActivityCleanup(supabase,{activityId:activity.id,expectedUserId:state.viewerId}),token=>setConfirmation({kind:'cleanup1',token}));}
  function confirmCleanup(){return perform(()=>confirmActivityCleanup(supabase,{confirmation:confirmation.token,expectedUserId:state.viewerId}),token=>setConfirmation({kind:'cleanup2',token}));}
  function executeCleanup(){return perform(()=>executeActivityCleanup(supabase,{confirmation:confirmation.token,expectedUserId:state.viewerId}),updated=>{setState(updated);setConfirmation(null);setProofApplicationId(null);setSelectedProofId(null);});}
  async function exportInsurance() {
    if(busy||sensitiveBlocked)return;
    const current=generation.current,viewerId=state.viewerId,cleanupEpoch=state.retention?.clearedAt ?? null;setBusy(true);setError('');setNotice('');
    let data;
    try {
      data=await readInsuranceExport(supabase,{activityId:activity.id,expectedUserId:viewerId});
      const writer=await import('./insurance-export.js');
      if(current!==generation.current)return;
      // Recheck time after every asynchronous boundary, including the final identity check.
      if(accessBlocked(state) || accessBlocked(latestState.current)) throw new Error();
      const fresh=await readActivityRegistrations(supabase,activity.id);
      if(current!==generation.current)return;
      if(fresh.viewerId!==viewerId) { const error=new Error();error.code='IDENTITY_CHANGED';throw error; }
      await verifyRegistrationAdmin(supabase,viewerId);
      if(current!==generation.current)return;
      setState(fresh);
      if(accessBlocked(state) || accessBlocked(latestState.current) || accessBlocked(fresh)) throw new Error();
      // A manual cleanup can finish and reopen waiting before this export returns.
      // Compare the original timestamp verbatim, preserving microsecond precision.
      if([latestState.current,fresh].some(snapshot=>(snapshot?.retention?.clearedAt ?? null)!==cleanupEpoch)) throw new Error();
      const missing=data.rows.filter(row=>!row.detailsComplete||!row.realName||!row.idNumber||!row.phone);
      setNotice(missing.length?`已导出有效入选者；${missing.length} 人资料缺失：${missing.map(row=>`${row.realName||'未设置姓名'}（${[!row.realName&&'姓名',!row.idNumber&&'身份证号',!row.phone&&'手机号'].filter(Boolean).join('、')||'资料待核实'}）`).join('；')}`:'已导出有效入选者保险名单。');
      writer.downloadInsuranceWorkbook(data);
    } catch (caught) { if(current===generation.current){ if(isAdminIdentityError(caught)) invalidateIdentity(); else setError('导出未完成，活动可能已结束或资料已清理，请重新加载后重新导出。'); } }
    finally { if(data) data.rows.length=0;data=null;if(current===generation.current)setBusy(false); }
  }
  const proofRow = rows.find(row => row.id === proofApplicationId);
  const selectedProof = proofRow?.paymentProofs?.find(proof => proof.id === selectedProofId);
  const reviewingHistory = Boolean(proofRow && selectedProof && selectedProof.id !== currentProofId(proofRow));
  function openProofs(row) { if(sensitiveBlocked)return; setProofApplicationId(row.id); setSelectedProofId(currentProofId(row) || row.paymentProofs?.[0]?.id || null); }

  return <div className="registration-admin-backdrop"><section className="registration-admin" role="dialog" aria-modal="true" aria-labelledby="registration-admin-title" ref={dialog}>
    <header><div><h2 id="registration-admin-title">{activity?.payload?.title || activity?.title || '未命名活动'} · 报名管理</h2></div><button type="button" onClick={onClose} aria-label="关闭报名管理">关闭</button></header>
    {unavailable ? <p role="status">本地草稿或设计示例不能管理真实报名。请使用已保存的正式活动。</p> : <>
      <div className="registration-admin-toolbar"><span>报名名单</span><div><button type="button" disabled={loading || busy || !state || sensitiveBlocked} onClick={exportInsurance}>导出保险 Excel</button> <button type="button" disabled={loading || busy} onClick={() => setRevision(value => value + 1)}>重新加载</button></div></div>
      {loading && <p role="status">正在加载报名名单…</p>}
      {error && <p className="registration-admin-error" role="alert">{error}</p>}
      {busy && <p role="status">正在处理，请稍候…</p>}
      {notice && <p role="status">{notice}</p>}
      {state && <><dl className="registration-admin-stats">{[['活动名额', state.capacity ?? '未设置'], ['有效报名', state.activeCount], ['入选', state.confirmedCount], ['候补', state.waitlistCount], ['已退出', rows.filter(row => row.status === 'withdrawn').length]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <><p className="registration-admin-note">按有效报名时间排序。姓名左侧白、蓝、绿圆点分别表示未缴费、应已缴费、已缴费；应已缴费须管理员核实。</p>{!rows.length ? <p>暂无报名记录。</p> : <div className="registration-admin-scroll" tabIndex={0} role="region" aria-label="报名名单，可横向滚动"><table><thead><tr><th>报名人员</th><th>报名时间</th><th>当前排位 / 名额</th><th>参与状态</th><th>缴费状态</th><th>缴费记录</th><th>保险状态</th><th>保险资料</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td><strong className="registration-admin-person"><span className={`payment-status-dot payment-status-${row.paymentStatus}`} role="img" aria-label={paymentLabel(row.paymentStatus)}/>{rowName(row)}</strong><small>{row.username || row.displayName || '用户名未设置'}</small><small>{row.email || '邮箱未提供'}</small></td><td><time dateTime={row.registeredAt}>{timeLabel(row.registeredAt)}</time></td><td>{row.position ?? '—'} / {state.capacity ?? '未设置'}</td><td>{selectionLabel(row.selectionStatus)}</td><td><select className={`payment-status-${row.paymentStatus}`} aria-label={`${row.displayName || row.userId}的缴费状态`} value={row.paymentStatus} disabled={busy || loading || sensitiveBlocked || Boolean(reviewingHistory && proofRow.id === row.id)} onChange={event => changePayment(row, event.target.value)}>{PAYMENT_STATUSES.map(value => <option key={value} value={value}>{paymentLabel(value)}</option>)}</select></td><td className="registration-admin-proof-cell">{row.paymentProofs?.length ? <><button type="button" aria-controls="registration-proof-viewer" aria-expanded={proofApplicationId === row.id} disabled={busy || sensitiveBlocked} onClick={() => openProofs(row)}>查看缴费记录（{row.paymentProofs.length}）</button><small>最新提交：{timeLabel(row.paymentProofs[0].submittedAt)}</small></> : <span>{row.proofsPurgedAt ? '记录图片已清理' : sensitiveBlocked ? '记录图片已封存' : '尚未提交'}</span>}</td><td><select aria-label={`${row.displayName || row.userId}的保险状态`} value={row.insuranceStatus || 'uninsured'} disabled={busy || loading || sensitiveBlocked} onChange={event => insuranceChange(row,event.target.value)}><option value="uninsured">未购买</option><option value="insured" disabled={row.status !== 'active' || row.selectionStatus !== 'confirmed' || !row.detailsComplete}>已购买</option></select></td><td>{sensitiveBlocked ? '活动资料已封存' : row.detailsComplete ? '完整' : '保险资料待补全'}</td></tr>)}</tbody></table></div>}
      {!sensitiveBlocked && proofRow && selectedProof && <section className="registration-admin-proof-review" id="registration-proof-viewer" aria-label="缴费记录查看"><div className="registration-admin-proof-heading"><h3>{proofRow.displayName || proofRow.userId}的缴费记录</h3><button type="button" onClick={() => { setProofApplicationId(null); setSelectedProofId(null); }}>关闭记录</button></div><div className="registration-admin-proof-history" role="group" aria-label="缴费记录历史">{proofRow.paymentProofs.map(proof => <button type="button" key={proof.id} aria-pressed={selectedProof.id === proof.id} onClick={() => setSelectedProofId(proof.id)}>{proof.id === currentProofId(proofRow) ? '最新记录' : '历史记录'} · {timeLabel(proof.submittedAt)}</button>)}</div>{reviewingHistory && <p className="registration-admin-note">当前查看的是历史图片。请切回最新记录后审核缴费状态。</p>}<PaymentProofImage key={`${state.viewerId}:${selectedProof.id}`} proof={selectedProof} expectedUserId={state.viewerId}/></section>}
      </>
      <section className="registration-admin-retention" aria-label="活动资料清理"><h3>活动资料清理</h3><p role="status">{retentionLabel(state.retention?.status)}</p>{state.retention?.dueAt && <p>到期时间：{timeLabel(state.retention.dueAt)}</p>}{state.retention?.lastCheckedAt && <p>最近核验：{timeLabel(state.retention.lastCheckedAt)} · 连续通过 {state.retention.consecutiveEmptyChecks ?? 0} 轮</p>}{state.retention?.clearedAt && <p>上次清除：{timeLabel(state.retention.clearedAt)}</p>}<button type="button" disabled={busy || loading || !state.retention?.manualAllowed} onClick={prepareCleanup}>手动清理活动资料</button><p className="registration-admin-note">从报名开启起可手动清理，仅删除本次活动身份证号、活动手机号及缴费图片；个人设置手机号、姓名快照与操作历史保留。清理期间暂缓敏感操作，未结束活动清理完成后可主动填写新资料。</p></section>
      <p className="registration-admin-note">Excel 仅含有效入选者，仅用于本次活动保险及紧急联系。下载文件请在用途完成后自行清理，网站无法撤销本地文件。</p>
      <p className="registration-admin-note">名单、邮箱与缴费信息仅供协会管理员查看。</p></>}
    </>}
  </section>{confirmation && <ConfirmationDialog key={confirmation.kind} title={confirmation.kind==='insurance'?'确认保险已购买':confirmation.kind==='cleanup1'?'第一次确认：核对清理范围':'第二次确认：永久删除'} busy={busy} onCancel={()=>setConfirmation(null)} confirmLabel={confirmation.kind==='insurance'?'确认已购买':confirmation.kind==='cleanup1'?'确认范围，继续':'永久删除活动资料及缴费图片'} onConfirm={confirmation.kind==='insurance'?()=>saveInsurance(confirmation.row,'insured'):confirmation.kind==='cleanup1'?confirmCleanup:executeCleanup}>
    <p>活动：{activity?.payload?.title || activity?.title || '未命名活动'}</p>
    {confirmation.kind==='insurance'?<p>确认已为 {rowName(confirmation.row)} 购买本次活动保险？</p>:<><p>报名 {confirmation.token.applicationCount} 人，活动资料 {confirmation.token.detailsCount} 份，缴费图片 {confirmation.token.proofCount} 张。</p><p>永久删除活动身份证号、活动手机号及缴费图片，无法恢复。保留个人设置手机号、报名历史、姓名快照及操作日志。</p><p>确认有效期至 {timeLabel(confirmation.token.expiresAt)}。已下载的 Excel 不在清理范围内。</p></>}
  </ConfirmationDialog>}</div>;
}
