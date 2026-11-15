import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readConfig } from '../src/config/load.js';
import { watchConfig } from '../src/config/watch.js';

function tempDir(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'carotid-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('no config file is fine', async (t) => {
  const result = await readConfig(tempDir(t));
  assert.deepEqual(result, { name: null, text: null, config: { profile: null, rules: [] }, errors: [] });
});

test('reads and normalises carotid.yaml', async (t) => {
  const dir = tempDir(t);
  writeFileSync(path.join(dir, 'carotid.yaml'), 'profile: slow-3g\nrules:\n  - path: /api/**\n    method: [get, post]\n    delay: 250\n');
  const { name, config, errors } = await readConfig(dir);
  assert.equal(name, 'carotid.yaml');
  assert.deepEqual(errors, []);
  assert.deepEqual(config, { profile: 'slow-3g', rules: [{ path: '/api/**', method: ['GET', 'POST'], delay: 250 }] });
});

test('also finds carotid.yml, and an empty file means no rules', async (t) => {
  const dir = tempDir(t);
  writeFileSync(path.join(dir, 'carotid.yml'), '# nothing yet\n');
  const { name, config, errors } = await readConfig(dir);
  assert.equal(name, 'carotid.yml');
  assert.deepEqual(errors, []);
  assert.deepEqual(config, { profile: null, rules: [] });
});

test('YAML syntax errors are reported with a position, not thrown', async (t) => {
  const dir = tempDir(t);
  writeFileSync(path.join(dir, 'carotid.yaml'), 'rules:\n  - path: [unclosed\n');
  const { config, errors } = await readConfig(dir);
  assert.equal(config, null);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^invalid YAML: .*line \d+/s);
});

test('validation errors are reported, not thrown', async (t) => {
  const dir = tempDir(t);
  writeFileSync(path.join(dir, 'carotid.yaml'), 'profile: warp-speed\n');
  const { config, errors } = await readConfig(dir);
  assert.equal(config, null);
  assert.match(errors[0], /unknown profile "warp-speed"/);
});

test('watchConfig fires when the config file is created and changed', async (t) => {
  const dir = tempDir(t);
  let calls = 0;
  const stop = watchConfig(dir, () => calls++, 20);
  t.after(stop);
  const settle = async (expected) => {
    for (let i = 0; i < 150 && calls < expected; i++) await new Promise((r) => setTimeout(r, 20));
    assert.ok(calls >= expected, `expected ${expected} change notifications, got ${calls}`);
  };

  await new Promise((r) => setTimeout(r, 100)); // let the watcher attach
  writeFileSync(path.join(dir, 'unrelated.txt'), 'x');
  writeFileSync(path.join(dir, 'carotid.yaml'), 'profile: 3g\n');
  await settle(1);

  await new Promise((r) => setTimeout(r, 100));
  const before = calls;
  writeFileSync(path.join(dir, 'carotid.yaml'), 'profile: offline\n');
  await settle(before + 1);
});
