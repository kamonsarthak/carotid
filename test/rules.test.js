import test from 'node:test';
import assert from 'node:assert/strict';
import { compilePath, pathnameOf } from '../src/rules/match.js';
import { createRuleset, resolveEffects, planRequest, firedLabels } from '../src/rules/engine.js';
import { validateConfig } from '../src/rules/validate.js';
import { profiles, profileNames } from '../src/profiles/index.js';

const always = () => 0; // every percentage roll fires
const never = () => 0.999999; // no percentage roll fires

test('path patterns', () => {
  assert.ok(compilePath('/api/users').test('/api/users'));
  assert.ok(!compilePath('/api/users').test('/api/users/1'));

  assert.ok(compilePath('/api/*').test('/api/users'));
  assert.ok(!compilePath('/api/*').test('/api/users/1'));

  assert.ok(compilePath('/api/**').test('/api'));
  assert.ok(compilePath('/api/**').test('/api/users/1'));
  assert.ok(!compilePath('/api/**').test('/apiary'));

  assert.ok(compilePath('**/*.png').test('/logo.png'));
  assert.ok(compilePath('**/*.png').test('/img/a/logo.png'));
  assert.ok(!compilePath('**/*.png').test('/logo.pngx'));

  assert.ok(compilePath('api/v1.0').test('/api/v1.0'), 'leading slash is optional');
  assert.ok(!compilePath('/api/v1.0').test('/api/v1x0'), 'dots are literal');
});

test('pathnameOf strips the query string', () => {
  assert.equal(pathnameOf('/a/b?x=1&y=2'), '/a/b');
  assert.equal(pathnameOf('/a/b'), '/a/b');
});

test('no profile and no rules means no chaos', () => {
  const plan = planRequest(createRuleset(), 'GET', '/', always);
  assert.deepEqual(plan, { delayMs: 0, drop: false, failStatus: null, cut: false, throttle: 0 });
  assert.deepEqual(firedLabels(plan), []);
});

test('rules match on path and method', () => {
  const ruleset = createRuleset({
    rules: [
      { path: '/api/**', method: ['POST'], delay: 500 },
      { path: '/slow', delay: 900 },
    ],
  });
  assert.equal(resolveEffects(ruleset, 'POST', '/api/x').delay, 500);
  assert.equal(resolveEffects(ruleset, 'GET', '/api/x').delay, 0);
  assert.equal(resolveEffects(ruleset, 'GET', '/slow').delay, 900);
  assert.equal(resolveEffects(ruleset, 'GET', '/other').delay, 0);
});

test('rules override the profile, later rules win, untouched fields are kept', () => {
  const ruleset = createRuleset({
    profile: profiles['3g'],
    rules: [
      { path: '/api/**', delay: 1000 },
      { path: '/api/health', delay: 0, jitter: 0, fail: 0, throttle: 5 },
    ],
  });
  const base = resolveEffects(ruleset, 'GET', '/');
  assert.equal(base.delay, 300);
  assert.equal(base.throttle, 200);

  const api = resolveEffects(ruleset, 'GET', '/api/users');
  assert.equal(api.delay, 1000);
  assert.equal(api.jitter, 100, 'jitter still comes from the profile');

  const health = resolveEffects(ruleset, 'GET', '/api/health');
  assert.equal(health.delay, 0);
  assert.equal(health.fail, 0);
  assert.equal(health.throttle, 5);
});

test('jitter stays within +/- range and never goes negative', () => {
  const ruleset = createRuleset({ rules: [{ delay: 100, jitter: 50 }] });
  for (let i = 0; i < 200; i++) {
    const { delayMs } = planRequest(ruleset, 'GET', '/');
    assert.ok(delayMs >= 50 && delayMs <= 150, `delay ${delayMs} out of range`);
  }
  const wild = createRuleset({ rules: [{ delay: 10, jitter: 500 }] });
  assert.equal(planRequest(wild, 'GET', '/', always).delayMs, 0);
});

test('fail injects one of the configured statuses', () => {
  const ruleset = createRuleset({ rules: [{ fail: 100, status: [500, 503], throttle: 10, cut: 100 }] });
  const plan = planRequest(ruleset, 'GET', '/', always);
  assert.equal(plan.failStatus, 500);
  assert.equal(plan.cut, false, 'a failed request is never forwarded, so it cannot be cut');
  assert.equal(plan.throttle, 0);
  assert.deepEqual(firedLabels(plan), ['fail 500']);

  assert.equal(planRequest(ruleset, 'GET', '/', never).failStatus, 503);
  assert.equal(planRequest(createRuleset({ rules: [{ fail: 50 }] }), 'GET', '/', never).failStatus, null);
});

test('drop wins over everything else', () => {
  const ruleset = createRuleset({ rules: [{ drop: 100, fail: 100, cut: 100, delay: 20 }] });
  const plan = planRequest(ruleset, 'GET', '/', always);
  assert.equal(plan.drop, true);
  assert.equal(plan.failStatus, null);
  assert.deepEqual(firedLabels(plan), ['delay 20ms', 'drop']);
});

test('fail rate is roughly honoured', () => {
  const ruleset = createRuleset({ rules: [{ fail: 30 }] });
  let failed = 0;
  for (let i = 0; i < 5000; i++) if (planRequest(ruleset, 'GET', '/').failStatus) failed++;
  assert.ok(failed > 1200 && failed < 1800, `expected ~1500 failures, got ${failed}`);
});

test('every built-in profile is valid as a rule', () => {
  for (const name of profileNames) {
    const { description, ...effects } = profiles[name];
    assert.ok(description, `${name} needs a description`);
    const { errors } = validateConfig({ rules: [effects] }, profileNames);
    assert.deepEqual(errors, [], name);
  }
  for (const name of ['3g', 'slow-3g', 'flaky-wifi', 'airplane-mode', 'offline']) {
    assert.ok(profiles[name], `missing profile ${name}`);
  }
});

test('validateConfig normalises a good config', () => {
  const { config, errors } = validateConfig(
    { profile: '3g', rules: [{ path: '/api/**', method: 'post', fail: '25%', status: 500 }] },
    profileNames,
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(config, {
    profile: '3g',
    rules: [{ path: '/api/**', method: ['POST'], fail: 25, status: [500] }],
  });
});

test('validateConfig accepts an empty file', () => {
  assert.deepEqual(validateConfig(null, profileNames), { config: { profile: null, rules: [] }, errors: [] });
});

test('validateConfig reports every problem with its location', () => {
  const { config, errors } = validateConfig(
    {
      profile: '4g',
      rulez: [],
      rules: [
        { path: '/a', delay: 'fast' },
        { path: '/b', methods: ['GET'], fail: 150 },
        { path: '/c' },
        { method: 'FETCH', status: 42, throttle: 0 },
        'nope',
      ],
    },
    profileNames,
  );
  assert.equal(config, null);
  const text = errors.join('\n');
  assert.match(text, /unknown profile "4g"; available: 3g/);
  assert.match(text, /unknown key "rulez" \(did you mean "rules"\?\)/);
  assert.match(text, /rules\[0\]\.delay must be a number of milliseconds.*got "fast"/);
  assert.match(text, /rules\[1\]: unknown key "methods" \(did you mean "method"\?\)/);
  assert.match(text, /rules\[1\]\.fail must be a percentage/);
  assert.match(text, /rules\[2\] does nothing/);
  assert.match(text, /rules\[3\]\.method must be one or more of/);
  assert.match(text, /rules\[3\]\.status must be an HTTP status code/);
  assert.match(text, /rules\[3\]\.throttle must be a positive number/);
  assert.match(text, /rules\[4\] must be a mapping/);
});

test('validateConfig rejects non-mapping files and non-list rules', () => {
  assert.equal(validateConfig('hello', profileNames).config, null);
  assert.match(validateConfig({ rules: { path: '/' } }, profileNames).errors[0], /rules must be a list/);
});
