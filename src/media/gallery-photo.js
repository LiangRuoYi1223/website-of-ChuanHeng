const originalLimit = 20 * 1024 * 1024;
const outputLimit = 3 * 1024 * 1024;
const acceptedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

function readFileDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('照片读取失败，请重新选择。'));
    reader.onabort = () => reject(new Error('照片读取已取消。'));
    reader.readAsDataURL(file);
  });
}

/** Only processed WebP may become a new immutable gallery object or local draft. */
export async function uploadGalleryPhoto(client, file, { local = false, fetchImpl = fetch, readDataUrl = readFileDataUrl, randomUUID = () => crypto.randomUUID(), signal } = {}) {
  if (!file || !acceptedTypes.has(file.type)) throw new Error('照片仅支持 JPEG、PNG 或 WebP 图片。');
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > originalLimit) throw new Error('请选择非空且不超过 20 MiB 的照片原图。');
  const operationSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000);
  operationSignal.throwIfAborted();
  const headers = {};
  let user;
  if (!local) {
    if (!client) throw new Error('尚未连接云端服务，请先完成配置。');
    const { data, error } = await client.auth.getUser();
    user = data?.user;
    if (error || !user?.id || user.app_metadata?.role !== 'admin') throw new Error('管理员身份校验未通过，请重新登录。');
    const { data: session, error: sessionError } = await client.auth.getSession();
    if (sessionError || !session?.session?.access_token) throw new Error('登录状态已失效，请重新登录后上传照片。');
    headers.Authorization = `Bearer ${session.session.access_token}`;
  }
  operationSignal.throwIfAborted();
  const body = new FormData(); body.append('file', file);
  let response;
  try { response = await fetchImpl('/api/photos/process', { method: 'POST', headers, body, signal: operationSignal }); }
  catch (error) {
    operationSignal.throwIfAborted();
    throw new Error('无法连接照片处理服务，请稍后重试。', { cause: error });
  }
  operationSignal.throwIfAborted();
  if (!response.ok) {
    let message;
    try { message = (await response.json())?.error?.message; } catch { /* use fallback */ }
    throw new Error(typeof message === 'string' && message ? message : '照片处理失败，请稍后重试。');
  }
  if (response.headers.get('x-photo-processed') !== '1' || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'image/webp') throw new Error('照片处理服务返回无效结果，请稍后重试。');
  const processed = await response.blob();
  if (!processed.size || processed.size > outputLimit) throw new Error('处理后的照片须非空且不超过 3 MiB，请重新选择。');
  const bytes = new Uint8Array(await processed.arrayBuffer());
  const signature = offset => String.fromCharCode(...bytes.slice(offset, offset + 4));
  if (bytes.length < 12 || signature(0) !== 'RIFF' || signature(8) !== 'WEBP') throw new Error('照片处理服务返回的 WebP 格式无效。');
  operationSignal.throwIfAborted();
  const output = new File([processed], 'photo.webp', { type: 'image/webp' });
  const metrics = { originalBytes: file.size, outputBytes: output.size };
  if (local) {
    const url = await readDataUrl(output);
    operationSignal.throwIfAborted();
    if (typeof url !== 'string' || !/^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/.test(url) || url.length > Math.ceil(outputLimit / 3) * 4 + 64) throw new Error('照片预览数据无效，请重新选择。');
    return { url, ...metrics };
  }
  const path = `${user.id}/${randomUUID()}.webp`;
  const bucket = client.storage.from('gallery-photos');
  const { error: uploadError } = await bucket.upload(path, output, { upsert: false, contentType: 'image/webp', cacheControl: '3600' });
  operationSignal.throwIfAborted();
  if (uploadError) throw new Error(uploadError.message || '照片上传失败，请稍后重试。');
  const url = bucket.getPublicUrl(path).data?.publicUrl;
  if (typeof url !== 'string' || !url.startsWith('https://')) throw new Error('无法取得照片地址，请稍后重试。');
  return { url, ...metrics };
}
