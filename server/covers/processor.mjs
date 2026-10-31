import { TrackError } from '../tracks/parse.mjs';
import { readBounded } from '../tracks/http.mjs';

export const MAX_COVER_BYTES = 3 * 1024 * 1024;
export const MAX_COVER_PIXELS = 40_000_000;
export const MAX_COVER_EDGE = 12000;
export const OUTPUT_COVER_EDGE = 1920;

export function detectImageFormat(bytes) {
  if (bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v)) return 'image/png';
  if (bytes.length >= 3 && bytes[0]===255 && bytes[1]===216 && bytes[2]===255) return 'image/jpeg';
  if (bytes.length >= 12 && [82,73,70,70].every((v,i)=>bytes[i]===v) && [87,69,66,80].every((v,i)=>bytes[i+8]===v)) return 'image/webp';
  return null;
}

export async function processCover(file, images, options = {}) {
  if (!images || typeof images.info !== 'function' || typeof images.input !== 'function') {
    throw new TrackError('IMAGE_SERVICE_UNAVAILABLE', '封面压缩服务尚未启用，请稍后重试。', 503);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const format = detectImageFormat(bytes);
  if (!format || format !== file.type) throw new TrackError('INVALID_IMAGE', '图片格式与文件内容不符，请选择有效的 JPEG、PNG 或 WebP 图片。', 415);
  const blob = new Blob([bytes], { type: format });
  const controller = new AbortController();
  let timer;
  const requested = Number(options.processingTimeoutMs);
  const timeoutMs = Number.isFinite(requested) && requested > 0 ? Math.min(requested,30000) : 30000;
  const deadline = new Promise((_,reject)=>{
    timer=setTimeout(()=>{
      reject(new TrackError('IMAGE_PROCESSING_TIMEOUT','封面压缩超时，请稍后重试。',504));
      controller.abort();
    },timeoutMs);
  });
  try {
    return await Promise.race([deadline,(async()=>{
      const info=await images.info(blob.stream());
      if (controller.signal.aborted) throw new TrackError('IMAGE_PROCESSING_TIMEOUT','封面压缩超时，请稍后重试。',504);
      const {width,height}=info || {};
      if (info?.format!==format || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width<=0 || height<=0 || Math.max(width,height)>MAX_COVER_EDGE || width*height>MAX_COVER_PIXELS) {
        throw new TrackError('INVALID_IMAGE','图片尺寸或格式无效；最长边不能超过 12000 像素，总像素不能超过 4000 万。',415);
      }
      const scale=Math.min(1,OUTPUT_COVER_EDGE/Math.max(width,height));
      const result=await images.input(blob.stream()).transform({width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale)),fit:'scale-down'}).output({format:'image/webp',quality:80,anim:false});
      if (controller.signal.aborted) throw new TrackError('IMAGE_PROCESSING_TIMEOUT','封面压缩超时，请稍后重试。',504);
      const response=result.response();
      if (!response.ok) throw new TrackError('IMAGE_PROCESSING_FAILED','封面压缩失败，请重新选择图片或稍后重试。',422);
      const output=await readBounded(response.body,MAX_COVER_BYTES,'IMAGE_OUTPUT_TOO_LARGE','压缩后的封面仍超过 3 MiB，请选择较小的图片。',413,controller.signal);
      if (detectImageFormat(output)!=='image/webp') throw new TrackError('INVALID_IMAGE_OUTPUT','压缩服务返回了无效图片，请稍后重试。',502);
      return {bytes:output,originalBytes:bytes.byteLength};
    })()]);
  } catch(error) {
    if(error instanceof TrackError) throw error;
    throw new TrackError('IMAGE_PROCESSING_FAILED','封面压缩失败，请重新选择图片或稍后重试。',422);
  } finally {clearTimeout(timer);}
}
