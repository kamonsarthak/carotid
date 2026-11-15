import net from 'node:net';
import { STATUS_CODES } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { planRequest, firedLabels } from '../rules/engine.js';
import { pathnameOf } from '../rules/match.js';
import { newEntry, isInternal } from './forward.js';

const refuse = (socket, status) =>
  socket.end(`HTTP/1.1 ${status} ${STATUS_CODES[status]}\r\nConnection: close\r\nContent-Length: 0\r\nX-Carotid: ${status === 502 ? 'upstream-error' : 'injected-failure'}\r\n\r\n`);

/**
 * Upgrade handler (WebSockets, i.e. hot reload). The handshake is replayed to the
 * upstream byte-for-byte and the two sockets are then joined, so carotid never has to
 * understand the WebSocket protocol. Chaos applies to the handshake only: delay, drop
 * and fail. Frames on an open socket are not throttled or cut.
 */
export function createUpgradeHandler(ctx) {
  return async (req, socket, head) => {
    const pathname = pathnameOf(req.url);
    socket.on('error', () => {}); // resets are normal when tabs close
    if (isInternal(pathname)) return socket.destroy();

    const t0 = performance.now();
    const plan = { ...planRequest(ctx.ruleset, req.method, pathname, ctx.random), cut: false, throttle: 0 };
    const entry = newEntry('ws', req, plan);
    entry.chaos = firedLabels(plan);

    let recorded = false;
    const record = (status, extra) => {
      if (recorded) return;
      recorded = true;
      Object.assign(entry, { status, statusText: STATUS_CODES[status], duration: Math.round(performance.now() - t0) }, extra);
      ctx.record(entry);
    };

    if (plan.delayMs > 0) await sleep(plan.delayMs);
    if (socket.destroyed) return record(0, { error: 'client closed the connection' });

    if (plan.drop) {
      socket.destroy();
      return record(0);
    }
    if (plan.failStatus !== null) {
      refuse(socket, plan.failStatus);
      return record(plan.failStatus);
    }

    const upstream = net.connect({ host: await ctx.upstream.host(), port: ctx.upstream.port });
    upstream.setNoDelay(true);
    socket.setNoDelay(true);

    upstream.on('connect', () => {
      let handshake = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
      for (let i = 0; i < req.rawHeaders.length; i += 2) handshake += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
      upstream.write(handshake + '\r\n');
      if (head?.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });

    // The first bytes back are the upstream's handshake response: note its status for the log.
    upstream.once('data', (chunk) => {
      const status = Number(/^HTTP\/1\.[01] (\d{3})/.exec(chunk.toString('latin1', 0, 16))?.[1] ?? 0);
      record(status);
    });

    upstream.on('error', (err) => {
      if (err.code === 'ECONNREFUSED') ctx.upstream.invalidate();
      if (!recorded && !socket.destroyed) refuse(socket, 502);
      record(502, { error: `upstream: ${err.message}`, note: err.code === 'ECONNREFUSED' ? 'upstream down' : 'upstream error' });
    });
    upstream.on('close', () => {
      record(0, { error: 'upstream closed before answering' }); // no-op if already recorded
      socket.destroy();
    });
    socket.on('close', () => upstream.destroy());
  };
}
