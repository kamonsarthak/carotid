import test from 'node:test';
import assert from 'node:assert/strict';
import { toHar } from '../src/export/har.js';
import { toJson } from '../src/export/json.js';

const entries = [
  {
    id: 1,
    kind: 'http',
    startedAt: Date.UTC(2026, 0, 2, 14, 2, 11),
    method: 'GET',
    url: '/api/users?page=2&q=a%20b',
    path: '/api/users',
    httpVersion: '1.1',
    client: '192.168.1.30',
    status: 200,
    statusText: 'OK',
    duration: 340,
    ttfb: 310,
    reqHeaders: { host: '192.168.1.20:2345', accept: '*/*' },
    resHeaders: { 'content-type': 'application/json', 'set-cookie': ['a=1', 'b=2'] },
    reqBytes: 0,
    resBytes: 512,
    chaos: ['delay 300ms'],
  },
  {
    id: 2,
    kind: 'http',
    startedAt: Date.UTC(2026, 0, 2, 14, 2, 12),
    method: 'POST',
    url: '/api/save',
    path: '/api/save',
    httpVersion: '1.1',
    status: 0,
    duration: 5,
    reqHeaders: { host: 'localhost:2345' },
    reqBytes: 20,
    resBytes: 0,
    chaos: ['drop'],
  },
];

test('HAR export is valid HAR 1.2 with carotid extras', () => {
  const har = toHar(entries);
  assert.equal(har.log.version, '1.2');
  assert.equal(har.log.creator.name, 'carotid');
  assert.equal(har.log.entries.length, 2);

  const [first, dropped] = har.log.entries;
  assert.equal(first.startedDateTime, '2026-01-02T14:02:11.000Z');
  assert.equal(first.time, 340);
  assert.equal(first.request.method, 'GET');
  assert.equal(first.request.url, 'http://192.168.1.20:2345/api/users?page=2&q=a%20b');
  assert.deepEqual(first.request.queryString, [
    { name: 'page', value: '2' },
    { name: 'q', value: 'a b' },
  ]);
  assert.deepEqual(first.request.headers[0], { name: 'host', value: '192.168.1.20:2345' });
  assert.equal(first.response.status, 200);
  assert.equal(first.response.content.mimeType, 'application/json');
  assert.equal(first.response.content.size, 512);
  assert.equal(first.response.headers.filter((h) => h.name === 'set-cookie').length, 2, 'multi-value headers are split');
  assert.deepEqual(first.timings, { send: 0, wait: 310, receive: 30 });
  assert.deepEqual(first._carotid.chaos, ['delay 300ms']);

  assert.equal(dropped.response.status, 0);
  assert.deepEqual(dropped.response.headers, []);
  assert.deepEqual(dropped._carotid.chaos, ['drop']);

  assert.doesNotThrow(() => JSON.stringify(har));
});

test('JSON export wraps the raw entries with context', () => {
  const out = toJson(entries, { target: 'http://localhost:3000', profile: '3g' });
  assert.equal(out.count, 2);
  assert.equal(out.target, 'http://localhost:3000');
  assert.equal(out.profile, '3g');
  assert.equal(out.entries, entries);
  assert.ok(!Number.isNaN(Date.parse(out.exportedAt)));
});

test('exports handle an empty capture', () => {
  assert.deepEqual(toHar([]).log.entries, []);
  assert.equal(toJson([]).count, 0);
});
