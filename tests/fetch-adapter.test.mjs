import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { nodeHandlerResponse } from '../server/fetch-adapter.mjs';
import { clientIp } from '../server/cloud.mjs';

test('Workers adapter preserves JSON request streams, origin, secure cookies and replies', async () => {
  const response = await nodeHandlerResponse(
    new Request('https://club.test/api/auth/login?mode=1', {
      method: 'POST',
      headers: {
        Origin: 'https://club.test',
        'Content-Type': 'application/json',
        'CF-Connecting-IP': '203.0.113.8',
      },
      body: JSON.stringify({ username: 'admin' }),
    }),
    async (req, res) => {
      assert.equal(req.url, '/api/auth/login?mode=1');
      assert.equal(req.headers.host, 'club.test');
      assert.equal(req.headers.origin, 'https://club.test');
      assert.equal(clientIp(req, 'cloudflare'), '203.0.113.8');
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      assert.deepEqual(JSON.parse(Buffer.concat(chunks)), { username: 'admin' });
      res.setHeader('X-Frame-Options', 'DENY');
      res.writeHead(201, {
        'Content-Type': 'application/json',
        'Set-Cookie': 'session=abc; Secure; HttpOnly',
      });
      res.end('{"ok":true}');
    },
  );
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(response.headers.get('set-cookie'), 'session=abc; Secure; HttpOnly');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
});

test('Workers adapter waits for streamed files and suppresses HEAD bodies', async () => {
  const response = await nodeHandlerResponse(
    new Request('https://club.test/docs/handbook.pdf'),
    async (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/pdf' });
      Readable.from([Buffer.from('part1'), Buffer.from('part2')]).pipe(res);
    },
  );
  assert.equal(await response.text(), 'part1part2');
  const head = await nodeHandlerResponse(
    new Request('https://club.test/docs/handbook.pdf', { method: 'HEAD' }),
    async (req, res) => {
      res.writeHead(200, { 'Content-Length': '10' });
      res.end();
    },
  );
  assert.equal(await head.text(), '');
  assert.equal(head.headers.get('content-length'), '10');
});

test('Cloudflare ignores client-controlled forwarding headers for throttling', () => {
  const req = {
    headers: {
      'cf-connecting-ip': '203.0.113.9',
      'x-forwarded-for': '192.0.2.1',
      'x-vercel-forwarded-for': '192.0.2.2',
    },
    socket: { remoteAddress: 'fallback' },
  };
  assert.equal(clientIp(req, 'cloudflare'), '203.0.113.9');
  req.headers['cf-connecting-ip'] = 'invalid';
  assert.equal(clientIp(req, 'cloudflare'), 'fallback');
});
