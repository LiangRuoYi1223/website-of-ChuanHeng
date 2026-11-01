import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, LoaderCircle } from 'lucide-react';
import { supabase } from '../backend.js';
import { readActivityRegistration, registrationAvailability, submitActivityApplication, withdrawActivityRegistration, saveRegistrationDetails, activitySensitiveAccess } from './registration.js';
import RegistrationDetailsDialog from './RegistrationDetailsDialog.jsx';
import PaymentDialog from '../payments/PaymentDialog.jsx';
import PaymentProofImage from '../payments/PaymentProofImage.jsx';
import { uploadPaymentProof } from '../payments/payment-proof.js';
import { paymentLabel } from '../payments/status.js';
import '../payments/payment-status.css';
import { formatActivityTime } from '../activities/schedule.js';
import { formatRegistrationFee } from '../activities/registration-fee.js';
import './application.css';

const labels = { confirmed: '入选', waitlisted: '候补', withdrawn: '已退出', unconfirmed: '名额尚未确认' };
export default function ActivityApplication({ activity, localDraft = false, children }) {
  const record = { ...activity, localDraft: localDraft || activity?.localDraft };
  const [clock, setClock] = useState(Date.now());
  const availability = registrationAvailability(record, clock);
  const [checking, setChecking] = useState(Boolean(supabase && availability.isPublic));
  const [busy, setBusy] = useState('');
  const [user, setUser] = useState(null);
  const [registration, setRegistration] = useState(null);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [detailsMode,setDetailsMode] = useState('');
  const proofRequest = useRef(null), stagedProof = useRef(null), pollingPaused = useRef(false);
  pollingPaused.current = Boolean(busy) || paymentOpen || Boolean(detailsMode);
  const authRevision = useRef(0);

  useEffect(() => {
    const end = new Date(activity?.dateEnd).getTime();
    if (!Number.isFinite(end) || end <= Date.now()) return undefined;
    const timer = window.setTimeout(() => setClock(Date.now()), Math.min(end - Date.now(), 2147483647));
    return () => window.clearTimeout(timer);
  }, [activity?.dateEnd, clock]);

  useEffect(() => {
    if (!availability.isPublic) return undefined;
    const timer = window.setInterval(() => { setClock(Date.now()); if (!pollingPaused.current) setRefresh(value => value + 1); }, 30000);
    return () => window.clearInterval(timer);
  }, [availability.isPublic]);

  useEffect(() => {
    if (!supabase || !availability.isPublic) { setChecking(false); return undefined; }
    let alive = true, revision = 0, timer;
    async function check() {
      const current = ++revision;
      const active = () => alive && current === revision;
      if (active()) { setChecking(true); setError(''); setUser(null); setRegistration(null); }
      try {
        const { data: session, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        if (!session?.session) return;
        const { data: identity, error: identityError } = await supabase.auth.getUser();
        if (identityError) throw identityError;
        const verified = identity?.user;
        if (!verified?.id || verified.is_anonymous === true) return;
        const state = await readActivityRegistration(supabase, activity.id, verified.id);
        if (active()) { setUser(verified); setRegistration({ ...state, activityId: activity.id }); }
      } catch {
        if (active()) setError('暂时无法确认账号与报名记录，请重试后再提交。');
      } finally { if (active()) setChecking(false); }
    }
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      if (!alive) return;
      revision++; authRevision.current++;
      proofRequest.current?.abort(); stagedProof.current = null; setPaymentOpen(false); setDetailsMode('');
      setBusy(''); setChecking(true); setUser(null); setRegistration(null);
      window.clearTimeout(timer); timer = window.setTimeout(check, 0);
    });
    check();
    return () => { alive = false; revision++; authRevision.current++; proofRequest.current?.abort(); stagedProof.current = null; window.clearTimeout(timer); subscription.unsubscribe(); };
  }, [activity?.id, availability.isPublic, refresh]);

  const state = registration?.activityId === activity?.id ? registration : null;
  const application = state?.application;
  const withdrawn = application?.status === 'withdrawn';
  async function mutate(action, input = {}) {
    if (busy || checking || !user || (action === 'register' && application && !withdrawn)) return;
    if (action !== 'withdraw' && !activitySensitiveAccess(record,state?.retention)) throw new Error('活动已结束或正在清理资料，请刷新后重试。');
    const current = authRevision.current;
    setError(''); setBusy(action);
    try {
      const saved = action === 'withdraw'
        ? await withdrawActivityRegistration(supabase, activity.id, { expectedUserId: user.id })
        : action === 'details' ? await saveRegistrationDetails(supabase,activity.id,{expectedUserId:user.id,...input})
        : await submitActivityApplication(supabase, record, { expectedUserId: user.id, ...input });
      if (current === authRevision.current) {setRegistration({ ...saved, activityId: activity.id });setDetailsMode('');}
    } catch (caught) {
      if (current !== authRevision.current) return;
      setError(caught.message || '操作未完成，请重新检查后重试。');
      if (caught.code === 'LOGIN_REQUIRED' || caught.code === 'LOGIN_CHANGED') { setUser(null); setRegistration(null); setRefresh(value => value + 1); }
      if (action !== 'withdraw') throw caught;
    } finally { if (current === authRevision.current) { setBusy(''); setClock(Date.now()); } }
  }

  useEffect(() => { setDetailsMode(''); setPaymentOpen(false); stagedProof.current = null; return () => proofRequest.current?.abort(); }, [activity?.id, availability.isPublic]);
  function closePayment() {
    proofRequest.current?.abort(); setPaymentOpen(false);
    if (busy !== 'proof') setRefresh(value => value + 1);
  }
  async function submitProof(file) {
    if (busy || checking || !user || application?.status !== 'active' || application.selectionStatus !== 'confirmed' || application.paymentStatus !== 'unpaid' || (state?.canSubmitPaymentProof === false || !activitySensitiveAccess(record,state?.retention))) throw new Error('当前报名状态已变化，请刷新后再提交缴费记录。');
    const current = authRevision.current, controller = new AbortController(); proofRequest.current = controller; setBusy('proof');
    const previous = stagedProof.current;
    try {
      const saved = await uploadPaymentProof(supabase, file, { activityId: activity.id, applicationId: application.id, expectedUserId: user.id, expectedPaymentStatus: application.paymentStatus, expectedProofId: application.currentPaymentProofId || application.paymentProofs?.[0]?.id || null, stagedPath: previous?.file === file && previous.userId === user.id && previous.applicationId === application.id ? previous.path : undefined, signal: controller.signal });
      if (current === authRevision.current && !controller.signal.aborted) { stagedProof.current = null; setRegistration({ ...saved, activityId: activity.id }); setPaymentOpen(false); }
    } catch (caught) {
      if (current === authRevision.current && caught.stagedPath && !controller.signal.aborted) stagedProof.current = { path: caught.stagedPath, file, userId: user.id, applicationId: application.id };
      if (current === authRevision.current && ['LOGIN_REQUIRED','LOGIN_CHANGED'].includes(caught.code)) { setPaymentOpen(false); setUser(null); setRegistration(null); setRefresh(value => value + 1); }
      throw caught;
    } finally {
      if (current === authRevision.current) { setBusy(''); if (controller.signal.aborted) setRefresh(value => value + 1); }
      if (proofRequest.current === controller) proofRequest.current = null;
    }
  }
  const returnPath = `/activities/${encodeURIComponent(activity?.id || '')}#application`;
  const canWithdraw = state?.canWithdraw && application?.status === 'active' && new Date(activity.dateStart).getTime() > clock;
  const ready = availability.isPublic && Boolean(supabase) && !checking;
  const sensitiveAllowed = activitySensitiveAccess(record,state?.retention,clock);
  useEffect(()=>{if(!sensitiveAllowed){setDetailsMode('');setPaymentOpen(false);proofRequest.current?.abort();}},[sensitiveAllowed]);
  const canPay = sensitiveAllowed && ready && Boolean(user) && !error && application?.status === 'active' && application.selectionStatus === 'confirmed' && application.paymentStatus === 'unpaid' && state?.canSubmitPaymentProof !== false;
  const shortLabel = !availability.isPublic ? '报名未开放' : !supabase ? '报名服务暂不可用' : checking ? '正在确认报名…' : error ? '报名状态待确认' : application
    ? `${labels[application.selectionStatus] || '报名记录'}${!withdrawn && application.position != null && state.capacity != null ? ` · ${application.position}/${state.capacity}` : ''}`
    : '尚未报名';
  const summary = <div className="application-summary" role="status">
    {!ready ? <span>{checking && availability.isPublic && supabase && <LoaderCircle size={15} aria-hidden="true" />}{shortLabel}</span> : application ? <>
      <div className="application-status-line"><span>{labels[application.selectionStatus]}</span><span className={`payment-status payment-status-${application.paymentStatus}`}>{paymentLabel(application.paymentStatus)}</span></div>
      {!withdrawn && application.position != null && state.capacity != null && <p className="application-ranking"><span>当前排位 / 活动名额</span><b>{application.position}/{state.capacity}</b></p>}
    </> : <span>{error ? '暂时无法确认报名记录' : '尚未报名'}{state?.capacity != null && !error && <small>活动名额 {state.capacity} 人</small>}</span>}
    {error && ready && <small className="application-summary-error">操作未完成，请重新检查</small>}
  </div>;
  const details = <div className="application-details">
    {!availability.isPublic ? <p className="application-closed">{availability.reason}</p> : !supabase ? <p className="application-error" role="status">报名服务暂时不可用，请稍后重试。</p> : checking ? <p className="application-checking" role="status">正在确认账号与报名记录…</p> : <>
      {application && <div className={`application-confirmed application-status-${application.selectionStatus}`}><CheckCircle2 size={21} aria-hidden="true" /><div>
        <strong>{withdrawn ? '已退出本次报名' : '报名申请已提交'}</strong>
        <p>报名时间：{formatActivityTime(application.registeredAt || application.createdAt)}</p>
        {application.selectionStatus === 'waitlisted' && <p>按报名顺序候补，前方人员退出后自动递补。请等候入选后再缴费。</p>}
        {application.selectionStatus === 'unconfirmed' && <p>活动名额尚未确认，现有报名记录已保留。</p>}
        {withdrawn && <p>退出记录与缴费状态保留。报名开放期间可重新报名，排在当前队尾；退款请联系管理员。</p>}
      </div></div>}
      {application?.selectionStatus === 'confirmed' && application.paymentStatus === 'unpaid' && <div className="application-payment-reminder" role="note"><strong>入选待缴费</strong><p>{activity.paymentInstructions || '请按活动通知完成缴费，联系管理员确认。'}</p><small>缴费状态由管理员确认后更新。</small></div>}
      {application?.paymentStatus === 'pending' && <div className="application-payment-pending" role="note"><strong>应已缴费</strong><p>{application.paymentProofs?.length ? '缴费记录已提交，等待管理员核实。请勿重复付款。' : '缴费状态待管理员核实，请联系管理员确认。'}</p></div>}
      {sensitiveAllowed && application?.paymentProofs?.[0] && user && <PaymentProofImage proof={application.paymentProofs[0]} expectedUserId={user.id}/>}
      {application?.status === 'active' && <p>{application.insuranceStatus === 'insured' ? '保险已购买' : '保险未购买'}{application.detailsComplete !== true && ' · 保险资料待补全'}</p>}
      {application?.insuranceStatus === 'insured' && sensitiveAllowed && <p>保险已购买，如需更正资料，请先联系管理员退回未购买状态。</p>}
      {application?.proofsPurgedAt && <p>本次活动的历史缴费图片已清理，缴费结果保留。</p>}
      {!sensitiveAllowed && <p className="application-closed">活动已结束或资料正在清理，临时资料和缴费图片暂不可操作。</p>}
      {state && <p className="application-totals">有效报名 {state.activeCount} 人 · 入选 {state.confirmedCount} 人 · 候补 {state.waitlistCount} 人</p>}
      {canWithdraw && <p>活动开始前可退出，退出后将由后续报名者递补。</p>}
      {(!application || withdrawn) && <>
        {!availability.open && <p className="application-closed">{availability.reason}</p>}
        {availability.open && !user && !error && <p>登录后可使用当前账号提交申请。</p>}
        {availability.open && user && !error && <><p>{withdrawn ? '重新报名将按本次提交时间排到当前队尾。' : '按报名时间排序，名额内入选，其余候补。'}</p></>}
      </>}
      {state && <button className="application-refresh" type="button" disabled={Boolean(busy)} onClick={() => setRefresh(value => value + 1)}>刷新报名状态</button>}
    </>}
    {error && <div className="application-error" role="alert"><p>{error}</p></div>}
    <small className="application-private-note">报名记录仅对本人及协会管理员可见。</small>
  </div>;
  const actions = <div className="application-controls">
    {ready && !error && <>
      {user && application?.status === 'active' && sensitiveAllowed && application.insuranceStatus !== 'insured' && <button className="application-refresh" type="button" disabled={Boolean(busy)} onClick={()=>setDetailsMode('details')}>{application.detailsComplete === true ? '更正保险资料' : '补充保险资料'}</button>}
      {canPay && <button className="btn application-action application-pay-action" type="button" disabled={Boolean(busy)} onClick={() => setPaymentOpen(true)}>缴费</button>}
      {canWithdraw && <button className="application-secondary-action" type="button" disabled={Boolean(busy)} onClick={() => mutate('withdraw')}>{busy === 'withdraw' ? '正在退出…' : '退出本次报名'}</button>}
      {(!application || withdrawn) && availability.open && sensitiveAllowed && (!user
        ? <Link className="btn application-action" to={`/login?next=${encodeURIComponent(returnPath)}`}>登录后报名<ArrowRight size={15} /></Link>
        : <form onSubmit={event => { event.preventDefault(); setDetailsMode('register'); }}><button className="btn application-action" type="submit" disabled={Boolean(busy)}>{busy === 'register' ? '正在提交…' : withdrawn ? '重新报名' : '确认提交报名申请'}<ArrowRight size={15} aria-hidden="true" /></button></form>)}
    </>}
    {error && <button className="application-retry-action" type="button" onClick={() => setRefresh(value => value + 1)} disabled={Boolean(busy) || checking}>重新检查</button>}
  </div>;
  const detailsLabel = canPay ? '' : '查看报名详情';
  const registrationDialog = <RegistrationDetailsDialog key={`${activity?.id}:${user?.id || ''}`} open={Boolean(detailsMode) && Boolean(user) && sensitiveAllowed} userId={user?.id} activity={activity} supplement={detailsMode==='details'} busy={Boolean(busy)} onClose={()=>setDetailsMode('')} onSubmit={input=>mutate(detailsMode,input)}/>;
  const paymentDialog = <PaymentDialog open={paymentOpen && Boolean(user) && availability.isPublic} feeCents={activity.registrationFeeCents} qrUrl={state?.paymentQrUrl || ''} busy={busy === 'proof'} onClose={closePayment} onSubmit={submitProof}/>;
  if (typeof children === 'function') return <>{children({ summary, details, actions, shortLabel, detailsLabel, checking: checking || Boolean(busy) })}{paymentDialog}{registrationDialog}</>;
  return <><section className="activity-application" id="application" aria-label="活动报名" aria-busy={checking || Boolean(busy)}><h3>活动报名</h3><p className="application-registration-fee"><span>报名费用</span><strong>{formatRegistrationFee(activity.registrationFeeCents)}</strong></p>{summary}{details}{actions}</section>{paymentDialog}{registrationDialog}</>;
}
