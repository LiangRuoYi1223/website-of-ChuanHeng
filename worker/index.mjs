import { Readable } from 'node:stream';
import { createCloudApp } from '../server/cloud.mjs';
import { nodeHandlerResponse } from '../server/fetch-adapter.mjs';
import { HttpError } from '../server/validation.mjs';

// A deliberately unusable password hash avoids doing an extra scrypt on every
// request; unknown-user logins still perform the normal password verification.
const dummyPasswordHash =
  '00000000000000000000000000000000:0000000000000000000000000000000000000000000000000000000000000000';
const secureHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

export default {
  async fetch(request, env) {
    let app;
    try {
      const url = new URL(request.url);
      const pathname = decodeURIComponent(url.pathname);
      if (pathname.includes('\\') || pathname.includes('\0'))
        throw new HttpError(400, '请求路径格式不正确。');
      if (!/^\/(api|uploads|images|docs)(\/|$)/i.test(pathname)) {
        const response = await env.ASSETS.fetch(request);
        const headers = new Headers(response.headers);
        for (const [key, value] of Object.entries(secureHeaders)) headers.set(key, value);
        return new Response(response.body, { status: response.status, headers });
      }
      if (!env.HYPERDRIVE?.connectionString) throw new Error('尚未绑定 Hyperdrive 数据库连接。');
      // Sockets cannot be shared across Worker requests. Each request owns and
      // closes both pools; the Supabase transaction pooler handles remote reuse.
      app = createCloudApp(
        { ...env, HOSTING_PLATFORM: 'cloudflare' },
        {
          dummyPasswordHash,
          async servePublic(req, res, path) {
            const target = new URL(path, request.url);
            const response = await env.ASSETS.fetch(new Request(target, { method: req.method }));
            if (!response.ok || response.headers.get('content-type')?.includes('text/html'))
              throw new HttpError(404, '文件不存在。');
            const headers = Object.fromEntries(response.headers);
            headers['cache-control'] = 'no-store';
            res.writeHead(response.status, headers);
            if (req.method === 'HEAD' || !response.body) {
              res.end();
              return;
            }
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
        },
      );
      return await nodeHandlerResponse(request, (req, res) => app.handler(req, res));
    } catch (error) {
      const status =
        error instanceof HttpError ? error.status : error instanceof URIError ? 400 : 503;
      return Response.json(
        {
          error:
            status === 503
              ? '网站服务暂时不可用，请稍后再试。'
              : error instanceof URIError
                ? '请求路径格式不正确。'
                : error.message,
        },
        { status, headers: { ...secureHeaders, 'Cache-Control': 'no-store' } },
      );
    } finally {
      if (app) await app.close().catch(() => {});
    }
  },
};
