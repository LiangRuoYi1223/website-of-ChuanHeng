import { createCloudApp } from '../server/cloud.mjs';

let app;
export const config = { api: { bodyParser: false } };
export default async function handler(req, res) {
  try {
    // An explicit rewrite parameter keeps the original path independent of
    // Vercel's function URL handling. Only website API/media paths are accepted.
    const url = new URL(req.url, 'http://localhost');
    const originalPath = url.searchParams.get('__route');
    if (originalPath) {
      if (
        !/^\/(api|uploads|images|docs)(\/|$)/.test(originalPath) ||
        originalPath.includes('\\') ||
        originalPath.includes('?') ||
        originalPath.includes('#')
      ) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: '请求路径格式不正确。' }));
        return;
      }
      url.searchParams.delete('__route');
      req.url = originalPath + (url.searchParams.size ? `?${url.searchParams}` : '');
    }
    app ??= createCloudApp();
    await app.handler(req, res);
  } catch {
    console.error('云端接口不可用，请检查环境变量、数据库初始化和连接状态。');
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.writeHead(503, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify({ error: '网站服务暂时不可用，请稍后再试。' }));
  }
}
