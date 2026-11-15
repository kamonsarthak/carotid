import { VERSION } from '../version.js';

const headerList = (headers = {}) =>
  Object.entries(headers).flatMap(([name, value]) => [].concat(value).map((v) => ({ name, value: String(v) })));

function queryList(url) {
  const q = url.indexOf('?');
  if (q === -1) return [];
  return [...new URLSearchParams(url.slice(q + 1))].map(([name, value]) => ({ name, value }));
}

/**
 * Convert captured entries to HAR 1.2 (loadable in browser devtools and HAR viewers).
 * carotid does not capture bodies, so sizes are real but content is absent.
 *
 * @param {import('../store/ring.js').Entry[]} entries
 */
export function toHar(entries) {
  return {
    log: {
      version: '1.2',
      creator: { name: 'carotid', version: VERSION },
      entries: entries.map((entry) => {
        const httpVersion = `HTTP/${entry.httpVersion ?? '1.1'}`;
        const resHeaders = entry.resHeaders ?? {};
        const wait = entry.ttfb ?? entry.duration;
        return {
          startedDateTime: new Date(entry.startedAt).toISOString(),
          time: entry.duration,
          request: {
            method: entry.method,
            url: `${entry.kind === 'ws' ? 'ws' : 'http'}://${entry.reqHeaders?.host ?? 'localhost'}${entry.url}`,
            httpVersion,
            cookies: [],
            headers: headerList(entry.reqHeaders),
            queryString: queryList(entry.url),
            headersSize: -1,
            bodySize: entry.reqBytes ?? 0,
          },
          response: {
            status: entry.status,
            statusText: entry.statusText ?? '',
            httpVersion,
            cookies: [],
            headers: headerList(resHeaders),
            content: { size: entry.resBytes ?? 0, mimeType: String(resHeaders['content-type'] ?? '') },
            redirectURL: String(resHeaders.location ?? ''),
            headersSize: -1,
            bodySize: entry.resBytes ?? 0,
          },
          cache: {},
          timings: { send: 0, wait, receive: Math.max(0, entry.duration - wait) },
          serverIPAddress: '127.0.0.1',
          // Custom fields (HAR allows "_" prefixed extensions)
          _carotid: { chaos: entry.chaos, note: entry.note ?? null, error: entry.error ?? null, client: entry.client ?? null },
        };
      }),
    },
  };
}
