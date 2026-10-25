import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCloudApp } from './cloud.mjs';

export function hostingEnvironment(env = process.env) {
  return {
    ...env,
    SITE_ORIGIN: env.SITE_ORIGIN || (env.RENDER === 'true' ? env.RENDER_EXTERNAL_URL : undefined),
  };
}

export function cloudServer(app) {
  const server = http.createServer((req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    Promise.resolve()
      .then(() => app.handler(req, res))
      .catch(() => {
        console.error('云端接口不可用，请检查数据库和存储连接。');
        if (res.headersSent) return res.destroy();
        res.writeHead(503, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        res.end(JSON.stringify({ error: '网站服务暂时不可用，请稍后再试。' }));
      });
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const port = Number(process.env.PORT || 10000);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('无效端口');
    const app = createCloudApp(hostingEnvironment());
    const server = cloudServer(app);
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      const timer = setTimeout(() => process.exit(1), 25000);
      timer.unref();
      server.close(() => {
        void app.close().then(() => process.exit(process.exitCode || 0));
      });
      server.closeIdleConnections();
    };
    server.on('error', () => {
      console.error('网站服务无法监听端口。');
      process.exitCode = 1;
      stop();
    });
    server.listen(port, '0.0.0.0', () => console.log('川衡云端网站服务已启动。'));
    for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, stop);
  } catch {
    console.error('云端服务启动失败，请检查后端环境变量。');
    process.exitCode = 1;
  }
}
