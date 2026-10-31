const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

function readFileDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('封面图片读取失败，请重新选择。'));
    reader.onabort = () => reject(new Error('封面图片读取已取消。'));
    reader.readAsDataURL(file);
  });
}

/** Upload a new immutable object, or return a bounded local-only preview URL. */
export async function uploadActivityCover(client, file, { local = false, readDataUrl = readFileDataUrl, randomUUID = () => crypto.randomUUID() } = {}) {
  const extension = file && Object.hasOwn(extensions, file.type) ? extensions[file.type] : null;
  if (!extension) throw new Error('封面仅支持 JPEG、PNG 或 WebP 图片。');
  const limit = (local ? 1 : 5) * 1024 * 1024;
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > limit) throw new Error(`请选择非空且不超过 ${local ? 1 : 5} MiB 的封面图片。`);
  if (local) {
    const value = await readDataUrl(file);
    if (typeof value !== 'string' || !new RegExp(`^data:${file.type};base64,[A-Za-z0-9+/]+={0,2}$`).test(value) || value.length > Math.ceil(limit / 3) * 4 + 64) throw new Error('图片预览数据无效，请重新选择。');
    return value;
  }
  if (!client) throw new Error('尚未连接云端服务，请先完成配置。');
  const { data, error } = await client.auth.getUser();
  const user = data?.user;
  if (error || !user?.id || user.app_metadata?.role !== 'admin') throw new Error('管理员身份校验未通过，请重新登录。');
  const path = `${user.id}/${randomUUID()}.${extension}`;
  const bucket = client.storage.from('activity-covers');
  const { error: uploadError } = await bucket.upload(path, file, { upsert: false, contentType: file.type, cacheControl: '3600' });
  if (uploadError) throw new Error(uploadError.message || '封面上传失败，请稍后重试。');
  const url = bucket.getPublicUrl(path).data?.publicUrl;
  if (typeof url !== 'string' || !url.startsWith('https://')) throw new Error('无法取得封面地址，请稍后重试。');
  return url;
}
