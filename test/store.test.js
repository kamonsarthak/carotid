import test from 'node:test';
import assert from 'node:assert/strict';
import { RequestStore } from '../src/store/ring.js';

const entry = (status, duration, chaos = []) => ({ status, duration, chaos });

test('ring buffer keeps only the newest entries, in order', () => {
  const store = new RequestStore(3);
  for (let i = 1; i <= 5; i++) store.add(entry(200, i));

  assert.deepEqual(store.all().map((e) => e.duration), [3, 4, 5]);
  assert.deepEqual(store.recent(2).map((e) => e.duration), [5, 4]);
  assert.deepEqual(store.all().map((e) => e.id), [3, 4, 5]);
  assert.equal(store.stats().requests.total, 5, 'totals count everything ever seen');
  assert.equal(store.stats().requests.buffered, 3);
});

test('stats: status breakdown, average and percentiles', () => {
  const store = new RequestStore();
  for (let i = 1; i <= 100; i++) store.add(entry(i <= 90 ? 200 : 500, i));
  store.add(entry(0, 1, ['delay 300ms', 'drop']));

  const stats = store.stats();
  assert.equal(stats.status['2xx'], 90);
  assert.equal(stats.status['5xx'], 10);
  assert.equal(stats.status.none, 1);
  assert.equal(stats.latency.avg, 50);
  assert.equal(stats.latency.p50, 50);
  assert.equal(stats.latency.p95, 95);
  assert.equal(stats.latency.max, 100);
  assert.deepEqual(stats.chaos, { delay: 1, drop: 1 });
});

test('stats on an empty store', () => {
  const stats = new RequestStore().stats();
  assert.equal(stats.requests.total, 0);
  assert.deepEqual(stats.latency, { avg: 0, p50: 0, p95: 0, max: 0, sample: 0 });
});
