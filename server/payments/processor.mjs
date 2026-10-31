import { TrackError } from '../tracks/parse.mjs';
import { readBounded } from '../tracks/http.mjs';
import { detectImageFormat } from '../covers/processor.mjs';

export const MAX_PAYMENT_PROOF_SOURCE_BYTES = 8 * 1024 * 1024;
export const MAX_PAYMENT_PROOF_BYTES = 3 * 1024 * 1024;
const timeoutError = () => new TrackError('IMAGE_PROCESSING_TIMEOUT', '缴费记录图片处理超时，请稍后重试。', 504);

export async function processPaymentProof(file, images, options = {}) {
  if (!file?.size || file.size > MAX_PAYMENT_PROOF_SOURCE_BYTES) throw new TrackError('FILE_TOO_LARGE', '请选择非空且不超过 8 MiB 的缴费记录图片。', 413);
  if (!images || typeof images.info !== 'function' || typeof images.input !== 'function') throw new TrackError('IMAGE_SERVICE_UNAVAILABLE', '缴费记录图片服务尚未启用，请稍后重试。', 503);
  const controller = new AbortController();
  const supplied = Number(options.processingTimeoutMs);
  const timeoutMs = Number.isFinite(supplied) && supplied > 0 ? Math.min(supplied, 30000) : 30000;
  let timer;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => { reject(timeoutError()); controller.abort(); }, timeoutMs); });
  const checkDeadline = () => { if (controller.signal.aborted) throw timeoutError(); };
  try {
    return await Promise.race([deadline, (async () => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      checkDeadline();
      if (!bytes.byteLength || bytes.byteLength > MAX_PAYMENT_PROOF_SOURCE_BYTES) throw new TrackError('FILE_TOO_LARGE', '请选择非空且不超过 8 MiB 的缴费记录图片。', 413);
      const format = detectImageFormat(bytes);
      if (!format || format !== file.type) throw new TrackError('INVALID_IMAGE', '图片格式与文件内容不符，请选择有效的 JPEG、PNG 或 WebP 图片。', 415);
      const blob = new Blob([bytes], { type: format });
      const info = await images.info(blob.stream());
      checkDeadline();
      const { width, height } = info || {};
      if (info?.format !== format || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || Math.max(width, height) > 12000 || width * height > 40_000_000) throw new TrackError('INVALID_IMAGE', '缴费记录图片尺寸无效；最长边不能超过 12000 像素，总像素不能超过 4000 万。', 415);
      // Retain legible receipt text; each retry uses the same bounded deadline.
      for (const edge of [4096, 3072, 2560]) {
        const scale = Math.min(1, edge / Math.max(width, height));
        const dimensions = { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), fit: 'scale-down' };
        for (const quality of [90, 80, 70]) {
          checkDeadline();
          const result = await images.input(blob.stream()).transform(dimensions).output({ format: 'image/webp', quality, anim: false });
          checkDeadline();
          const response = result.response();
          if (!response.ok) { try { Promise.resolve(response.body?.cancel()).catch(() => {}); } catch { /* closed */ } throw new TrackError('IMAGE_PROCESSING_FAILED', '缴费记录图片处理失败，请重新选择图片。', 422); }
          let output;
          try { output = await readBounded(response.body, MAX_PAYMENT_PROOF_BYTES, 'IMAGE_OUTPUT_TOO_LARGE', '处理后的缴费记录图片仍超过 3 MiB，请选择较小图片。', 413, controller.signal); }
          catch (error) { checkDeadline(); if (error instanceof TrackError && error.code === 'IMAGE_OUTPUT_TOO_LARGE') continue; throw error; }
          checkDeadline();
          if (detectImageFormat(output) !== 'image/webp') throw new TrackError('INVALID_IMAGE_OUTPUT', '图片服务返回了无效结果，请稍后重试。', 502);
          return { bytes: output, originalBytes: bytes.byteLength };
        }
      }
      throw new TrackError('IMAGE_OUTPUT_TOO_LARGE', '处理后的缴费记录图片仍超过 3 MiB，请选择较小图片。', 413);
    })()]);
  } catch (error) { if (error instanceof TrackError) throw error; throw new TrackError('IMAGE_PROCESSING_FAILED', '缴费记录图片处理失败，请重新选择图片或稍后重试。', 422); }
  finally { clearTimeout(timer); }
}
