import { Readable, Writable } from 'node:stream';

// Keep the existing API validation, cookies and transactional replies when
// running behind the Workers Fetch interface. Responses fit within the site's
// existing image/document limits and are collected before connections close.
export async function nodeHandlerResponse(request, handler) {
  const url = new URL(request.url);
  const req = request.body ? Readable.fromWeb(request.body) : Readable.from([]);
  req.url = url.pathname + url.search;
  req.method = request.method;
  req.headers = Object.fromEntries(request.headers);
  req.headers.host = url.host;
  req.socket = { encrypted: true, remoteAddress: req.headers['cf-connecting-ip'] ?? 'unknown' };
  const chunks = [],
    headers = new Headers();
  const res = new Writable({
    write(chunk, encoding, done) {
      chunks.push(Buffer.from(chunk));
      done();
    },
  });
  res.statusCode = 200;
  res.headersSent = false;
  res.setHeader = (key, value) => {
    headers.delete(key);
    for (const item of Array.isArray(value) ? value : [value]) headers.append(key, String(item));
  };
  res.getHeader = (key) => headers.get(key);
  res.writeHead = (status, extra = {}) => {
    res.statusCode = status;
    for (const [key, value] of Object.entries(extra)) res.setHeader(key, value);
    res.headersSent = true;
    return res;
  };
  const finished = new Promise((resolve, reject) => {
    res.once('finish', resolve);
    res.once('error', reject);
    res.once('close', () => {
      if (!res.writableFinished) reject(new Error('响应提前关闭。'));
    });
  });
  // Attach a rejection observer before awaiting a handler that may destroy res.
  finished.catch(() => {});
  try {
    await handler(req, res);
    await finished;
  } finally {
    req.destroy();
  }
  return new Response(
    request.method === 'HEAD' || [204, 304].includes(res.statusCode) ? null : Buffer.concat(chunks),
    { status: res.statusCode, headers },
  );
}
