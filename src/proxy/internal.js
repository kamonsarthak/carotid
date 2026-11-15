import { VERSION } from '../version.js';

export const INTERNAL_PREFIX = '/__carotid';

function sendJson(res, status, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

/** Slim view of an entry for the stats endpoint (no headers). */
function summarise(entry) {
  const { id, kind, startedAt, method, url, status, duration, chaos, note, error } = entry;
  return { id, kind, time: new Date(startedAt).toISOString(), method, url, status, duration, chaos, note, error };
}

/**
 * Endpoints carotid serves itself, never forwarded and never subject to chaos:
 *   /__carotid/stats      summary JSON
 *   /__carotid/requests   the full ring buffer (what `carotid export` reads)
 */
export function handleInternal(ctx, pathname, req, res) {
  const meta = {
    carotid: VERSION,
    target: `http://localhost:${ctx.upstream.port}`,
    profile: ctx.ruleset.profileName,
    rules: ctx.ruleset.ruleCount,
    uptime: Math.round((Date.now() - ctx.startedAt) / 1000),
  };

  if (pathname === `${INTERNAL_PREFIX}/stats`) {
    return sendJson(res, 200, { ...meta, ...ctx.store.stats(), recent: ctx.store.recent(20).map(summarise) });
  }
  if (pathname === `${INTERNAL_PREFIX}/requests`) {
    return sendJson(res, 200, { ...meta, entries: ctx.store.all() });
  }
  return sendJson(res, 404, {
    error: 'unknown carotid endpoint',
    endpoints: [`${INTERNAL_PREFIX}/stats`, `${INTERNAL_PREFIX}/requests`],
  });
}
