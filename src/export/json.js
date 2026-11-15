import { VERSION } from '../version.js';

/**
 * carotid's own JSON format: the raw entries, plus a little context.
 * @param {import('../store/ring.js').Entry[]} entries
 * @param {{ target?: string, profile?: string | null }} [meta]
 */
export function toJson(entries, meta = {}) {
  return {
    carotid: VERSION,
    exportedAt: new Date().toISOString(),
    target: meta.target ?? null,
    profile: meta.profile ?? null,
    count: entries.length,
    entries,
  };
}
