const DATABASE = 'chuanheng-tracks';
const STORE = 'tracks';
export const DRAFT_KEY = 'chuanheng-drafts';

// Keep large geometry outside localStorage; content records only carry its ID.
async function database() {
  if (!globalThis.indexedDB) throw new Error('此浏览器不支持保存轨迹，请导出转换结果。');
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('无法打开本地轨迹存储，请检查浏览器存储设置。'));
    request.onblocked = () => reject(new Error('轨迹存储被其他页面占用，请关闭旧页面后重试。'));
  });
}
async function operate(mode, action) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = action(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result ?? null);
      transaction.onabort = transaction.onerror = () => reject(new Error('轨迹保存或读取失败，可能是浏览器空间不足。请先导出文件再重试。'));
    });
  } finally { db.close(); }
}
export async function putLocalTrack(track, id = crypto.randomUUID()) {
  if (!track || track.version !== 1 || !track.geojson) throw new Error('轨迹转换结果无效，请重新导入。');
  await operate('readwrite', store => store.put(track, id));
  return id;
}
export function getLocalTrack(id) { return id ? operate('readonly', store => store.get(id)) : Promise.resolve(null); }
export function deleteLocalTrack(id) { return operate('readwrite', store => store.delete(id)); }
export function routePayloadFromTrack(track, title = track.name) {
  return {title:String(title || '').trim() || '导入路线',description:'',location:'',difficulty:'待评估',source:'领队导入',isDemo:false,verified:false,distance:track.stats.distanceM / 1000,ascent:track.stats.ascentM};
}
export function readLocalRouteDraft(id) {
  return readLocalContentDraft(id,'route');
}
export function readLocalContentDraft(id,kind) {
  try {
    const drafts = JSON.parse(localStorage.getItem(DRAFT_KEY) || '[]');
    const record = Array.isArray(drafts) ? drafts.find(row => row?.id === id && row.kind === kind && !row.payload?.archived) : null;
    return record?.payload ? {...record.payload,id:record.id,published:false,localDraft:true} : null;
  } catch { return null; }
}
export async function saveImportedRouteDraft(track, title) {
  const trackId = await putLocalTrack(track);
  const id = crypto.randomUUID();
  try {
    const parsed = JSON.parse(localStorage.getItem(DRAFT_KEY) || '[]');
    if (!Array.isArray(parsed)) throw new Error();
    const record = {id,kind:'route',published:false,created_at:new Date().toISOString(),payload:{...routePayloadFromTrack(track,title),trackLocalId:trackId}};
    localStorage.setItem(DRAFT_KEY,JSON.stringify([record,...parsed]));
    window.dispatchEvent(new Event('chuanheng-drafts-updated'));
    return id;
  } catch {
    await deleteLocalTrack(trackId).catch(() => {});
    throw new Error('路线草稿保存失败，原有草稿未被覆盖。请导出结果或检查浏览器存储空间。');
  }
}
