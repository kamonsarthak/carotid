import http from 'node:http';
import { createRuleset } from '../rules/engine.js';
import { RequestStore } from '../store/ring.js';
import { createUpstream } from './upstream.js';
import { createRequestHandler } from './forward.js';
import { createUpgradeHandler } from './websocket.js';

/**
 * Build the proxy server (not yet listening).
 *
 * This is the seam for future features: anything that needs to see or alter traffic
 * (dashboard, breakpoints, mocking) hangs off `ctx`; anything that changes how carotid
 * is reached (HTTPS, tunnels, mDNS) wraps the returned `server`.
 *
 * @param {object} options
 * @param {number} options.targetPort                         the localhost port to proxy to
 * @param {ReturnType<typeof createRuleset>} [options.ruleset]
 * @param {RequestStore} [options.store]
 * @param {(entry: import('../store/ring.js').Entry) => void} [options.onEntry]  called once per finished request
 * @param {() => number} [options.random]                     RNG for the chaos rolls (tests)
 */
export function createProxy({ targetPort, ruleset = createRuleset(), store = new RequestStore(), onEntry, random = Math.random }) {
  const ctx = {
    upstream: createUpstream(targetPort),
    agent: new http.Agent({ keepAlive: false }),
    ruleset,
    store,
    random,
    startedAt: Date.now(),
    record(entry) {
      store.add(entry);
      onEntry?.(entry);
    },
  };

  const server = http.createServer(createRequestHandler(ctx));
  server.on('upgrade', createUpgradeHandler(ctx));
  server.on('clientError', (_err, socket) => socket.destroy());

  return {
    server,
    store,
    upstream: ctx.upstream,
    /** Swap the active rules (config hot reload). Applies to the next request. */
    setRuleset(next) {
      ctx.ruleset = next;
    },
  };
}
