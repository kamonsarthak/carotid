import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { createProxy } from '../src/proxy/server.js';
import { createRuleset } from '../src/rules/engine.js';
import { portHue, faviconSvg } from '../src/proxy/favicon.js';

const always = () => 0; // every percentage roll fires

/** Start a throwaway upstream app on a random port. */
async function startUpstream(t, handler, host = '127.0.0.1') {
  const server = http.createServer(handler);
  server.listen(0, host);
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return server;
}

/** Start carotid in front of `targetPort`; returns its base URL plus the proxy handle. */
async function startProxy(t, targetPort, options = {}) {
  const entries = [];
  const proxy = createProxy({ targetPort, onEntry: (e) => entries.push(e), ...options });
  proxy.server.listen(0, '127.0.0.1');
  await once(proxy.server, 'listening');
  t.after(() => {
    proxy.server.closeAllConnections();
    proxy.server.close();
  });
  const port = proxy.server.address().port;
  return { proxy, entries, port, url: `http://127.0.0.1:${port}` };
}

/** A port with nothing listening on it. */
async function deadPort() {
  const server = net.createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  server.close();
  await once(server, 'close');
  return port;
}

const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

/** Entries are recorded when the response closes, which can trail the client seeing the last byte. */
async function recorded(entries, count = 1) {
  for (let i = 0; i < 200 && entries.length < count; i++) await tick(10);
  assert.ok(entries.length >= count, `expected ${count} recorded entries, got ${entries.length}`);
}

test('passes requests through: method, path, query, headers, body', async (t) => {
  const upstream = await startUpstream(t, (req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.writeHead(201, { 'content-type': 'application/json', 'X-Custom-Case': 'kept', 'set-cookie': ['a=1', 'b=2'] });
      res.end(JSON.stringify({ method: req.method, url: req.url, headers: req.headers, body }));
    });
  });
  const { url, port, entries } = await startProxy(t, upstream.address().port);

  const res = await fetch(`${url}/api/echo?x=1&y=two`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain', 'x-test': 'hello' },
    body: 'ping',
  });
  const seen = await res.json();

  assert.equal(res.status, 201);
  assert.equal(res.headers.get('x-custom-case'), 'kept');
  assert.deepEqual(res.headers.getSetCookie(), ['a=1', 'b=2'], 'duplicate headers survive');
  assert.equal(seen.method, 'POST');
  assert.equal(seen.url, '/api/echo?x=1&y=two');
  assert.equal(seen.body, 'ping');
  assert.equal(seen.headers['x-test'], 'hello');
  assert.equal(seen.headers.host, `127.0.0.1:${port}`, 'Host header is preserved');
  assert.equal(seen.headers['x-forwarded-host'], `127.0.0.1:${port}`);
  assert.equal(seen.headers['x-forwarded-proto'], 'http');
  assert.ok(seen.headers['x-forwarded-for']);

  await recorded(entries);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].status, 201);
  assert.equal(entries[0].path, '/api/echo');
  assert.equal(entries[0].reqBytes, 4);
  assert.ok(entries[0].resBytes > 0);
  assert.deepEqual(entries[0].chaos, []);
});

test('passes redirects and error statuses through untouched', async (t) => {
  const upstream = await startUpstream(t, (req, res) => {
    if (req.url === '/old') return res.writeHead(302, { location: '/new' }).end();
    res.writeHead(418).end('teapot');
  });
  const { url } = await startProxy(t, upstream.address().port);

  const redirect = await fetch(`${url}/old`, { redirect: 'manual' });
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get('location'), '/new');

  const teapot = await fetch(`${url}/x`);
  assert.equal(teapot.status, 418);
  assert.equal(await teapot.text(), 'teapot');
});

test('streams responses chunk by chunk (SSE) without buffering', async (t) => {
  let release;
  const upstream = await startUpstream(t, (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: first\n\n');
    release = () => res.end('data: second\n\n');
  });
  const { url } = await startProxy(t, upstream.address().port);

  const res = await fetch(`${url}/events`);
  const reader = res.body.getReader();
  const first = await reader.read();
  assert.equal(Buffer.from(first.value).toString(), 'data: first\n\n', 'first chunk arrives while the stream is still open');

  release();
  let rest = '';
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) rest += Buffer.from(chunk.value);
  assert.equal(rest, 'data: second\n\n');
});

test('tunnels WebSocket upgrades in both directions', async (t) => {
  const upstream = await startUpstream(t, (_req, res) => res.end('http'));
  let seenHeaders;
  upstream.on('upgrade', (req, socket) => {
    seenHeaders = req.headers;
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
    socket.on('data', (data) => socket.write(`echo:${data}`));
    socket.on('end', () => socket.end()); // http sockets are half-open by default
    socket.on('error', () => {});
  });
  const { port, entries } = await startProxy(t, upstream.address().port);

  const client = net.connect(port, '127.0.0.1');
  t.after(() => client.destroy());
  client.write('GET /hmr?token=abc HTTP/1.1\r\nHost: example.test\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: dGVzdA==\r\n\r\n');

  let received = '';
  client.on('data', (data) => (received += data));
  const until = async (text) => {
    for (let i = 0; i < 100 && !received.includes(text); i++) await tick(10);
    assert.ok(received.includes(text), `expected "${text}" in ${JSON.stringify(received)}`);
  };

  await until('101 Switching Protocols');
  client.write('hello');
  await until('echo:hello');
  client.write('again');
  await until('echo:again');

  assert.equal(seenHeaders['sec-websocket-key'], 'dGVzdA==');
  assert.equal(seenHeaders.host, 'example.test');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, 'ws');
  assert.equal(entries[0].status, 101);
  assert.equal(entries[0].url, '/hmr?token=abc');
});

test('reaches an upstream that only listens on IPv6 loopback', async (t) => {
  let upstream;
  try {
    upstream = await startUpstream(t, (_req, res) => res.end('six'), '::1');
  } catch {
    return t.skip('IPv6 loopback is not available here');
  }
  const { url } = await startProxy(t, upstream.address().port);
  assert.equal(await (await fetch(`${url}/`)).text(), 'six');
});

test('answers 502 with a helpful page when the upstream is down, then recovers', async (t) => {
  const targetPort = await deadPort();
  const { url, entries } = await startProxy(t, targetPort);

  const plain = await fetch(`${url}/api`);
  assert.equal(plain.status, 502);
  assert.match(await plain.text(), new RegExp(`Nothing is listening on localhost:${targetPort}`));

  const html = await fetch(`${url}/`, { headers: { accept: 'text/html' } });
  assert.equal(html.status, 502);
  assert.match(html.headers.get('content-type'), /text\/html/);
  assert.match(await html.text(), /http-equiv="refresh"/);

  await recorded(entries, 2);
  assert.equal(entries[0].status, 502);
  assert.equal(entries[0].note, 'upstream down');

  // The dev server comes up later: the very next request must work.
  const late = http.createServer((_req, res) => res.end('up now')).listen(targetPort, '127.0.0.1');
  await once(late, 'listening');
  t.after(() => late.close());
  assert.equal(await (await fetch(`${url}/`)).text(), 'up now');
});

test('favicon: falls back to a generated icon on 404, never overrides a real one', async (t) => {
  const missing = await startUpstream(t, (_req, res) => res.writeHead(404).end('nope'));
  const a = await startProxy(t, missing.address().port);
  const fallback = await fetch(`${a.url}/favicon.ico`);
  assert.equal(fallback.status, 200);
  assert.equal(fallback.headers.get('content-type'), 'image/svg+xml');
  assert.equal(await fallback.text(), faviconSvg(missing.address().port));
  assert.equal((await fetch(`${a.url}/other.ico`)).status, 404, 'only /favicon.ico gets the fallback');
  await recorded(a.entries, 2);
  assert.equal(a.entries[0].status, 200, 'the log shows 200, not a favicon 404');
  assert.equal(a.entries[0].note, 'favicon fallback');

  const own = await startUpstream(t, (_req, res) => res.writeHead(200, { 'content-type': 'image/x-icon' }).end('REAL-ICON'));
  const b = await startProxy(t, own.address().port);
  const real = await fetch(`${b.url}/favicon.ico`);
  assert.equal(real.headers.get('content-type'), 'image/x-icon');
  assert.equal(await real.text(), 'REAL-ICON');
});

test('favicon colour depends on the port', () => {
  assert.notEqual(portHue(3000), portHue(3001));
  assert.notEqual(portHue(3000), portHue(5173));
  assert.match(faviconSvg(3000), new RegExp(`hsl\\(${portHue(3000)}, `));
  assert.match(faviconSvg(5173), />73</);
});

test('chaos: delay holds the request back', async (t) => {
  const upstream = await startUpstream(t, (_req, res) => res.end('ok'));
  const { url, entries } = await startProxy(t, upstream.address().port, {
    ruleset: createRuleset({ rules: [{ path: '/slow/**', delay: 150 }] }),
  });

  let t0 = Date.now();
  await (await fetch(`${url}/slow/thing`)).text();
  assert.ok(Date.now() - t0 >= 140, 'matching path is delayed');

  t0 = Date.now();
  await (await fetch(`${url}/fast`)).text();
  assert.ok(Date.now() - t0 < 140, 'other paths are not');

  await recorded(entries, 2);
  assert.deepEqual(entries[0].chaos, ['delay 150ms']);
  assert.ok(entries[0].duration >= 140);
  assert.deepEqual(entries[1].chaos, []);
});

test('chaos: fail injects a status without touching the upstream', async (t) => {
  let hits = 0;
  const upstream = await startUpstream(t, (_req, res) => {
    hits++;
    res.end('ok');
  });
  const { url, entries } = await startProxy(t, upstream.address().port, {
    random: always,
    ruleset: createRuleset({ rules: [{ method: ['POST'], fail: 100, status: 503 }] }),
  });

  const failed = await fetch(`${url}/save`, { method: 'POST', body: 'data' });
  assert.equal(failed.status, 503);
  assert.equal(failed.headers.get('x-carotid'), 'injected-failure');
  assert.equal(hits, 0);

  assert.equal((await fetch(`${url}/save`)).status, 200, 'GET does not match the rule');
  await recorded(entries, 2);
  assert.deepEqual(entries[0].chaos, ['fail 503']);
});

test('chaos: drop closes the connection with no response', async (t) => {
  const upstream = await startUpstream(t, (_req, res) => res.end('ok'));
  const { url, entries } = await startProxy(t, upstream.address().port, {
    random: always,
    ruleset: createRuleset({ rules: [{ drop: 100 }] }),
  });

  await assert.rejects(fetch(`${url}/`));
  await recorded(entries);
  assert.equal(entries[0].status, 0);
  assert.deepEqual(entries[0].chaos, ['drop']);
  assert.equal(entries[0].error, undefined);
});

test('chaos: cut ends the response partway through the body', async (t) => {
  const payload = 'x'.repeat(10_000);
  const upstream = await startUpstream(t, (_req, res) => res.end(payload));
  const { port, entries } = await startProxy(t, upstream.address().port, {
    random: always,
    ruleset: createRuleset({ rules: [{ cut: 100 }] }),
  });

  // Raw socket so we can see exactly what arrived before the connection died.
  const client = net.connect(port, '127.0.0.1');
  client.write('GET /big HTTP/1.1\r\nHost: x\r\n\r\n');
  let received = '';
  client.on('data', (data) => (received += data));
  client.on('error', () => {});
  await once(client, 'close');

  assert.match(received, /^HTTP\/1\.1 200 OK/);
  assert.match(received, /content-length: 10000/i);
  const body = received.slice(received.indexOf('\r\n\r\n') + 4);
  assert.ok(body.length > 0 && body.length < payload.length, `got ${body.length} of ${payload.length} bytes`);
  await recorded(entries);
  assert.deepEqual(entries[0].chaos, ['cut']);
});

test('chaos: throttle trickles the body at roughly the configured rate', async (t) => {
  const payload = Buffer.alloc(20 * 1024, 'a'); // 20 KB
  const upstream = await startUpstream(t, (_req, res) => res.end(payload));
  const { url, entries } = await startProxy(t, upstream.address().port, {
    ruleset: createRuleset({ rules: [{ throttle: 40 }] }), // 40 KB/s => ~500 ms
  });

  const t0 = Date.now();
  const body = Buffer.from(await (await fetch(`${url}/file`)).arrayBuffer());
  const took = Date.now() - t0;

  assert.ok(body.equals(payload), 'body arrives intact');
  assert.ok(took >= 400 && took < 1500, `expected ~500 ms, took ${took} ms`);
  await recorded(entries);
  assert.deepEqual(entries[0].chaos, ['throttle 40KB/s']);
});

test('chaos applies to WebSocket handshakes (drop)', async (t) => {
  const upstream = await startUpstream(t, (_req, res) => res.end('ok'));
  upstream.on('upgrade', (_req, socket) => socket.end('HTTP/1.1 101 Switching Protocols\r\n\r\n'));
  const { port, entries } = await startProxy(t, upstream.address().port, {
    random: always,
    ruleset: createRuleset({ rules: [{ drop: 100 }] }),
  });

  const client = net.connect(port, '127.0.0.1');
  client.write('GET /ws HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
  let received = '';
  client.on('data', (data) => (received += data));
  client.on('error', () => {});
  await once(client, 'close');
  assert.equal(received, '');
  assert.deepEqual(entries[0].chaos, ['drop']);
});

test('setRuleset swaps rules live', async (t) => {
  const upstream = await startUpstream(t, (_req, res) => res.end('ok'));
  const { url, proxy } = await startProxy(t, upstream.address().port, { random: always });

  assert.equal((await fetch(`${url}/`)).status, 200);
  proxy.setRuleset(createRuleset({ rules: [{ fail: 100, status: 500 }] }));
  assert.equal((await fetch(`${url}/`)).status, 500);
  proxy.setRuleset(createRuleset());
  assert.equal((await fetch(`${url}/`)).status, 200);
});

test('/__carotid/stats reports counts, statuses, latency and recent requests', async (t) => {
  const upstream = await startUpstream(t, (req, res) => res.writeHead(req.url === '/missing' ? 404 : 200).end('ok'));
  const { url, entries } = await startProxy(t, upstream.address().port, {
    ruleset: createRuleset({ profileName: 'test', rules: [{ path: '/slow', delay: 60 }] }),
  });

  await (await fetch(`${url}/a`)).text();
  await (await fetch(`${url}/slow`)).text();
  await (await fetch(`${url}/missing`)).text();
  await recorded(entries, 3);

  const res = await fetch(`${url}/__carotid/stats`);
  assert.match(res.headers.get('content-type'), /application\/json/);
  const stats = await res.json();

  assert.equal(stats.target, `http://localhost:${upstream.address().port}`);
  assert.equal(stats.profile, 'test');
  assert.equal(stats.requests.total, 3);
  assert.equal(stats.status['2xx'], 2);
  assert.equal(stats.status['4xx'], 1);
  assert.deepEqual(stats.status.codes, { 200: 2, 404: 1 });
  assert.ok(stats.latency.p95 >= 50, `p95 ${stats.latency.p95}`);
  assert.ok(stats.latency.avg > 0);
  assert.equal(stats.chaos.delay, 1);
  assert.equal(stats.recent.length, 3);
  assert.equal(stats.recent[0].url, '/missing', 'newest first');
  assert.equal(entries.length, 3, 'internal endpoints are not recorded');

  const dump = await (await fetch(`${url}/__carotid/requests`)).json();
  assert.equal(dump.entries.length, 3);
  assert.equal(dump.entries[0].url, '/a', 'oldest first');
  assert.ok(dump.entries[0].reqHeaders.host);

  assert.equal((await fetch(`${url}/__carotid/nope`)).status, 404);
});
