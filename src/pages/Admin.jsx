import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Activity, ArrowLeft, ArrowRight, Bell, Check, ChevronRight, Eye, EyeOff, FileText, Image, KeyRound, LayoutDashboard, LogOut, Menu, Monitor, MountainSnow, Pencil, Plus, Search, ShieldCheck, SlidersHorizontal, Trash2, Users, X } from 'lucide-react';
import { activities, routes as sampleRoutes, photos, articles } from '../data.js';
import { ButtonLink, EmptyState } from '../ui.jsx';
import { supabase, isBackendConfigured, backendConfigurationError } from '../backend.js';
import TrackUpload from '../tracks/TrackUpload.jsx';
import { resolvedTrackMetrics, validateManualTrackMetrics } from '../tracks/metrics.js';
import ActivityCoverUpload from '../media/ActivityCoverUpload.jsx';
import PaymentSettingsAdmin from '../payments/PaymentSettingsAdmin.jsx';
import GalleryPhotoUpload from '../media/GalleryPhotoUpload.jsx';
import { getLocalTrack, putLocalTrack } from '../tracks/track-store.js';
import { deleteContentWithLinks, normalizeRouteTitle } from '../tracks/activity-workflow.js';
import DeviceDetection from '../maintenance/DeviceDetection.jsx';
import './admin.css';
import { applyActivityRoute } from '../tracks/activity-route-selection.js';
import { toLocalDateTime, readActivitySchedule } from '../activities/schedule.js';
import { OFFICIAL_BADGE } from '../Brand.jsx';
import { runtimeMode } from '../runtime-mode.js';
import { safeInternalReturn } from '../applications/registration.js';
import { parseRegistrationCapacity } from '../applications/settings.js';
import { parseRegistrationFee, registrationFeeInputValue } from '../activities/registration-fee.js';
import { activityTypeOptions } from '../activities/categories.js';
import ActivityRegistrationAdmin from '../applications/ActivityRegistrationAdmin.jsx';
import SignupVerification from '../auth/SignupVerification.jsx';
import SiteImagesAdmin from '../site-images/SiteImagesAdmin.jsx';
import ImageUpload from '../site-images/ImageUpload.jsx';
import SiteImage, {SiteImageCredit} from '../site-images/SiteImage.jsx';
import {getAdminSession} from '../session/admin-session.js';
import ActivityEditorWorkspace from '../activities/ActivityEditorWorkspace.jsx';
import ActivityContentFields from '../activities/ActivityContentFields.jsx';
import {readActivityPageContent, parseActivityPageContent} from '../activities/page-content.js';
import {formatActivityDistance, formatActivityAscent} from '../activities/presentation.js';

const DRAFT_KEY = 'chuanheng-drafts';
const NAV = [
  ['overview', '控制台', LayoutDashboard, '/admin'],
  ['activities', '活动管理', Activity, '/admin/activities'],
  ['routes', '路线管理', MountainSnow, '/admin/routes'],
  ['gallery', '影像管理', Image, '/admin/gallery'],
  ['news', '资讯管理', FileText, '/admin/news'],
  ['devices', '设备检测', Monitor, '/admin/devices'],
  ['backgrounds', '背景管理', Image, '/admin/backgrounds'],
  ['accounts', '账号管理', Users, '/admin/accounts'],
  ['services', '服务配置', SlidersHorizontal, '/admin/services'],
  ['password', '修改密码', KeyRound, '/admin/password'],
];
const KINDS = { activities: 'activity', routes: 'route', gallery: 'photo', news: 'article' };
const KIND_NAMES = { activity: '活动', route: '路线', photo: '影像', article: '资讯' };
const SAMPLE_GROUPS = { activity: activities, route: sampleRoutes, photo: photos, article: articles };

function readStored(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}

function readDrafts() {
  const value = readStored(DRAFT_KEY, []);
  return Array.isArray(value) ? value.filter(row => row && row.id && KIND_NAMES[row.kind] && row.payload && typeof row.payload === 'object').map(row => ({ ...row, published: false })) : [];
}

function assertDraftSnapshot(currentRows, original, newId) {
  const current = currentRows.find(row => row.id === (original.id || newId));
  if (current?.kind === 'route' && current.payload?.archived) throw new Error('这条路线已归档，仅可只读查看，不能编辑或删除。');
  if (original.id ? !current || JSON.stringify(current) !== JSON.stringify(original) : Boolean(current)) {
    const error = new Error('此记录已被其他窗口修改或删除，存在编辑冲突。请保留当前文字，关闭后重新打开记录再保存。');
    error.code = 'DRAFT_CONFLICT';
    throw error;
  }
}

function dateLabel(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function publicImageUrl(value, { local = false } = {}) {
  if (!value) return true;
  if (local && /^data:image\/(?:jpeg|png|webp);base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value) && value.split(',')[1]?.length) return true;
  return /^\/(?!\/)/.test(value) || /^https:\/\//i.test(value);
}

function trackLocationLabel(location) {
  if (!location || typeof location !== 'object') return '';
  const places = [...new Set((Array.isArray(location.locations) ? location.locations : []).map(place => place?.city || place?.province).filter(Boolean))];
  return places.length ? places.join(' / ') : [...new Set([location.province, location.city].filter(Boolean))].join(' · ');
}

function activityLocationIssue(row) {
  if (row.kind !== 'activity') return null;
  const location = row.payload?.track?.location || row.payload?.trackSummary?.location;
  return location && ['unmatched', 'partial'].includes(location.locationStatus) ? { row, location } : null;
}

function routeMetricIssues(row) {
  if (row.kind !== 'route' || row.isDemo || row.payload?.isDemo || row.payload?.archived) return [];
  const payload = row.payload || {};
  const track = payload.track || payload.trackSummary;
  const metrics = track ? resolvedTrackMetrics(track) : { distanceM: Number.isFinite(payload.distance) ? payload.distance * 1000 : null, ascentM: Number.isFinite(payload.ascent) ? payload.ascent : null };
  return [metrics.distanceM === null ? '里程' : null, metrics.ascentM === null ? '累计爬升' : null].filter(Boolean);
}

export async function prepareRouteTrackPayload(source, track, { local = false, storeTrack = putLocalTrack } = {}) {
  const payload = { ...source };
  // Undefined means unresolved, not an instruction to discard an existing track.
  if (track === undefined) return payload;
  if (track === null) {
    delete payload.track;
    delete payload.trackLocalId;
    for (const key of ['trackSummary', 'coordinates', 'province', 'city', 'adcode', 'locations', 'locationStatus']) delete payload[key];
    return payload;
  }
  validateManualTrackMetrics(track);
  const {distanceM:distance,ascentM:ascent} = resolvedTrackMetrics(track);
  if (['distanceM','ascentM'].some(key=>track.stats?.[key]!=null&&(!Number.isFinite(track.stats[key])||track.stats[key]<0))) throw new Error('轨迹统计无效，请重新解析文件后保存。');
  payload.distance = distance===null?null:distance / 1000;
  payload.ascent = ascent;
  const location = track.location && typeof track.location === 'object' ? track.location : {};
  const first = track.geojson?.geometry?.coordinates?.find(segment => segment?.length)?.[0];
  const point = location.coordinates || first;
  for (const key of ['coordinates', 'province', 'city', 'adcode', 'locations', 'locationStatus']) delete payload[key];
  if (Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1])) payload.coordinates = point.slice(0, 2);
  for (const key of ['province', 'city', 'adcode']) if (location[key]) payload[key] = location[key];
  payload.locations = Array.isArray(location.locations) ? location.locations : [];
  payload.locationStatus = location.locationStatus || 'unmatched';
  const label = trackLocationLabel(location);
  if (label) payload.location = label;
  payload.trackSummary = { name: track.name, stats: track.stats, manualMetrics: track.manualMetrics, location, coordinates: payload.coordinates, pointCount: track.pointCount, segmentCount: track.segmentCount };
  if (local) {
    const id = await storeTrack(track);
    if (typeof id !== 'string' || !id) throw new Error('轨迹未能保存到此浏览器，请重试。');
    payload.trackLocalId = id;
    delete payload.track;
  } else {
    payload.track = track;
    delete payload.trackLocalId;
  }
  return payload;
}

export async function prepareActivityTrackPayload(source, track, options = {}) {
  const payload = await prepareRouteTrackPayload(source, track, options);
  if (track === undefined) return payload;
  for (const field of ['trackSummary', 'coordinates', 'province', 'city', 'adcode', 'locations', 'locationStatus']) delete payload[field];
  if (!track) { payload.includeFootprint = false; return payload; }
  const location = track.location && typeof track.location === 'object' ? track.location : {};
  const firstPoint = track.geojson?.geometry?.coordinates?.find(segment => Array.isArray(segment) && segment.length)?.[0];
  const validPoint = value => Array.isArray(value) && value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1]);
  const coordinates = validPoint(location.coordinates) ? location.coordinates.slice(0, 2) : validPoint(firstPoint) ? firstPoint.slice(0, 2) : undefined;
  payload.organizer = 'chuanheng';
  if (coordinates) payload.coordinates = coordinates;
  for (const field of ['province', 'city', 'adcode']) if (typeof location[field] === 'string' && location[field].trim()) payload[field] = location[field];
  payload.locations = Array.isArray(location.locations) ? location.locations : [];
  payload.locationStatus = location.locationStatus || 'unmatched';
  const label = trackLocationLabel(location);
  if (label) payload.location = label;
  payload.trackSummary = { name: track.name, stats: track.stats, location, coordinates, pointCount: track.pointCount, segmentCount: track.segmentCount };
  return payload;
}

function useVerifiedAuth(preview) {
  const [auth, setAuth] = useState(() => preview ? {status: 'preview', user: null, error: ''} : supabase ? getAdminSession(supabase).getSnapshot() : {status: 'unavailable', user: null, error: '认证服务尚未配置，请稍后重试。'});
  useEffect(() => {
    if (preview) { setAuth({ status: 'preview', user: null, error: '' }); return; }
    if (!supabase) { setAuth({ status: 'unavailable', user: null, error: '认证服务尚未配置，请稍后重试。' }); return; }
    const session = getAdminSession(supabase);
    const update = () => setAuth(session.getSnapshot());
    const unsubscribe = session.subscribe(update);
    update();
    return unsubscribe;
  }, [preview]);
  return auth;
}

async function requireVerifiedAdmin(expectedUserId, expectedEpoch) {
  if (!supabase) throw new Error('尚未连接云端服务。');
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user?.id || user.is_anonymous || user.app_metadata?.role !== 'admin' || expectedUserId && user.id !== expectedUserId) {
    const current = getAdminSession(supabase);
    // A response for a previous account must not revoke the replacement account.
    const snapshot = current.getSnapshot();
    if (snapshot.user?.id === expectedUserId && snapshot.epoch === expectedEpoch) current.invalidate();
    throw new Error('管理员身份校验未通过，请重新登录。');
  }
  return user;
}

function AdminMark() {
  return <span className="admin-mark"><img src={OFFICIAL_BADGE} alt="川衡社官方徽章" width="42" height="42"/></span>;
}

export function AdminPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const previewRequested = runtimeMode.allowLocalPreview && new URLSearchParams(location.search).get('preview') === '1';
  const local = runtimeMode.allowLocalPreview && (!isBackendConfigured || previewRequested);
  const auth = useVerifiedAuth(local);
  const adminPath = path => previewRequested ? `${path}?preview=1` : path;
  const requestedSection = location.pathname.replace(/\/$/, '').split('/')[2] || 'overview';
  const section = requestedSection === 'footprints' ? 'activities' : requestedSection === 'settings' ? 'services' : requestedSection === 'debug' ? 'routes' : requestedSection;
  const nav = NAV.find(item => item[0] === section);
  const title = nav?.[1] || '页面未找到';
  const kind = KINDS[section];
  const allowed = local ? auth.status === 'preview' : auth.status === 'admin';
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const identity = useRef({key: null, epoch: auth.epoch});
  const identityKey = allowed ? local ? 'preview' : auth.user?.id : null;
  if (identity.current.key !== identityKey || identity.current.epoch !== auth.epoch) identity.current = {key: identityKey, epoch: auth.epoch};
  const isCurrentIdentity = started => {
    if (!mounted.current || identity.current !== started) return false;
    if (local) return true;
    const current = getAdminSession(supabase).getSnapshot();
    return current.status === 'admin' && current.user?.id === started.key && current.epoch === started.epoch;
  };
  const [drafts, setDrafts] = useState(readDrafts);
  const [cloudRows, setCloudRows] = useState([]);
  const [loadedCloudVersion,setLoadedCloudVersion]=useState(null);
  const handledRouteRequests=useRef(new Set());
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [query, setQuery] = useState('');
  const [showSamples, setShowSamples] = useState(false);
  const [editor, setEditor] = useState(null);
  const editorDirty = useRef(false);
  const [registrationActivity, setRegistrationActivity] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [mobileOpen, setMobileOpen] = useState(false);
  const activityEditorPath = /^\/admin\/activities\/([^/]+)(?:\/edit)?\/?$/.exec(location.pathname);
  const requestedActivityId = activityEditorPath?.[1] || '';

  function openEditor(record) {
    setError('');
    editorDirty.current = false;
    setEditor(structuredClone(record));
    if (record.kind === 'activity') navigate(adminPath(record.id ? `/admin/activities/${record.id}/edit` : '/admin/activities/new'));
  }
  function closeEditor() {
    if (busy) return;
    if (editor?.kind === 'activity' && editorDirty.current && !window.confirm('还有未保存的活动修改，确定离开并放弃修改吗？')) return;
    editorDirty.current = false;
    setEditor(null); setError('');
    if (requestedActivityId) navigate(adminPath('/admin/activities'));
  }

  useEffect(() => {
    if (['footprints', 'debug'].includes(requestedSection)) {
      const target = requestedSection === 'footprints' ? '/admin/activities' : '/admin/routes';
      navigate(previewRequested ? `${target}?preview=1` : target, { replace: true });
    }
  }, [requestedSection, previewRequested, navigate]);

  useEffect(() => { setQuery(''); setShowSamples(false); if (editor?.kind !== 'activity' || !editorDirty.current) setEditor(null); setRegistrationActivity(null); setMobileOpen(false); setNotice(''); setError(''); }, [section]);
  useLayoutEffect(() => {
    editorDirty.current = false;
    setEditor(null); setRegistrationActivity(null); setCloudRows([]); setLoadedCloudVersion(null);
    setNotice(''); setError(''); setBusy(false);
  }, [identityKey, auth.epoch]);

  useEffect(() => {
    if (!local) return undefined;
    const update = event => {
      if (event.type === 'storage' && event.key !== DRAFT_KEY && event.key !== null) return;
      // Refresh list data only. An open editor retains its original conflict snapshot.
      setDrafts(readDrafts());
    };
    window.addEventListener('storage', update);
    window.addEventListener('chuanheng-drafts-updated', update);
    return () => { window.removeEventListener('storage', update); window.removeEventListener('chuanheng-drafts-updated', update); };
  }, [local]);

  useEffect(() => {
    if (local || !allowed || editor?.kind !== 'route') return undefined;
    const refreshRoutes = () => setRefresh(value => value + 1);
    window.addEventListener('focus', refreshRoutes);
    return () => window.removeEventListener('focus', refreshRoutes);
  }, [local, allowed, editor?.kind]);

  useEffect(() => {
    if (local || auth.status !== 'admin' || !supabase) { setCloudRows([]); return; }
    let alive = true;
    setLoading(true); setLoadError('');
    supabase.from('content_items').select('id,kind,payload,published,created_at').order('created_at', { ascending: false }).then(({ data, error: fetchError }) => {
      if (!alive) return;
      setLoading(false);
      if (fetchError) { setCloudRows([]); setLoadError('内容读取失败。请检查数据表、RLS 权限与网络连接。'); }
      else {setCloudRows(data || []);setLoadedCloudVersion(`${auth.user?.id || ''}:${refresh}`);}
    }).catch(() => { if (alive) { setLoading(false); setLoadError('无法连接内容服务，请稍后重试。'); } });
    return () => { alive = false; };
  }, [auth.status, auth.user?.id, auth.epoch, refresh, local]);

  const rows = local ? drafts : cloudRows;
  useEffect(() => {
    const sameActivity = editor?.kind === 'activity' && (editor.id || 'new') === requestedActivityId;
    if (sameActivity) return;
    if (editor?.kind === 'activity' && editorDirty.current) {
      if (!window.confirm('还有未保存的活动修改，确定离开并放弃修改吗？')) {
        navigate(adminPath(editor.id ? `/admin/activities/${editor.id}/edit` : '/admin/activities/new'), {replace:true});
        return;
      }
      editorDirty.current = false;
    }
    if (!requestedActivityId) { setEditor(current => current?.kind === 'activity' ? null : current); return; }
    if (!allowed || (!local && (loading || loadError || loadedCloudVersion !== `${auth.user?.id || ''}:${refresh}`))) return;
    if (requestedActivityId === 'new') { setError(''); setEditor({kind:'activity',payload:{}}); return; }
    const record = rows.find(row => row.kind === 'activity' && row.id === requestedActivityId && !row.isDemo && !row.payload?.isDemo && !row.payload?.archived);
    if (!record) { setEditor(null); setError('活动不存在或已移除，请返回活动列表核对。'); return; }
    setError(''); setEditor(structuredClone(record));
  }, [requestedActivityId, allowed, local, loading, loadError, loadedCloudVersion, refresh, auth.user?.id, auth.epoch, identityKey, location.key, editor, rows]);
  const requestedRouteId=new URLSearchParams(location.search).get('edit');
  useEffect(()=>{
    if(section!=='routes'||!requestedRouteId||!allowed||showSamples||(!local&&(loading||loadError||loadedCloudVersion!==`${auth.user?.id || ''}:${refresh}`)))return;
    const requestKey=`${location.key}:${requestedRouteId}`;
    if(handledRouteRequests.current.has(requestKey))return;
    handledRouteRequests.current.add(requestKey);
    if(editor){setError('当前编辑内容尚未关闭，已保留填写内容。请先保存或关闭编辑器，再重新打开所需路线。');return;}
    const row=rows.find(item=>item.id===requestedRouteId&&item.kind==='route');
    if(!row){setError('请求编辑的路线不存在或已删除，请核对路线列表。');return;}
    if(row.payload?.archived){setError('请求编辑的路线已归档，不能编辑。');return;}
    if(row.isDemo||row.payload?.isDemo){setError('示例路线不可作为真实路线编辑，请选择已有真实路线。');return;}
    setError('');setEditor(structuredClone(row));
  },[section,requestedRouteId,allowed,showSamples,local,loading,loadError,loadedCloudVersion,auth.user?.id,refresh,location.key,editor,rows]);
  const samples = Object.entries(SAMPLE_GROUPS).flatMap(([sampleKind, records]) => records.filter(row => row.isDemo === true).map(row => ({ id: `example-${sampleKind}-${row.id}`, kind: sampleKind, payload: { ...row, type: row.type || row.category || KIND_NAMES[sampleKind] }, published: false, created_at: null, isDemo: true })));
  const filtered = (showSamples ? samples : rows).filter(row => (!kind || row.kind === kind) && `${row.payload?.title || ''} ${row.payload?.type || ''} ${row.payload?.description || ''}`.toLowerCase().includes(query.toLowerCase()));
  const stats = [
    { name: local ? '本地草稿' : '内容草稿', value: rows.filter(row => !row.published).length, icon: FileText, hint: '尚未公开发布', color: 'orange' },
    { name: '已发布内容', value: rows.filter(row => row.published && row.payload?.isDemo !== true).length, icon: ShieldCheck, hint: local ? '本地预览不提供发布' : '公开的非示例内容', color: 'green' },
    { name: '活动内容', value: rows.filter(row => row.kind === 'activity').length, icon: Activity, hint: '已创建的活动档案', color: 'blue' },
    { name: '路线档案', value: rows.filter(row => row.kind === 'route').length, icon: MountainSnow, hint: '已创建的路线内容', color: 'purple' },
  ];

  function persistDrafts(next) {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(next));
    setDrafts(next);
    window.dispatchEvent(new Event('chuanheng-drafts-updated'));
  }

  async function saveContent(event, track, selectedRoute) {
    event.preventDefault();
    const startedIdentity = identity.current;
    const active = () => isCurrentIdentity(startedIdentity);
    setError(''); setBusy(true);
    try {
      if (!allowed || showSamples) throw new Error('当前内容只可浏览。');
      if (editor.kind === 'route' && editor.payload.archived) throw new Error('归档路线仅可只读查看，不能编辑或发布。');
      const recordId = editor.id || crypto.randomUUID();
      if (local) assertDraftSnapshot(readDrafts(), editor, recordId);
      const createdAt = editor.created_at || new Date().toISOString();
      const form = new FormData(event.currentTarget);
      let payload = { ...editor.payload, title: String(form.get('title')).trim(), type: String(form.get('type') || '').trim(), description: String(form.get('description')).trim(), image: String(form.get('image')).trim(), isDemo: false };
      if (!payload.title) throw new Error('请填写内容标题。');
      if (editor.kind === 'photo' && !payload.image) throw new Error('请先上传照片，再保存影像内容。');
      if (!publicImageUrl(payload.image, { local })) throw new Error('图片请使用 HTTPS 地址或以 / 开头的站内路径。');
      if (editor.kind === 'route') {
        payload.featured = form.get('featured') === 'on';
        for (const field of ['location', 'difficulty']) payload[field] = String(form.get(field) || '').trim();
        if (track === undefined && (editor.payload.track || editor.payload.trackLocalId)) throw new Error('原有轨迹尚未读取完成，请重试读取或明确移除后保存。');
        if (!track) {
          payload.distance = Number(form.get('distance'));
          const ascent = String(form.get('ascent') ?? '').trim();
          payload.ascent = ascent === '' ? null : Number(ascent);
          if (!Number.isFinite(payload.distance) || payload.distance < 0 || payload.ascent !== null && (!Number.isFinite(payload.ascent) || payload.ascent < 0)) throw new Error('里程和非空爬升须为有效的非负数字；爬升未知时可留空。');
        }
      }
      if (editor.kind === 'activity') {
        if (form.has('pageContent')) payload.pageContent = parseActivityPageContent(JSON.parse(String(form.get('pageContent'))));
        payload.showInHistory = form.get('showInHistory') === 'on';
        payload.date = String(form.get('date') || '').trim();
        payload.status = String(form.get('status') || '即将开始');
        payload.difficulty = String(form.get('difficulty') || '入门');
        const published = !local && form.get('published') === 'on';
        const registrationOpen = form.get('registrationOpen') === 'on';
        const scheduleFields = ['dateStart', 'dateEnd', 'registrationStart', 'registrationDeadline'];
        const unchangedLegacySchedule = Boolean(editor.id)
          && !Object.hasOwn(editor.payload, 'dateEnd') && !Object.hasOwn(editor.payload, 'registrationStart')
          && scheduleFields.every(field => String(form.get(field) || '') === toLocalDateTime(editor.payload[field]))
          && (!registrationOpen || editor.payload.registrationOpen === true)
          && (!published || editor.published === true);
        if (unchangedLegacySchedule) {
          // Preserve the legacy JSON shape, including missing keys and unknown times.
          if (registrationOpen !== (editor.payload.registrationOpen === true)) payload.registrationOpen = registrationOpen;
        } else {
          Object.assign(payload, readActivitySchedule(form, { published, legacy: false }));
        }
        const capacityText = String(form.get('registrationCapacity') || '').trim();
        const unchangedLegacyCapacity = Boolean(editor.id) && editor.payload.registrationCapacity == null && !capacityText && registrationOpen === (editor.payload.registrationOpen === true);
        const capacity = parseRegistrationCapacity(capacityText, { required: registrationOpen && !unchangedLegacyCapacity || published && !editor.id });
        if (capacity !== null) payload.registrationCapacity = capacity;
        else if (!Object.hasOwn(editor.payload, 'registrationCapacity')) delete payload.registrationCapacity;
        else payload.registrationCapacity = null;
        const fee = parseRegistrationFee(form.get('registrationFee'));
        if (fee !== null || Object.hasOwn(editor.payload, 'registrationFeeCents')) payload.registrationFeeCents = fee;
        payload.paymentInstructions = String(form.get('paymentInstructions') || '').trim();
        if (payload.paymentInstructions.length > 1000) throw new Error('缴费说明不能超过1000字。');
        payload.routeId = String(form.get('routeId') || '');
        const legacyTrack = !editor.payload.routeSnapshot && (editor.payload.track || editor.payload.trackLocalId);
        if (legacyTrack && track === undefined) throw new Error('原有轨迹尚未读取完成，请重试读取后保存。');
      }
      if (editor.kind === 'route') {
        payload.source = String(form.get('source') || '').trim();
        payload = await prepareRouteTrackPayload(payload, track, { local });
        if (!active()) return;
      }
      if (['photo', 'article'].includes(editor.kind)) payload.category = String(form.get('category') || '').trim();
      if (editor.kind === 'article') {
        payload.date = String(form.get('date') || '').trim();
        payload.readTime = Math.max(1, Number(form.get('readTime')) || 1);
        const bodyText = String(form.get('body') || '').trim();
        payload.body = bodyText ? [{ heading: '正文', text: bodyText }] : [];
      }
      const record = { id: recordId, kind: editor.kind, payload, published: local ? false : form.get('published') === 'on', created_at: createdAt };
      const routeChanged = editor.kind === 'activity' && payload.routeId && payload.routeId !== (editor.payload.routeId || '');
      if (routeChanged && selectedRoute) record.routeExpectedPayload = selectedRoute.payload;
      if (local) {
        // No awaits between this fresh read, conflict check and the single write.
        const current = readDrafts();
        assertDraftSnapshot(current, editor, recordId);
        const next = editor.kind === 'activity' ? applyActivityRoute(current, record) : editor.id ? current.map(row => row.id === editor.id ? { ...row, ...record } : row) : [record, ...current];
        persistDrafts(next);
        setNotice('草稿已保存到此浏览器，尚未发布。');
      } else {
        await requireVerifiedAdmin(startedIdentity.key, startedIdentity.epoch);
        if (!active()) return;
        const request = editor.kind === 'activity' ? supabase.rpc('save_activity_with_route', { activity_record: { ...record, expected: editor.id ? { payload: editor.payload, published: editor.published } : null } }) : (editor.id ? supabase.from('content_items').update(record).eq('id', editor.id) : supabase.from('content_items').insert(record)).select('id').single();
        const { data, error: writeError } = await request;
        if (!active()) return;
        if (writeError || !data || editor.kind === 'activity' && !data.activity?.id) throw new Error('云端保存未完成，请检查事务接口、权限、数据表和网络后重试。');
        setRefresh(value => value + 1);
        window.dispatchEvent(new Event('chuanheng-content-updated'));
        setNotice(record.published ? '内容已保存并发布到云端内容表。' : '云端草稿已保存。');
      }
      editorDirty.current = false;
      setEditor(null);
      if (editor.kind === 'activity') navigate(adminPath('/admin/activities'));
    } catch (caught) { if (active()) { if (local && caught.code === 'DRAFT_CONFLICT') setDrafts(readDrafts()); setError(caught.message || '保存失败，请重试。'); } }
    finally { if (active()) setBusy(false); }
  }

  async function deleteContent(row) {
    if (!allowed || showSamples || row.kind === 'route' && row.payload.archived || !window.confirm(`确认删除“${row.payload.title}”？`)) return;
    setError(''); setBusy(true);
    const startedIdentity = identity.current;
    const active = () => isCurrentIdentity(startedIdentity);
    try {
      if (local) {
        const current = readDrafts();
        assertDraftSnapshot(current, row);
        persistDrafts(deleteContentWithLinks(current, row.id));
      }
      else {
        await requireVerifiedAdmin(startedIdentity.key, startedIdentity.epoch);
        if (!active()) return;
        const { data, error: deleteError } = await supabase.rpc('delete_content_with_links', { content_id: row.id });
        if (!active()) return;
        if (deleteError || data?.deletedId !== row.id) throw new Error('删除未完成，请检查内容关联、事务接口及管理员权限后重试。');
        setRefresh(value => value + 1);
        window.dispatchEvent(new Event('chuanheng-content-updated'));
      }
      setNotice(local ? '本地草稿已删除。' : '云端内容已删除。');
    } catch (caught) { if (active()) { if (local && caught.code === 'DRAFT_CONFLICT') setDrafts(readDrafts()); setError(caught.message || '删除失败，请重试。'); } }
    finally { if (active()) setBusy(false); }
  }

  async function signOut() {
    if (supabase && !local) {
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) return setError('退出登录失败，请检查网络后重试。');
    }
    navigate(local ? '/' : '/login');
  }

  const editButton = <button className="admin-btn primary" onClick={() => { openEditor({ kind: kind || 'activity', payload: {} }); if (!local && kind === 'route') setRefresh(value => value + 1); }}><Plus size={17} />新建{KIND_NAMES[kind] || '活动'}</button>;

  function contentTable(overview = false) {
    const shown = overview ? filtered.slice(0, 6) : filtered;
    return <section className="admin-panel">
      <div className="admin-panel-heading"><div><h2>{overview ? '近期内容' : `${KIND_NAMES[kind]}列表`} <span>{filtered.length}</span></h2><p>{showSamples ? '界面示例只读，不计入统计，不支持报名或发布。' : local ? '管理此浏览器保存的内容草稿' : '管理云端内容与发布状态'}</p></div><div className="admin-panel-actions">{runtimeMode.allowLocalPreview && <button className={`admin-btn subtle ${showSamples ? 'selected' : ''}`} onClick={() => setShowSamples(value => !value)}><Eye size={15} />{showSamples ? '返回我的内容' : '查看示例'}</button>}{overview && <Link className="admin-text-link" to={adminPath("/admin/activities")}>全部活动<ArrowRight size={15} /></Link>}</div></div>
      <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>内容名称</th><th>类别</th><th>状态</th><th>创建日期</th><th>操作</th></tr></thead><tbody>{shown.map(row => <tr key={row.id} onDoubleClick={event => { if (row.kind === 'activity' && !row.isDemo && allowed && !busy && !event.target.closest('button,a,input,select,textarea')) setRegistrationActivity(structuredClone(row)); }}><td><div className="admin-row-title">{row.payload.image ? <img src={row.payload.image} alt="" loading="lazy" onError={event => { event.currentTarget.style.visibility = 'hidden'; }} /> : <span className="admin-row-image"><MountainSnow size={19} /></span>}<div><strong>{row.payload.title}</strong><small>{String(row.payload.description || '').slice(0, 42) || '暂无简介'}</small>{routeMetricIssues(row).length > 0 && <small className="admin-record-warning">参数待补：{routeMetricIssues(row).join('、')}</small>}{activityLocationIssue(row) && <small className="admin-record-warning">地点待核实</small>}</div></div></td><td>{row.payload.type || KIND_NAMES[row.kind]}</td><td><span className={`admin-status ${row.isDemo ? 'sample' : row.payload.archived ? 'archived' : row.published ? 'published' : ''}`}>{row.isDemo ? '设计示例' : row.payload.archived ? '已归档' : row.published ? '已发布' : '草稿'}</span></td><td>{dateLabel(row.created_at)}</td><td>{row.isDemo || row.kind === 'route' && row.payload.archived ? <span className="admin-muted">{row.payload.archived ? '归档只读' : '只读'}</span> : <div className="admin-row-actions">{row.kind === 'activity' && <button aria-label={`管理${row.payload.title}的报名`} title="报名管理" onClick={() => setRegistrationActivity(structuredClone(row))} disabled={busy}><Users size={16} /></button>}{local && ['route', 'activity'].includes(row.kind) && <Link to={`/${row.kind === 'activity' ? 'activities' : 'routes'}/${row.id}?draft=1`} aria-label={`预览${row.payload.title}`} title={row.kind === 'activity' ? '预览本地活动' : '预览本地路线'}><Eye size={16} /></Link>}<button aria-label={`编辑${row.payload.title}`} title="编辑" onClick={() => openEditor(row)} disabled={busy}><Pencil size={16} /></button><button className="danger" aria-label={`删除${row.payload.title}`} title="删除" onClick={() => deleteContent(row)} disabled={busy}><Trash2 size={16} /></button></div>}</td></tr>)}</tbody></table></div>
      {!shown.length && <EmptyState title={loading ? '正在读取内容' : query ? '没有找到匹配内容' : `还没有${KIND_NAMES[kind] || '内容'}${local ? '草稿' : ''}`} description={loading ? '请稍候，正在连接内容服务。' : query ? '试试其他关键词。' : '从一次新的创建开始，记录每一次出发。'} />}
      <div className="admin-table-footer"><span>共 {filtered.length} 条内容{showSamples ? ' · 设计示例' : local ? ' · 本地保存' : ''}</span><span>{overview && filtered.length > 6 ? '显示最近 6 条' : '全部内容'}<ChevronRight size={14} /></span></div>
    </section>;
  }

  const contentEditor = editor && allowed && <ContentEditor key={`${editor.kind}:${editor.id || 'new'}`} editor={editor} rows={rows} onRefreshRoutes={() => { if (local) setDrafts(readDrafts()); else setRefresh(value => value + 1); }} routesLoading={loading} routesError={loadError} local={local} busy={busy} error={error} onSave={saveContent} onClose={closeEditor} onDirtyChange={() => { editorDirty.current = true; }} />;
  if (editor?.kind === 'activity' && allowed) return <div className="admin-shell activity-editor-shell">{contentEditor}</div>;
  return <div className="admin-shell">
    {mobileOpen && <button className="admin-nav-backdrop" aria-label="关闭后台菜单" onClick={() => setMobileOpen(false)} />}
    <aside className={`admin-sidebar ${mobileOpen ? 'open' : ''}`}><Link className="admin-brand" to={adminPath("/admin")}><AdminMark /><span>川衡<span>管理后台</span></span></Link><div className="admin-nav-label">工作空间</div><nav aria-label="后台导航">{NAV.map(([id, label, Icon, path]) => <div key={id}>{id === 'backgrounds' && <div className="admin-nav-label admin-system-label">系统设置</div>}<Link className={section === id ? 'active' : ''} to={adminPath(path)}><Icon size={17} /><span>{label}</span>{section === id && <span className="admin-active-dot" />}</Link></div>)}</nav><div className="admin-sidebar-bottom"><Link to={local && section === "backgrounds" ? "/?preview=1" : "/"} target="_blank" rel="noopener noreferrer" title="在新标签页打开网站，保留当前后台"><ArrowRight size={16} />打开网站</Link><button onClick={signOut}><LogOut size={16} />{local ? '离开预览' : '退出登录'}</button></div></aside>
    <div className="admin-main"><header className="admin-toolbar"><div className="admin-toolbar-left"><button className="admin-menu-toggle" aria-label="打开后台菜单" onClick={() => setMobileOpen(true)}><Menu size={21} /></button><span>管理后台</span><ChevronRight size={14} /><strong>{title}</strong></div><div className="admin-toolbar-right"><span className="admin-environment"><i />{local ? '本地设计预览' : '云端服务'}</span><span className="admin-toolbar-separator" /><ShieldCheck size={18} /><span className="admin-user">{auth.status === 'admin' ? '管理员' : local ? '设计预览' : '访客'}</span><span className="admin-avatar">川</span></div></header>
    <section className="admin-workspace">
      <div className="admin-heading"><div><div className="admin-eyebrow">CHUANHENG · WORKSPACE</div><h1>{section === 'overview' ? '欢迎回来，探索继续。' : title}</h1><p>{section === 'overview' ? '让每一次热爱，都有迹可循。' : section === 'devices' ? '查看本地服务器状态与日常维护事项。' : `在这里管理川衡的${title.replace('管理', '')}。`}</p></div><div className="admin-heading-actions">{section === 'routes' && <Link className="admin-btn" to="/routes/import"><MountainSnow size={16} />导入轨迹</Link>}{allowed && (kind || section === 'overview') && !showSamples && editButton}</div></div>
      {local && <div className="admin-preview-note"><span className="admin-note-dot" /><div><strong>本地设计预览</strong><span>内容仅保存在此浏览器，尚未连接真实账号与发布服务。</span>{backendConfigurationError !== '尚未连接云端服务' && <span>{backendConfigurationError}</span>}</div></div>}
      {notice && <div className="admin-message success" role="status"><Check size={17} />{notice}<button aria-label="关闭提示" onClick={() => setNotice('')}><X size={15} /></button></div>}
      {(error || loadError) && <div className="admin-message error" role="alert">{error || loadError}{loadError && <button className="admin-text-link" onClick={() => setRefresh(value => value + 1)}>重试</button>}</div>}
      {!allowed ? <section className="admin-panel admin-access"><ShieldCheck size={42} /><h2>{auth.status === 'checking' ? '正在验证登录身份' : auth.status === 'forbidden' ? '当前账号没有管理权限' : auth.status === 'error' ? '身份验证未完成' : '请先登录管理账号'}</h2><p>{auth.error || (auth.status === 'forbidden' ? '管理后台只向已授权的协会管理员开放。普通会员可继续浏览网站。' : '云端后台需要有效登录，并由服务器确认管理员权限。')}</p>{auth.status !== 'checking' && <div className="admin-access-actions"><ButtonLink to="/login">前往登录</ButtonLink><Link to="/">返回网站</Link></div>}</section> : <>
      {section === 'overview' && <><div className="admin-stats">{stats.map(({ name, value, icon: Icon, hint, color }) => <article key={name} className="admin-stat"><div><span>{name}</span><span className={`admin-stat-icon ${color}`}><Icon size={19} /></span></div><strong>{value}<small>条</small></strong><p>{hint}</p></article>)}</div><div className="admin-overview-grid"><div>{contentTable(true)}</div><aside className="admin-side-panels"><section className="admin-panel admin-status-panel"><span className="admin-small-label">工作空间状态</span><h2>准备好下一次出发</h2><div className="admin-state-line"><span><i className={local ? 'orange' : 'green'} />内容存储</span><strong>{local ? '此浏览器' : 'Supabase'}</strong></div><div className="admin-state-line"><span>正式发布</span><strong>{local ? '尚未连接' : '由 RLS 管理'}</strong></div><div className="admin-state-line"><span>示例统计</span><strong>已排除</strong></div><Link to={adminPath("/admin/services")}>查看服务配置<ArrowRight size={14} /></Link></section><section className="admin-panel admin-reminder"><Bell size={21} /><h2>出发前，准备充分。</h2><p>活动正式发布前，请核实时间、路线、带队安排与安全计划。</p><Link to={adminPath("/admin/activities")}>前往活动管理<ArrowRight size={14} /></Link></section></aside></div></>}
      {kind && <><div className="admin-list-toolbar"><label className="admin-search"><Search size={17} /><input aria-label="搜索内容" value={query} onChange={event => setQuery(event.target.value)} placeholder={`搜索${KIND_NAMES[kind]}名称、类别…`} /></label><span>{local ? '本地草稿工作区' : '云端内容工作区'}</span></div>{contentTable()}</>}
      {section === 'devices' && <DeviceDetection />}
      {section === 'backgrounds' && <SiteImagesAdmin key={auth.epoch} local={local} expectedUserId={auth.user?.id} />}
      {section === 'password' && <PasswordPanel key={auth.epoch} connected={!local} expectedUserId={auth.user?.id} expectedEpoch={auth.epoch} onNotice={setNotice} />}
      {section === 'services' && <PaymentSettingsAdmin key={auth.epoch} local={local} expectedUserId={auth.user?.id}/> }
      {['accounts', 'services'].includes(section) && <section className="admin-panel admin-pending"><div className="admin-pending-icon">{section === 'accounts' ? <Users size={32} /> : <SlidersHorizontal size={32} />}</div><h2>{section === 'services' ? '服务连接与配置' : `${title}待接入`}</h2><p>{section === 'accounts' ? '真实成员账号需要受保护的服务端管理接口。这里不会展示虚构账号，也不会在浏览器存放管理员密钥。' : isBackendConfigured ? '内容、图片上传及报名管理使用已连接服务；微信收款码通过上方设置统一维护，到账由管理员人工核实。' : '当前运行本地设计预览。接入真实服务后，可使用账号登录、云端内容与发布能力。'}</p>{section === 'services' && <div className="admin-config-summary"><span>内容存储<strong>{local ? '浏览器本地草稿' : 'Supabase · RLS 权限'}</strong></span><span>文件上传<strong>影像照片 · 活动封面</strong></span><span>报名管理<strong>活动名单 · 凭证核验 · 操作日志</strong></span><span>账号管理<strong>待接入</strong></span></div>}<Link className="admin-text-link" to={section === 'services' ? '/' : adminPath('/admin/activities')}>{section === 'services' ? '返回网站' : '前往活动管理'}<ArrowRight size={15} /></Link></section>}
      {!nav && <section className="admin-panel"><EmptyState title="没有找到这个后台页面" description="请选择左侧的管理模块继续。" /></section>}
      </>}
      <footer className="admin-footer"><span>川衡登山协会 · 管理工作空间</span><span>以山为伴，一路同行。</span></footer>
    </section></div>
    {registrationActivity && allowed && <ActivityRegistrationAdmin key={`${registrationActivity.id}:${auth.user?.id || 'preview'}:${auth.epoch}`} activity={registrationActivity} local={local} expectedUserId={auth.user?.id} onClose={() => setRegistrationActivity(null)} />}
    {contentEditor}
  </div>;
}

export function ContentEditor({ editor, rows = [], onRefreshRoutes = () => {}, routesLoading = false, routesError = '', local, busy, error, onSave, onClose, onDirtyChange = () => {} }) {
  const dialog = useRef(null);
  const closeRef = useRef(onClose);
  const supportsTrack = editor.kind === 'route' || editor.kind === 'activity' && !editor.payload.routeSnapshot && Boolean(editor.payload.track || editor.payload.trackLocalId);
  const [routeId, setRouteId] = useState(editor.payload.routeId || '');
  const [selectedRoute, setSelectedRoute] = useState(() => rows.find(row => row.kind === 'route' && row.id === editor.payload.routeId));
  const availableRoutes = rows.filter(row => row.kind === 'route' && !row.payload?.archived && !row.payload?.isDemo && !row.isDemo);
  const [routeTitle, setRouteTitle] = useState(editor.payload.title || '');
  const normalizedTitle = normalizeRouteTitle(routeTitle);
  const matchingRoutes = editor.kind === 'route' && normalizedTitle
    ? availableRoutes.filter(row => row.id !== editor.id && normalizeRouteTitle(row.payload?.title) === normalizedTitle)
    : [];
  const nameCheckUnavailable = editor.kind === 'route' && (routesLoading || Boolean(routesError));
  const snapshot = routeId === (editor.payload.routeId || '') ? editor.payload.routeSnapshot : null;
  const keepsLegacyTrack = !editor.payload.routeSnapshot && Boolean(editor.payload.track || editor.payload.trackLocalId) && routeId === (editor.payload.routeId || '');
  const routeData = snapshot || (keepsLegacyTrack ? editor.payload : routeId ? selectedRoute?.payload : null);
  function changeRoute(id) { setRouteId(id); setSelectedRoute(availableRoutes.find(row => row.id === id)); }

  const [track, setTrack] = useState(() => supportsTrack ? editor.payload.track || (editor.payload.trackLocalId ? undefined : null) : null);
  const [trackLoading, setTrackLoading] = useState(supportsTrack && !editor.payload.track && Boolean(editor.payload.trackLocalId));
  const [trackLoadError, setTrackLoadError] = useState('');
  const [trackRetry, setTrackRetry] = useState(0);
  const [trackConverting, setTrackConverting] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [activityStatus, setActivityStatus] = useState(editor.payload.status || '即将开始');
  const [pageContent, setPageContent] = useState(() => readActivityPageContent(editor.payload));
  const [previewValues, setPreviewValues] = useState(editor.payload);
  const formId = 'activity-content-editor-form';
  const dirty = useRef(false);
  function markDirty() { dirty.current = true; onDirtyChange(); }
  function changePageContent(next) { markDirty(); setPageContent(next); }
  useEffect(() => {
    if (editor.kind !== 'activity') return undefined;
    const activeHistoryIndex = window.history.state?.idx;
    const beforeUnload = event => { if (dirty.current) { event.preventDefault(); event.returnValue = ''; } };
    // Capture browser history traversal before BrowserRouter unmounts this page.
    // Navigation within the admin area is handled by AdminPage's route effect.
    const beforeHistoryLeave = event => {
      if (!dirty.current || /^\/admin(?:\/|$)/.test(window.location.pathname)) return;
      const targetIndex = event.state?.idx;
      if (!Number.isInteger(activeHistoryIndex) || !Number.isInteger(targetIndex) || activeHistoryIndex === targetIndex) return;
      if (window.confirm('还有未保存的活动修改，确定离开并放弃修改吗？')) { dirty.current = false; return; }
      event.stopImmediatePropagation();
      window.history.go(activeHistoryIndex - targetIndex);
    };
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('popstate', beforeHistoryLeave, true);
    return () => { window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('popstate', beforeHistoryLeave, true); };
  }, [editor.kind]);
  function updatePreview(event) {
    if (editor.kind !== 'activity') return;
    markDirty();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    for (const field of ['dateStart', 'dateEnd', 'registrationStart', 'registrationDeadline']) {
      const value = values[field];
      if (value && Number.isFinite(new Date(value).getTime())) values[field] = new Date(value).toISOString();
      else if (!value && /^\d{4}-\d{2}-\d{2}$/.test(editor.payload[field] || '')) values[field] = editor.payload[field];
    }
    setPreviewValues(current => ({...current, ...values}));
  }
  const previewMetrics = routeData || (editor.payload.routeSnapshot ? {} : editor.payload);
  const previewTrackMetrics = resolvedTrackMetrics(track);
  const previewItem = {
    ...editor.payload, ...previewValues, pageContent, status: activityStatus,
    location: previewMetrics.location || trackLocationLabel(track?.location) || '',
    distance: Object.hasOwn(previewMetrics, 'distance') ? previewMetrics.distance : previewTrackMetrics.distanceM === null ? null : previewTrackMetrics.distanceM / 1000,
    ascent: Object.hasOwn(previewMetrics, 'ascent') ? previewMetrics.ascent : previewTrackMetrics.ascentM,
  };
  closeRef.current = onClose;
  useEffect(() => {
    if (!supportsTrack) return undefined;
    let alive = true;
    if (editor.payload.track) {
      setTrack(editor.payload.track); setTrackLoading(false); setTrackLoadError('');
      return undefined;
    }
    if (!editor.payload.trackLocalId) {
      setTrack(null); setTrackLoading(false); setTrackLoadError('');
      return undefined;
    }
    setTrack(undefined); setTrackLoading(true); setTrackLoadError('');
    async function loadTrack() {
      try {
        const existing = await getLocalTrack(editor.payload.trackLocalId);
        if (!existing) throw new Error('missing');
        if (alive) { setTrack(existing); setTrackLoading(false); }
      } catch {
        if (alive) {
          setTrack(undefined); setTrackLoading(false);
          setTrackLoadError(editor.kind === 'activity' ? '未能读取历史轨迹，请重试读取。历史轨迹保留不变。' : '未能读取原有轨迹。请重试；如文件确已丢失，可明确移除旧轨迹引用后再保存。');
        }
      }
    }
    loadTrack();
    return () => { alive = false; };
  }, [editor.kind, editor.payload.track, editor.payload.trackLocalId, trackRetry]);
  const trackBlocked = supportsTrack && (trackLoading || Boolean(trackLoadError) || trackConverting);
  function changeTrack(value) { setTrack(value); setTrackLoading(false); setTrackLoadError(''); }
  function submit(event) {
    if (trackBlocked || imageBusy) { event.preventDefault(); return; }
    onSave(event, supportsTrack ? track : undefined, selectedRoute);
  }
  useEffect(() => {
    if (editor.kind === 'activity') return undefined;
    const previous = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.querySelector('input')?.focus();
    const keydown = event => {
      if (event.defaultPrevented) return;
      if (event.key === 'Escape') closeRef.current();
      if (event.key !== 'Tab') return;
      const elements = [...dialog.current.querySelectorAll('a[href], input, textarea, select, button, [tabindex]')].filter(element => !element.disabled && element.tabIndex >= 0 && element.getClientRects().length > 0 && !element.closest('[aria-hidden="true"]'));
      if (!elements.length) return;
      const first = elements[0]; const last = elements[elements.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.current.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.current.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', keydown); previous?.focus(); };
  }, []);
  const formContent = <form id={formId} onSubmit={submit} onInput={updatePreview} onChange={updatePreview}>
        {editor.kind === 'activity' && <div id="editor-basic" className="activity-editor-section-heading"><h2>基本信息</h2><p>设置活动信息、报名规则与关联路线。</p></div>}
        <label>内容标题<span>*</span><input name="title" defaultValue={editor.payload.title || ''} onInput={event => setRouteTitle(event.currentTarget.value)} aria-describedby={nameCheckUnavailable || matchingRoutes.length ? 'route-name-feedback' : undefined} maxLength={120} required placeholder={editor.kind === 'route' ? '输入路线名称' : '给这次出发起一个名字'} /></label>
        {nameCheckUnavailable ? <div className="admin-route-name-feedback" id="route-name-feedback" role="status"><p>{routesLoading ? '正在读取已有路线，暂无法核对重名。' : '路线列表读取失败，暂无法核对重名。'}</p><button type="button" className="admin-btn" disabled={routesLoading || busy} onClick={onRefreshRoutes}>{routesLoading ? '正在读取…' : '重新读取路线'}</button></div> : matchingRoutes.length > 0 && <section className="admin-route-name-feedback" id="route-name-feedback" role="status" aria-live="polite" aria-atomic="true"><h3>已有 {matchingRoutes.length} 条同名路线</h3><p>请核对已有路线，或修改名称以便区分。同名不代表相同路线，保存不会合并、覆盖或归档已有记录。</p><ul>{matchingRoutes.slice(0, 3).map(row => <li key={row.id}><strong>{row.payload.title}</strong><span>{row.payload.location || '地点未填写'} · {row.payload.source || '来源未注明'} · {row.published ? '已发布' : '草稿'}</span></li>)}</ul>{matchingRoutes.length > 3 && <p>另有 {matchingRoutes.length - 3} 条同名路线，可在路线管理搜索核对。</p>}</section>}
        {editor.kind === 'route' && !nameCheckUnavailable && <div className="admin-route-tools"><small>按当前已加载的路线核对名称。</small><button type="button" className="admin-btn" disabled={busy} onClick={onRefreshRoutes}>刷新已有路线</button></div>}
        {editor.kind === 'activity'
          ? <label>活动种类<select name="type" defaultValue={editor.payload.type || ''}><option value="">请选择活动种类</option>{activityTypeOptions([editor.payload.type, ...rows.filter(row => row.kind === 'activity').map(row => row.payload?.type)]).map(type => <option key={type} value={type}>{type}</option>)}</select></label>
          : <label>内容类别<input name="type" defaultValue={editor.payload.type || ''} maxLength={40} placeholder="例如：山地徒步" /></label>}
        <ContentFields editor={editor} track={track} routeData={routeData} trackBlocked={trackBlocked} activityStatus={activityStatus} onStatusChange={setActivityStatus} />
        {editor.kind === 'activity' && <section className="admin-activity-route" aria-label="活动关联路线">
          <label>关联路线<select name="routeId" value={routeId} onChange={event => changeRoute(event.target.value)}><option value="">暂不关联路线</option>{routeId && !availableRoutes.some(row => row.id === routeId) && <option value={routeId}>已关联路线（当前不可选）</option>}{availableRoutes.map(row => <option key={row.id} value={row.id}>{row.payload.title}{row.payload.location ? ` · ${row.payload.location}` : ''}{Number.isFinite(row.payload.distance) ? ` · ${row.payload.distance} km` : ''}{row.payload.track || row.payload.trackLocalId ? ' · 有轨迹' : ' · 无轨迹'}</option>)}</select></label>
          <div className="admin-route-tools"><Link to={local ? '/admin/routes?preview=1' : '/admin/routes'} target="_blank" rel="noopener noreferrer">打开路线管理 ↗</Link><button className="admin-btn" type="button" onClick={onRefreshRoutes} disabled={routesLoading}>{routesLoading ? '正在刷新…' : '刷新路线列表'}</button></div>
          {routesError && <p role="alert">路线列表读取失败，请刷新后重试。当前填写内容已保留。</p>}
          <p>轨迹统一在路线管理上传。活动保存选择时的路线版本，路线更新不会改变活动历史；改选路线才会更新。</p>
        </section>}
        {supportsTrack && <div className="admin-route-track"><div className="admin-route-track-heading"><h3>{editor.kind === 'activity' ? '历史轨迹（只读）' : '路线轨迹'}</h3>{editor.kind === 'route' && <span>GPX / KML</span>}</div>{trackLoading ? <p className="admin-track-loading" role="status">正在读取原有轨迹，完成前暂不可保存……</p> : trackLoadError ? <div className="admin-track-load-error" role="alert"><p>{trackLoadError}</p><div><button type="button" className="admin-btn" disabled={busy} onClick={() => { setTrackLoading(true); setTrackLoadError(''); setTrackRetry(value => value + 1); }}>重试读取</button>{editor.kind === 'route' && <button type="button" className="admin-btn danger" disabled={busy} onClick={() => changeTrack(null)}>移除旧轨迹引用</button>}</div></div> : editor.kind === 'route' ? <TrackUpload value={track ?? null} onChange={changeTrack} onBusyChange={setTrackConverting} disabled={busy} local={local} /> : <p className="admin-legacy-track">{track?.name || '历史活动轨迹'} · 保留原有轨迹，不支持在活动中上传或移除。</p>}</div>}
        <label>内容简介<textarea name="description" defaultValue={editor.payload.description || ''} rows={4} maxLength={3000} placeholder="写下内容介绍与需要知道的信息…" /></label>
        {editor.kind === 'activity' ? <ActivityCoverUpload initialValue={editor.payload.image || ''} onChange={image => { markDirty(); setPreviewValues(current => ({...current,image})); }} onBusyChange={setImageBusy} disabled={busy} local={local} /> : editor.kind === 'photo' ? <GalleryPhotoUpload initialValue={editor.payload.image || ''} onBusyChange={setImageBusy} disabled={busy} local={local} /> : <ImageUpload allowUrl initialValue={editor.payload.image || ''} onBusyChange={setImageBusy} disabled={busy} local={local} label={editor.kind === 'route' ? '路线封面' : '资讯封面'} />}
        {editor.kind === 'activity' && <ActivityContentFields value={pageContent} onChange={changePageContent} disabled={busy} />}
        {!local && <label className="admin-checkbox"><input type="checkbox" name="published" defaultChecked={editor.published} />发布到云端内容表</label>}
        {error && <div className="admin-message error" role="alert">{error}</div>}
        <div className="admin-form-actions"><button className="admin-btn" type="button" onClick={onClose} disabled={busy}>取消</button><button className="admin-btn primary" disabled={busy || trackBlocked || imageBusy}><Check size={16} />{imageBusy ? editor.kind === 'photo' ? '正在处理照片…' : '正在处理封面…' : busy ? '正在保存…' : local ? '保存本地草稿' : '保存内容'}</button></div>
      </form>;
  if (editor.kind === 'activity') return <ActivityEditorWorkspace item={previewItem} routeData={routeData} legacyTrack={keepsLegacyTrack || !routeId ? track : null} local={local} editing={Boolean(editor.id)} formId={formId} busy={busy} saveDisabled={busy || trackBlocked || imageBusy} error={error} onClose={onClose}>{formContent}</ActivityEditorWorkspace>;
  return <div className="admin-modal-overlay" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialog} className={`admin-modal ${supportsTrack ? 'admin-route-modal' : ''}`} role="dialog" aria-modal="true" aria-labelledby="content-editor-title">
      <div className="admin-modal-heading"><div><span className="admin-eyebrow">CONTENT EDITOR</span><h2 id="content-editor-title">{editor.id ? '编辑' : '新建'}{KIND_NAMES[editor.kind]}</h2></div><button aria-label="关闭编辑器" onClick={onClose} disabled={busy}><X size={22} /></button></div>
      <p>{local ? '保存后成为本地草稿，尚未发布。' : '内容由云端 RLS 权限保护。请核实后发布。'}</p>
      {formContent}
    </section>
  </div>;
}

function ContentFields({ editor, track, routeData, trackBlocked = false, activityStatus, onStatusChange }) {
  const { kind, payload } = editor;
  const activityMetrics = routeData || (payload.routeSnapshot ? {} : payload);
  const effective=resolvedTrackMetrics(track);
  const activityDistance=Object.hasOwn(activityMetrics,'distance')?activityMetrics.distance:effective.distanceM===null?null:effective.distanceM/1000;
  const activityAscent=Object.hasOwn(activityMetrics,'ascent')?activityMetrics.ascent:effective.ascentM;
  const detectedLocation = kind === 'activity' ? activityMetrics.location || trackLocationLabel(track?.location) || '' : '';
  return <>
    {['activity', 'route'].includes(kind) && <>
      <div className="admin-field-grid"><label>目的地<input key={detectedLocation || 'manual-location'} name="location" defaultValue={kind === 'activity' ? detectedLocation : payload.location || ''} readOnly={kind === 'activity' || Boolean(detectedLocation)} maxLength={100} placeholder="例如：广东 · 深圳" />{detectedLocation && <small>来自轨迹地点识别</small>}</label><label>难度<select name="difficulty" defaultValue={payload.difficulty || '入门'}><option>入门</option><option>进阶</option><option>挑战</option></select></label></div>
      {kind === 'activity' ? <dl className="admin-field-grid admin-track-metrics"><div><dt>里程（km）</dt><dd>{formatActivityDistance(activityDistance)}</dd></div><div><dt>累计爬升（m）</dt><dd>{formatActivityAscent(activityAscent)}</dd></div><small>来自所选路线或历史轨迹；参数请在路线管理维护。</small></dl> : track ? <div className="admin-field-grid admin-track-metrics" key="track-metrics"><label>里程（km）<input name="distance" type="number" step="any" value={Number.isFinite(effective.distanceM) ? effective.distanceM / 1000 : ''} readOnly /><small>{effective.sources.distance==='administrator'?'管理员补充':effective.sources.distance==='track'?'轨迹自动计算':'暂不提供数据'}</small></label><label>累计爬升（m）<input name="ascent" type="number" step="any" value={Number.isFinite(effective.ascentM) ? effective.ascentM : ''} placeholder="源文件未提供" readOnly /><small>{effective.sources.ascent==='administrator'?'管理员补充；原海拔数据保留':effective.sources.ascent==='track'?'轨迹自动计算':'暂不提供数据'}</small></label></div> : <div className="admin-field-grid" key="manual-metrics"><label>里程（km）<input name="distance" type="number" min="0" max="100000" step="any" defaultValue={payload.distance ?? 0} disabled={trackBlocked} /></label><label>累计爬升（m）<input name="ascent" type="number" min="0" max="100000" step="any" defaultValue={payload.ascent ?? ''} disabled={trackBlocked} /></label></div>}
    </>}
    {kind === 'activity' && <>
      <div className="admin-field-grid"><label>活动开始时间<input name="dateStart" type="datetime-local" defaultValue={toLocalDateTime(payload.dateStart)} />{/^\d{4}-\d{2}-\d{2}$/.test(payload.dateStart || '') && <small>原记录日期：{payload.dateStart}，具体时刻未知，留空保留原日期。</small>}</label><label>活动结束时间<input name="dateEnd" type="datetime-local" defaultValue={toLocalDateTime(payload.dateEnd)} /></label></div>
      <label>活动状态<select name="status" value={activityStatus} onChange={event => onStatusChange(event.target.value)}><option>即将开始</option><option>报名中</option><option>进行中</option><option>已结束</option></select></label>
      <label className="admin-checkbox"><input name="showInHistory" type="checkbox" defaultChecked={payload.showInHistory === true} aria-describedby="activity-history-help" />展示到大事记</label>
      <small id="activity-history-help">可提前勾选；活动已发布、已结束且日期完整时，才会在关于页“一路走来”展示。</small>
      <label>日期说明<input name="date" defaultValue={payload.date || ''} maxLength={100} placeholder="补充集合时间等说明" /></label>
      <label>预设报名人数<input name="registrationCapacity" type="number" min="1" max="100000" step="1" defaultValue={payload.registrationCapacity ?? ''} placeholder="例如：5" /><small>按有效报名时间排序，名额内入选，其余候补；退出后顺次递补。旧活动未设置时保持未知。</small></label>
      <label>报名费用（元）<input name="registrationFee" type="number" min="0" step="0.01" inputMode="decimal" defaultValue={registrationFeeInputValue(payload.registrationFeeCents)} placeholder="例如：50.00" /><small>留空显示“未公布”，填写0显示“免费”。金额会显示在活动报名区域与缴费窗口。</small></label>
      <label>缴费说明<textarea name="paymentInstructions" defaultValue={payload.paymentInstructions || ''} maxLength={1000} rows={3} placeholder="请填写缴费方式、联系人员等正式说明" /><small>入选且未缴费的会员会看到此说明。会员上传记录后显示“应已缴费”，管理员核实后再改为“已缴费”。</small></label>
      <label className="admin-checkbox"><input name="registrationOpen" type="checkbox" defaultChecked={payload.registrationOpen === true} />开启活动报名</label>
      <div className="admin-field-grid"><label>报名开启时间<input name="registrationStart" type="datetime-local" defaultValue={toLocalDateTime(payload.registrationStart)} /></label><label>报名截止时间<input name="registrationDeadline" type="datetime-local" defaultValue={toLocalDateTime(payload.registrationDeadline)} /></label></div>
      <p className="admin-schedule-note">按本地时区填写。报名开启须早于截止，截止不晚于活动开始，活动结束须晚于开始。草稿可暂留空；已截止的活动仍可编辑保存。</p>
    </>}
    {kind === 'route' && <>
      <label>路线来源<input name="source" defaultValue={payload.source || '协会整理'} maxLength={100} placeholder="例如：协会整理" /></label>
      <label className="admin-checkbox"><input name="featured" type="checkbox" defaultChecked={payload.featured === true} />设为精选路线</label>
    </>}
    {['photo', 'article'].includes(kind) && <label>栏目分类<input name="category" defaultValue={payload.category || ''} maxLength={60} placeholder={kind === 'photo' ? '例如：精选摄影' : '例如：协会动态'} /></label>}
    {kind === 'article' && <>
      <div className="admin-field-grid"><label>文章日期<input name="date" defaultValue={payload.date || ''} maxLength={100} placeholder="例如：2026.10.30" /></label><label>阅读时间（分钟）<input name="readTime" type="number" min="1" max="240" step="1" defaultValue={payload.readTime || 5} /></label></div>
      <label>文章正文<textarea name="body" defaultValue={Array.isArray(payload.body) ? payload.body.map(block => `${block.heading || ''}\n${block.text || ''}`).join('\n\n') : ''} rows={7} maxLength={30000} placeholder="写下完整的文章内容…" /><small>保存为正文段落；原有内容文字会保留在编辑框中。</small></label>
    </>}
  </>;
}

function PasswordPanel({ connected, expectedUserId, expectedEpoch, onNotice }) {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const active = () => {
    const current = getAdminSession(supabase).getSnapshot();
    return alive.current && current.status === 'admin' && current.user?.id === expectedUserId && current.epoch === expectedEpoch;
  };
  async function submit(event) {
    event.preventDefault(); if (!supabase || !connected) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const password = String(values.get('password'));
    if (password !== values.get('confirmation')) return setError('两次输入的密码不一致。');
    if (password.length < 8) return setError('密码至少需要 8 个字符。');
    setBusy(true); setError('');
    try {
      await requireVerifiedAdmin(expectedUserId, expectedEpoch);
      if (!active()) return;
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (!active()) return;
      if (updateError) throw new Error('密码修改未完成，可能需要重新验证身份。请按项目认证设置重新登录后重试。');
      form.reset(); onNotice('密码已通过认证服务更新。');
    } catch (caught) { if (active()) setError(caught.message); }
    finally { if (active()) setBusy(false); }
  }
  return <section className="admin-panel admin-form-panel"><h2>更新登录密码</h2><p>{connected ? '为当前已验证的管理账号设置新的登录密码。' : '本地预览没有账号。连接认证服务后才能更新真实密码。'}</p><form onSubmit={submit}><label>新密码<div className="admin-password-field"><input name="password" type={visible ? 'text' : 'password'} minLength={8} maxLength={128} autoComplete="new-password" required disabled={!connected} placeholder="至少 8 位字符" /><button type="button" onClick={() => setVisible(value => !value)} aria-label={visible ? '隐藏密码' : '显示密码'}>{visible ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></label><label>确认新密码<input name="confirmation" type={visible ? 'text' : 'password'} minLength={8} maxLength={128} autoComplete="new-password" required disabled={!connected} placeholder="再次输入新密码" /></label>{error && <p role="alert" className="admin-inline-error">{error}</p>}<button className="admin-btn primary" disabled={!connected || busy}><KeyRound size={16} />{busy ? '正在更新…' : '更新密码'}</button></form></section>;
}

export function LoginPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const register = new URLSearchParams(location.search).get('mode') === 'register';
  const next = safeInternalReturn(new URLSearchParams(location.search).get('next'));
  const loginPath = next ? `/login?next=${encodeURIComponent(next)}` : '/login';
  const registerPath = next ? `/login?mode=register&next=${encodeURIComponent(next)}` : '/login?mode=register';
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pendingEmail, setPendingEmail] = useState('');
  const requestVersion = useRef(0);
  const submitting = useRef(false);
  const emailRedirectTo = `${typeof window === 'undefined' ? '' : window.location.origin}/login`;
  useEffect(() => {
    setError(''); setNotice(''); setPendingEmail(''); setBusy(false); submitting.current = false;
    return () => { requestVersion.current++; };
  }, [location.search]);
  useEffect(() => {
    const callback = new URLSearchParams(location.hash.replace(/^#/, ''));
    if (callback.get('error') || callback.get('error_code')) setError('邮箱验证链接无效或已过期，请重新登录或重新申请验证邮件。');
  }, [location.hash]);
  async function submit(event) {
    event.preventDefault(); setError(''); setNotice('');
    if (submitting.current) return;
    if (!supabase) { setError(runtimeMode.allowLocalPreview ? '当前为本地设计预览，登录与注册尚未连接。可使用下方入口浏览网站或管理本地草稿。' : '登录服务暂时不可用，请稍后重试。'); return; }
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email')).trim(); const password = String(form.get('password'));
    if (register && password !== form.get('confirmation')) return setError('两次输入的密码不一致。');
    const current = ++requestVersion.current;
    const active = () => current === requestVersion.current;
    const formElement = event.currentTarget;
    submitting.current = true; setBusy(true);
    try {
      if (register) {
        const { data, error: signupError } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo } });
        if (!active()) return;
        if (signupError) throw new Error('注册未完成，请检查邮箱格式、密码要求或稍后重试。');
        if (data.session) {
          const { data: verified, error: verificationError } = await supabase.auth.getUser();
          if (!active()) return;
          if (verificationError || !verified?.user) throw new Error('账号已创建，但无法确认登录状态，请验证邮箱或重新登录。');
          if (next) navigate(next, { replace: true });
          else setNotice('账号已注册并登录。普通会员可继续浏览网站，后台需要另行授权。');
        } else { formElement.reset(); setPendingEmail(email); }
      } else {
        const { error: signinError } = await supabase.auth.signInWithPassword({ email, password });
        if (!active()) return;
        if (signinError) throw new Error('登录未完成，请检查邮箱、密码及邮件验证状态。');
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (!active()) return;
        if (userError || !user) throw new Error('无法确认登录身份，请稍后重试。');
        navigate(next || (user.app_metadata?.role === 'admin' ? '/admin' : '/'), { replace: true });
      }
    } catch (caught) { if (active()) setError(caught.message || '暂时无法连接认证服务。'); }
    finally { if (active()) { submitting.current = false; setBusy(false); } }
  }
  return <section className="login-page"><SiteImage className="login-background" slot="loginBackground" alt="" /><div className="login-shade" /><header className="login-header"><Link className="login-brand" to="/"><img className="login-official-badge" src={OFFICIAL_BADGE} alt="川衡社官方徽章" width="46" height="46"/><span>川衡<span>CHUANHENG</span></span></Link><Link to="/"><ArrowLeft size={15} />返回网站</Link></header><div className="login-layout"><div className="login-story"><span>THE MOUNTAINS ARE CALLING</span><h1>山野很远，<br />我们一起。</h1><p>每一次出发，都是和更辽阔的自己相遇。</p><div><i /><span>以山为伴 · 一路同行</span></div></div><section className="login-card"><span className="login-card-eyebrow">CHUANHENG COMMUNITY</span><h2>{pendingEmail ? '验证邮箱，继续启程' : register ? '开启你的山野之旅' : '欢迎回来'}</h2><p>{pendingEmail ? '完成邮箱验证，即可加入川衡。' : register ? '加入川衡，遇见一起出发的人。' : '登录川衡，继续你的探索。'}</p><div className="login-tabs"><Link className={!register ? 'active' : ''} to={loginPath}>登录</Link><Link className={register ? 'active' : ''} to={registerPath}>注册</Link></div>{!isBackendConfigured && <div className="login-preview-label"><span />{runtimeMode.allowLocalPreview ? '本地设计预览 · 认证服务尚未连接' : '登录服务暂时不可用，请稍后重试。'}</div>}{pendingEmail ? <SignupVerification key={`${pendingEmail}:${location.search}`} email={pendingEmail} emailRedirectTo={emailRedirectTo} onVerified={() => navigate(next || '/', { replace: true })} onChangeEmail={() => { setPendingEmail(''); setError(''); setNotice(''); }} /> : <form key={register ? 'register' : 'login'} onSubmit={submit}><label>邮箱地址<input type="email" name="email" autoComplete="email" placeholder="输入你的邮箱" maxLength={254} required /></label><label>登录密码<div className="login-password-field"><input type={showPassword ? 'text' : 'password'} name="password" autoComplete={register ? 'new-password' : 'current-password'} placeholder={register ? '设置至少 8 位密码' : '输入你的密码'} minLength={register ? 8 : 1} maxLength={128} required /><button type="button" aria-label={showPassword ? '隐藏密码' : '显示密码'} onClick={() => setShowPassword(value => !value)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></label>{register && <label>确认密码<input type={showPassword ? 'text' : 'password'} name="confirmation" autoComplete="new-password" placeholder="再次输入密码" minLength={8} maxLength={128} required /></label>}{!register && <div className="login-form-note"><ShieldCheck size={14} /><span>你的密码由认证服务安全管理</span></div>}{error && <div className="login-feedback error" role="alert">{error}</div>}{notice && <div className="login-feedback success" role="status">{notice}</div>}<button className="login-submit" disabled={busy || !supabase}>{busy ? '正在连接…' : register ? '创建账号' : '登录'}<ArrowRight size={18} /></button></form>}<div className="login-visitor"><Link to="/">以访客身份，继续探索<ArrowRight size={15} /></Link>{runtimeMode.allowLocalPreview && !isBackendConfigured && <Link className="login-preview-entry" to="/admin">进入本地设计预览</Link>}</div><p className="login-bottom-note">{register ? '注册后为普通会员，后台管理需额外授权。' : '山野相逢，从这里开始。'}</p></section></div><footer className="login-footer"><span>© {new Date().getFullYear()} 川衡登山协会</span><SiteImageCredit slot="loginBackground" as="span" className="" /></footer></section>;
}
