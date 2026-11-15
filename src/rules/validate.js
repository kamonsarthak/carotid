import { EFFECT_KEYS } from './engine.js';

const TOP_KEYS = ['profile', 'rules'];
const RULE_KEYS = ['path', 'method', ...EFFECT_KEYS];
const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
const ALIASES = {
  methods: 'method',
  paths: 'path',
  url: 'path',
  latency: 'delay',
  failRate: 'fail',
  'fail-rate': 'fail',
  fail_rate: 'fail',
  statusCode: 'status',
  code: 'status',
  bandwidth: 'throttle',
  profiles: 'profile',
  rule: 'rules',
};

function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

function suggest(key, known) {
  const hit = ALIASES[key] ?? known.find((k) => editDistance(key.toLowerCase(), k) <= 2);
  return hit && known.includes(hit) ? ` (did you mean "${hit}"?)` : '';
}

const show = (value) => JSON.stringify(value);

/** Accepts 20 or "20%". */
function toPercent(value) {
  if (typeof value === 'string' && /^\d+(\.\d+)?%$/.test(value.trim())) return Number(value.trim().slice(0, -1));
  return value;
}

function validateRule(raw, where, errors) {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    errors.push(`${where} must be a mapping like "- path: /api/**", got ${show(raw)}`);
    return null;
  }
  const rule = {};
  const err = (key, msg) => errors.push(`${where}.${key} ${msg}, got ${show(raw[key])}`);

  for (const key of Object.keys(raw)) {
    if (!RULE_KEYS.includes(key)) errors.push(`${where}: unknown key "${key}"${suggest(key, RULE_KEYS)}`);
  }

  if (raw.path !== undefined) {
    if (typeof raw.path === 'string' && raw.path.trim()) rule.path = raw.path.trim();
    else err('path', 'must be a path pattern such as "/api/**"');
  }

  if (raw.method !== undefined) {
    const list = [].concat(raw.method).map((m) => (typeof m === 'string' ? m.toUpperCase() : m));
    if (list.length && list.every((m) => METHODS.includes(m))) rule.method = list;
    else err('method', `must be one or more of ${METHODS.join(', ')}`);
  }

  for (const key of ['delay', 'jitter']) {
    if (raw[key] === undefined) continue;
    if (typeof raw[key] === 'number' && raw[key] >= 0) rule[key] = raw[key];
    else err(key, 'must be a number of milliseconds (0 or more)');
  }

  for (const key of ['fail', 'drop', 'cut']) {
    if (raw[key] === undefined) continue;
    const value = toPercent(raw[key]);
    if (typeof value === 'number' && value >= 0 && value <= 100) rule[key] = value;
    else err(key, 'must be a percentage between 0 and 100');
  }

  if (raw.status !== undefined) {
    const list = [].concat(raw.status);
    if (list.length && list.every((s) => Number.isInteger(s) && s >= 200 && s <= 599)) rule.status = list;
    else err('status', 'must be an HTTP status code (200-599) or a list of them');
  }

  if (raw.throttle !== undefined) {
    if (typeof raw.throttle === 'number' && raw.throttle > 0) rule.throttle = raw.throttle;
    else err('throttle', 'must be a positive number of KB/s');
  }

  if (!EFFECT_KEYS.some((key) => raw[key] !== undefined)) {
    errors.push(`${where} does nothing: add at least one of ${EFFECT_KEYS.join(', ')}`);
  }
  return rule;
}

/**
 * Validate and normalise a parsed carotid.yaml.
 * @param {unknown} raw
 * @param {string[]} profileNames
 * @returns {{ config: { profile: string | null, rules: import('./engine.js').Rule[] } | null, errors: string[] }}
 */
export function validateConfig(raw, profileNames) {
  const errors = [];
  const config = { profile: null, rules: [] };

  if (raw === null || raw === undefined) return { config, errors }; // empty file is fine
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { config: null, errors: ['the file must be a mapping with "profile" and/or "rules" at the top level'] };
  }

  for (const key of Object.keys(raw)) {
    if (!TOP_KEYS.includes(key)) errors.push(`unknown key "${key}"${suggest(key, TOP_KEYS)}`);
  }

  if (raw.profile !== undefined && raw.profile !== null) {
    if (profileNames.includes(raw.profile)) config.profile = raw.profile;
    else errors.push(`unknown profile ${show(raw.profile)}; available: ${profileNames.join(', ')}`);
  }

  if (raw.rules !== undefined && raw.rules !== null) {
    if (!Array.isArray(raw.rules)) {
      errors.push(`rules must be a list (each item starting with "- "), got ${show(raw.rules)}`);
    } else {
      raw.rules.forEach((item, i) => {
        const rule = validateRule(item, `rules[${i}]`, errors);
        if (rule) config.rules.push(rule);
      });
    }
  }

  return { config: errors.length ? null : config, errors };
}
