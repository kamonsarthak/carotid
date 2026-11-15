import http from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { planRequest, firedLabels } from '../rules/engine.js';
import { pathnameOf } from '../rules/match.js';
import { Throttle } from './throttle.js';
import { sendFavicon } from './favicon.js';
import { handleInternal, INTERNAL_PREFIX } from './internal.js';

// Connection-level headers that must not be forwarded to the next hop.
const REQUEST_HOP_HEADERS = ['connection', 'keep-alive', 'proxy-connection', 'proxy-authorization', 'te', 'trailer', 'upgrade', 'expect'];
const RESPONSE_HOP_HEADERS = new Set(['connection', 'keep-alive', 'proxy-connection']);

export const isInternal = (pathname) => pathname === INTERNAL_PREFIX || pathname.startsWith(INTERNAL_PREFIX + '/');

/** @returns {import('../store/ring.js').Entry} */
export function newEntry(kind, req, plan) {
  return {
    id: 0,
    kind,
    startedAt: Date.now(),
    method: req.method,
    url: req.url,
    path: pathnameOf(req.url),
    httpVersion: req.httpVersion,
    client: req.socket.remoteAddress,
    status: 0,
    duration: 0,
    reqHeaders: req.headers,
    reqBytes: 0,
    resBytes: 0,
    chaos: firedLabels(plan),
  };
}

/** Headers for the upstream request: everything the client sent, minus hop-by-hop, plus X-Forwarded-*. */
export function upstreamHeaders(req) {
  const headers = { ...req.headers };
  for (const name of REQUEST_HOP_HEADERS) delete headers[name];
  const client = req.socket.remoteAddress;
  if (client) headers['x-forwarded-for'] = headers['x-forwarded-for'] ? `${headers['x-forwarded-for']}, ${client}` : client;
  headers['x-forwarded-host'] ??= req.headers.host;
  headers['x-forwarded-proto'] ??= 'http';
  return headers;
}

/** Raw upstream response headers (original casing and duplicates kept) minus hop-by-hop ones. */
function responseHeaders(rawHeaders) {
  const out = [];
  for (let i = 0; i < rawHeaders.length; i += 2) {
    if (!RESPONSE_HOP_HEADERS.has(rawHeaders[i].toLowerCase())) out.push(rawHeaders[i], rawHeaders[i + 1]);
  }
  return out;
}

function sendUpstreamError(req, res, port, err) {
  const down = err.code === 'ECONNREFUSED';
  const title = down ? `Nothing is listening on localhost:${port}` : `localhost:${port} did not answer properly`;
  const hint = down ? 'Start your dev server and this page will load by itself.' : `${err.code ?? 'Error'}: ${err.message}`;
  const wantsHtml = (req.headers.accept ?? '').includes('text/html');
  const body = wantsHtml
    ? `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
      `<meta http-equiv="refresh" content="2"><title>carotid: waiting for localhost:${port}</title>` +
      `<body style="font: 16px/1.5 system-ui, sans-serif; max-width: 34em; margin: 18vh auto; padding: 0 1.2em; color: #333">` +
      `<h1 style="font-size: 1.3em">${title}</h1><p>${hint}</p>` +
      `<p style="color: #888">carotid is running and retries every 2 seconds.</p>`
    : `carotid: ${title}. ${hint}\n`;
  res.writeHead(502, {
    'content-type': wantsHtml ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-carotid': 'upstream-error',
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}

function sendInjectedFailure(req, res, status) {
  const body = `carotid: injected ${status} ${http.STATUS_CODES[status] ?? ''}`.trimEnd() + '\n';
  req.resume(); // discard any request body
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-carotid': 'injected-failure',
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}

/** Pipe the upstream response to the client, applying throttle / cut if planned. */
function relay(upReq, upRes, res, entry, plan) {
  res.writeHead(upRes.statusCode, upRes.statusMessage, responseHeaders(upRes.rawHeaders));
  res.flushHeaders(); // streaming responses (SSE) must see headers before the first chunk

  upRes.on('error', () => {
    entry.error ??= 'upstream closed mid-response';
    res.destroy();
  });

  if (plan.cut) {
    // Send half of the first chunk, then kill the connection.
    const kill = () => {
      res.destroy();
      upReq.destroy();
    };
    let sawBody = false;
    upRes.once('data', (chunk) => {
      sawBody = true;
      const part = chunk.subarray(0, Math.floor(chunk.length / 2));
      entry.resBytes += part.length;
      if (part.length) res.write(part, kill); // kill only once the partial chunk is flushed
      else kill();
    });
    upRes.once('end', () => {
      if (!sawBody) kill(); // empty body: nothing to cut, just hang up
    });
    return;
  }

  const body = plan.throttle > 0 ? upRes.pipe(new Throttle(plan.throttle)) : upRes;
  body.on('data', (chunk) => {
    entry.resBytes += chunk.length;
  });
  body.pipe(res);
}

async function handle(ctx, req, res) {
  const pathname = pathnameOf(req.url);
  if (isInternal(pathname)) return handleInternal(ctx, pathname, req, res);

  const t0 = performance.now();
  const elapsed = () => Math.round(performance.now() - t0);
  const plan = planRequest(ctx.ruleset, req.method, pathname, ctx.random);
  const entry = newEntry('http', req, plan);
  const isFavicon = pathname === '/favicon.ico' && (req.method === 'GET' || req.method === 'HEAD');
  // For responses carotid generates itself, throttle/cut never happened: keep only the delay label.
  const answeredLocally = (note) => {
    entry.note = note;
    entry.chaos = entry.chaos.filter((label) => label.startsWith('delay'));
  };

  let closed = false;
  res.on('close', () => {
    closed = true;
    entry.duration = elapsed();
    if (!res.writableFinished && !plan.drop && !plan.cut) entry.error ??= 'client closed the connection';
    ctx.record(entry);
  });

  if (plan.delayMs > 0) await sleep(plan.delayMs);
  if (closed) return;

  if (plan.drop) {
    req.socket.destroy();
    return;
  }
  if (plan.failStatus !== null) {
    entry.status = plan.failStatus;
    entry.statusText = http.STATUS_CODES[plan.failStatus];
    return sendInjectedFailure(req, res, plan.failStatus);
  }

  const host = await ctx.upstream.host();
  if (closed) return;

  const upReq = http.request({
    host,
    port: ctx.upstream.port,
    method: req.method,
    path: req.url,
    headers: upstreamHeaders(req),
    agent: ctx.agent,
  });
  res.on('close', () => upReq.destroy());

  upReq.on('response', (upRes) => {
    entry.ttfb = elapsed();
    if (isFavicon && upRes.statusCode === 404) {
      upRes.resume();
      answeredLocally('favicon fallback');
      entry.status = 200;
      return sendFavicon(req, res, ctx.upstream.port);
    }
    entry.status = upRes.statusCode;
    entry.statusText = upRes.statusMessage;
    entry.resHeaders = upRes.headers;
    try {
      relay(upReq, upRes, res, entry, plan);
    } catch (err) {
      upReq.destroy();
      upstreamFailed(err);
    }
  });

  const upstreamFailed = (err) => {
    if (closed) return;
    if (err.code === 'ECONNREFUSED') ctx.upstream.invalidate();
    if (res.headersSent) {
      entry.error ??= `upstream: ${err.message}`;
      return res.destroy();
    }
    if (isFavicon) {
      answeredLocally('favicon fallback');
      entry.status = 200;
      return sendFavicon(req, res, ctx.upstream.port);
    }
    answeredLocally(err.code === 'ECONNREFUSED' ? 'upstream down' : 'upstream error');
    entry.status = 502;
    entry.error = `upstream: ${err.message}`;
    req.resume();
    sendUpstreamError(req, res, ctx.upstream.port, err);
  };
  upReq.on('error', upstreamFailed);

  req.on('data', (chunk) => {
    entry.reqBytes += chunk.length;
  });
  req.pipe(upReq);
}

/** Request listener for http.createServer. */
export function createRequestHandler(ctx) {
  return (req, res) => {
    handle(ctx, req, res).catch((err) => {
      // A bug in carotid must never take the proxy down.
      if (res.headersSent) return res.destroy();
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8', 'x-carotid': 'internal-error' });
      res.end(`carotid: internal error: ${err.message}\n`);
    });
  };
}
