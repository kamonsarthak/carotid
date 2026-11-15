/**
 * @typedef {object} Entry  One proxied request.
 * @property {number} id
 * @property {'http' | 'ws'} kind
 * @property {number} startedAt        epoch ms
 * @property {string} method
 * @property {string} url              path + query string
 * @property {string} path
 * @property {string} httpVersion
 * @property {string} [client]         remote address
 * @property {number} status           0 = no response (dropped / aborted)
 * @property {string} [statusText]
 * @property {number} duration         ms until the response finished
 * @property {number} [ttfb]           ms until upstream response headers arrived
 * @property {Record<string, string | string[]>} reqHeaders
 * @property {Record<string, string | string[]>} [resHeaders]
 * @property {number} reqBytes
 * @property {number} resBytes
 * @property {string[]} chaos          which chaos effects fired
 * @property {string} [note]           e.g. "favicon fallback"
 * @property {string} [error]
 */

/** Fixed-size in-memory buffer of recent requests, plus running totals. */
export class RequestStore {
  constructor(capacity = 1000) {
    this.capacity = capacity;
    /** @type {Entry[]} */
    this.buffer = [];
    this.next = 0; // index of the oldest entry once the buffer is full
    this.total = 0;
    this.codes = {};
    this.chaos = {};
  }

  /** @param {Entry} entry */
  add(entry) {
    this.total++;
    entry.id = this.total;
    this.codes[entry.status] = (this.codes[entry.status] ?? 0) + 1;
    for (const label of entry.chaos) {
      const kind = label.split(' ')[0];
      this.chaos[kind] = (this.chaos[kind] ?? 0) + 1;
    }
    if (this.buffer.length < this.capacity) {
      this.buffer.push(entry);
    } else {
      this.buffer[this.next] = entry;
      this.next = (this.next + 1) % this.capacity;
    }
  }

  /** Buffered entries, oldest first. */
  all() {
    return [...this.buffer.slice(this.next), ...this.buffer.slice(0, this.next)];
  }

  /** The newest `n` entries, newest first. */
  recent(n = 20) {
    return this.all().slice(-n).reverse();
  }

  stats() {
    const classes = { '1xx': 0, '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0, none: 0 };
    for (const [code, count] of Object.entries(this.codes)) {
      const key = code === '0' ? 'none' : `${code[0]}xx`;
      classes[key] = (classes[key] ?? 0) + count;
    }

    const durations = this.buffer.map((e) => e.duration).sort((a, b) => a - b);
    const percentile = (p) => (durations.length ? durations[Math.min(durations.length - 1, Math.ceil(p * durations.length) - 1)] : 0);
    const avg = durations.length ? Math.round(durations.reduce((sum, d) => sum + d, 0) / durations.length) : 0;

    return {
      requests: { total: this.total, buffered: this.buffer.length, capacity: this.capacity },
      status: { ...classes, codes: { ...this.codes } },
      latency: { avg, p50: percentile(0.5), p95: percentile(0.95), max: durations.at(-1) ?? 0, sample: durations.length },
      chaos: { ...this.chaos },
    };
  }
}
