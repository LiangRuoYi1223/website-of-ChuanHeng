import { handleTrackRequest, isLoopbackAddress, isLoopbackHost, jsonResponse, trackErrorResponse } from './http.mjs';
import { TrackError } from './parse.mjs';

export function isLocalPreviewRequest(request, explicitlyEnabled) {
  if (explicitlyEnabled !== true || !isLoopbackAddress(request.socket?.localAddress) || !isLoopbackAddress(request.socket?.remoteAddress)) return false;
  try {
    const host = request.headers.host;
    if (typeof host !== 'string') return false;
    const url = new URL(`http://${host}`);
    return !url.username && !url.password && url.pathname === '/' && isLoopbackHost(url.hostname);
  } catch { return false; }
}

function requestUrl(request) {
  if (typeof request.headers.host !== 'string' || !request.url?.startsWith('/') || request.url.startsWith('//')) throw new TrackError('INVALID_REQUEST', '请求地址无效。', 400);
  const protocol = request.socket?.encrypted ? 'https:' : 'http:';
  const authority = new URL(`${protocol}//${request.headers.host}`);
  if (authority.username || authority.password || authority.pathname !== '/' || authority.search || authority.hash) throw new TrackError('INVALID_REQUEST', '请求地址无效。', 400);
  return new URL(request.url, authority).href;
}

async function sendResponse(response, outgoing) {
  outgoing.statusCode = response.status;
  response.headers.forEach((value, key) => outgoing.setHeader(key, value));
  // Responses are bounded JSON produced locally, not a proxy for arbitrary data.
  outgoing.end(new Uint8Array(await response.arrayBuffer()));
}

function incomingBody(incoming) {
  // Cancelling Readable.toWeb(IncomingMessage) also destroys its HTTP socket,
  // which prevents a useful JSON 413 response. Pause and detach instead; the
  // response's Connection: close handles the transport after its bytes flush.
  let cleanup = () => {};
  return new ReadableStream({
    start(controller) {
      const data = chunk => { controller.enqueue(new Uint8Array(chunk)); incoming.pause(); };
      const end = () => { cleanup(); controller.close(); };
      const error = () => { cleanup(); controller.error(new TrackError('INVALID_UPLOAD', '上传连接已中断，请重试。', 400)); };
      cleanup = () => { incoming.off('data', data); incoming.off('end', end); incoming.off('error', error); incoming.off('aborted', error); };
      incoming.on('data', data); incoming.once('end', end); incoming.once('error', error); incoming.once('aborted', error);
      incoming.pause();
    },
    pull() { incoming.resume(); },
    cancel() { incoming.pause(); cleanup(); },
  }, { highWaterMark: 64 * 1024, size: chunk => chunk.byteLength });
}

export function tracksVitePlugin(options = {}) {
  const install = server => {
    server.middlewares.use(async (incoming, outgoing, next) => {
      const pathname = String(incoming.url || '').split('?')[0];
      if (pathname !== '/api' && !pathname.startsWith('/api/')) return next();
      const abort = new AbortController();
      const onAbort = () => abort.abort();
      incoming.once('aborted', onAbort);
      try {
        const headers = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
        }
        const method = incoming.method || 'GET';
        const init = { method, headers, signal: abort.signal };
        if (method !== 'GET' && method !== 'HEAD') {
          init.body = incomingBody(incoming);
          init.duplex = 'half';
        }
        const request = new Request(requestUrl(incoming), init);
        const result = await handleTrackRequest(request, options.env || process.env, {
          localPreview: isLocalPreviewRequest(incoming, options.localPreview),
          fetchImpl: options.fetchImpl || fetch,
          authTimeoutMs: options.authTimeoutMs,
        });
        if (!outgoing.destroyed) {
          if (!incoming.complete) outgoing.setHeader('connection', 'close');
          await sendResponse(result || jsonResponse({ error: { code: 'NOT_FOUND', message: '没有找到这个接口。' } }, 404), outgoing);
        }
      } catch (error) {
        if (!outgoing.destroyed && !outgoing.headersSent) await sendResponse(trackErrorResponse(error), outgoing);
        else if (!outgoing.destroyed) outgoing.end();
      } finally {
        incoming.removeListener('aborted', onAbort);
        // Do not continue reading an unauthorized or oversized upload. Closing
        // the request body cannot turn its response into a successful conversion.
        if (!incoming.complete && !incoming.destroyed) incoming.pause();
      }
    });
  };
  return { name: 'chuanheng-track-conversion', configureServer: install, configurePreviewServer: install };
}

export default tracksVitePlugin;
