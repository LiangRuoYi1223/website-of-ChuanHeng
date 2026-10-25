import { Readable } from 'node:stream';
import { HttpError } from './validation.mjs';

export function storageHeaders(secretKey) {
  // New secret keys are opaque API keys, not JWT bearer tokens.
  return {
    apikey: secretKey,
    ...(secretKey.startsWith('sb_secret_') ? {} : { Authorization: `Bearer ${secretKey}` }),
  };
}

export function createStorage(config, fetcher = fetch) {
  const headers = storageHeaders(config.secretKey);
  const base = `${config.supabaseUrl}/storage/v1/object`;
  const objectPath = (filename) =>
    `${encodeURIComponent(config.bucket)}/${encodeURIComponent(filename)}`;
  return {
    async upload(filename, buffer, mime) {
      const response = await fetcher(`${base}/${objectPath(filename)}`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': mime, 'x-upsert': 'false' },
        body: buffer,
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) throw new HttpError(502, '图片暂时无法保存，请检查云端存储配置后重试。');
    },
    async serve(req, res, filename) {
      const response = await fetcher(`${base}/authenticated/${objectPath(filename)}`, {
        method: req.method,
        headers,
        signal: AbortSignal.timeout(20000),
      });
      if (response.status === 404 || response.status === 400)
        throw new HttpError(404, '图片不存在。');
      if (!response.ok) throw new HttpError(502, '图片暂时无法读取，请稍后重试。');
      res.writeHead(200, {
        'Content-Type': response.headers.get('content-type') || 'application/octet-stream',
        'Cache-Control': 'no-store',
        ...(response.headers.get('content-length')
          ? { 'Content-Length': response.headers.get('content-length') }
          : {}),
      });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      // Proxy private objects; do not give out URLs that bypass service suspension.
      await new Promise((resolve, reject) => {
        const stream = Readable.fromWeb(response.body);
        stream.on('error', reject);
        res.on('finish', resolve);
        res.on('close', () => {
          stream.destroy();
          resolve();
        });
        stream.pipe(res);
      });
    },
  };
}
