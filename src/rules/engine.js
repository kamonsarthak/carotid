import { compilePath } from './match.js';

/**
 * @typedef {object} Effects
 * @property {number} [delay]            fixed latency in ms
 * @property {number} [jitter]           random +/- ms on top of delay
 * @property {number} [fail]             % of requests that get an injected status
 * @property {number | number[]} [status] injected status code(s)
 * @property {number} [throttle]         response bandwidth cap in KB/s
 * @property {number} [drop]             % of requests whose socket is closed
 * @property {number} [cut]              % of responses cut mid-body
 *
 * @typedef {Effects & { path?: string, method?: string[] }} Rule
 *
 * @typedef {object} Plan  What will happen to one request.
 * @property {number} delayMs
 * @property {boolean} drop
 * @property {number | null} failStatus
 * @property {boolean} cut
 * @property {number} throttle  KB/s, 0 = unlimited
 */

export const EFFECT_KEYS = ['delay', 'jitter', 'fail', 'status', 'throttle', 'drop', 'cut'];

const NO_EFFECTS = { delay: 0, jitter: 0, fail: 0, status: [503], throttle: 0, drop: 0, cut: 0 };

function pickEffects(source) {
  const fx = {};
  for (const key of EFFECT_KEYS) {
    if (source[key] !== undefined && source[key] !== null) fx[key] = source[key];
  }
  if (fx.status !== undefined) fx.status = [].concat(fx.status);
  return fx;
}

/**
 * Compile a profile plus a list of rules into something cheap to evaluate per request.
 * @param {{ profileName?: string | null, profile?: Effects | null, rules?: Rule[] }} [input]
 */
export function createRuleset({ profileName = null, profile = null, rules = [] } = {}) {
  return {
    profileName,
    ruleCount: rules.length,
    base: profile ? pickEffects(profile) : {},
    rules: rules.map((rule) => ({
      pathRe: rule.path ? compilePath(rule.path) : null,
      methods: rule.method?.length ? new Set(rule.method.map((m) => m.toUpperCase())) : null,
      effects: pickEffects(rule),
    })),
  };
}

/**
 * Effective settings for a request: the profile is the baseline, then every matching
 * rule overrides the fields it sets, in file order (later rules win).
 */
export function resolveEffects(ruleset, method, pathname) {
  const fx = { ...NO_EFFECTS, ...ruleset.base };
  for (const rule of ruleset.rules) {
    if (rule.methods && !rule.methods.has(method)) continue;
    if (rule.pathRe && !rule.pathRe.test(pathname)) continue;
    Object.assign(fx, rule.effects);
  }
  return fx;
}

/**
 * Roll the dice for one request.
 * @param {() => number} [random] injectable for tests
 * @returns {Plan}
 */
export function planRequest(ruleset, method, pathname, random = Math.random) {
  const fx = resolveEffects(ruleset, method, pathname);
  const roll = (percent) => percent > 0 && random() * 100 < percent;

  const jitter = fx.jitter > 0 ? (random() * 2 - 1) * fx.jitter : 0;
  const delayMs = Math.max(0, Math.round(fx.delay + jitter));

  const drop = roll(fx.drop);
  const failStatus = !drop && roll(fx.fail) ? fx.status[Math.floor(random() * fx.status.length)] : null;
  const forwarded = !drop && failStatus === null;

  return {
    delayMs,
    drop,
    failStatus,
    cut: forwarded && roll(fx.cut),
    throttle: forwarded ? fx.throttle : 0,
  };
}

/** Short labels for the log line, e.g. ["delay 312ms", "throttle 200KB/s"]. */
export function firedLabels(plan) {
  const labels = [];
  if (plan.delayMs > 0) labels.push(`delay ${plan.delayMs}ms`);
  if (plan.drop) labels.push('drop');
  if (plan.failStatus !== null) labels.push(`fail ${plan.failStatus}`);
  if (plan.throttle > 0) labels.push(`throttle ${plan.throttle}KB/s`);
  if (plan.cut) labels.push('cut');
  return labels;
}
