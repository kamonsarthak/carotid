/**
 * Built-in network profiles. Edit freely: this is the only place they live.
 *
 * Every field is optional and means the same thing as in a carotid.yaml rule:
 *   delay     fixed latency added to every request, in ms
 *   jitter    random +/- ms added on top of delay
 *   throttle  response bandwidth cap, in KB/s
 *   fail      % of requests answered with an injected error status
 *   status    status code (or list of codes) used for injected failures
 *   drop      % of requests whose connection is closed with no response
 *   cut       % of responses cut off halfway through the body
 *
 * @type {Record<string, import('../rules/engine.js').Effects & { description: string }>}
 */
export const profiles = {
  '3g': {
    description: 'Average phone on 3G: noticeable latency, ~1.6 Mbit/s down',
    delay: 300,
    jitter: 100,
    throttle: 200,
    fail: 1,
    status: 503,
  },
  'slow-3g': {
    description: 'Bad signal: 2 s round trips, ~400 kbit/s down',
    delay: 2000,
    jitter: 500,
    throttle: 50,
    fail: 2,
    status: 503,
  },
  'flaky-wifi': {
    description: 'Coffee-shop wifi: fast when it works, randomly fails, drops and stalls',
    delay: 150,
    jitter: 150,
    throttle: 1000,
    fail: 5,
    status: [502, 503, 504],
    drop: 5,
    cut: 3,
  },
  'airplane-mode': {
    description: 'Signal just vanished: every request hangs for a few seconds, then the connection dies',
    delay: 4000,
    jitter: 2000,
    drop: 100,
  },
  offline: {
    description: 'Hard offline: every connection is closed immediately',
    drop: 100,
  },
};

export const profileNames = Object.keys(profiles);

/** One-line human summary of a profile or rule's effects, e.g. "300ms ±100, 200 KB/s, 1% fail". */
export function describeEffects(fx) {
  const parts = [];
  if (fx.delay || fx.jitter) parts.push(`${fx.delay ?? 0}ms${fx.jitter ? ` ±${fx.jitter}` : ''}`);
  if (fx.throttle) parts.push(`${fx.throttle} KB/s`);
  if (fx.fail) parts.push(`${fx.fail}% fail`);
  if (fx.drop) parts.push(`${fx.drop}% drop`);
  if (fx.cut) parts.push(`${fx.cut}% cut`);
  return parts.join(', ') || 'no effects';
}
