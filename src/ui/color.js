/** Should we emit ANSI colours? Honours NO_COLOR and FORCE_COLOR, and stays plain when piped. */
export function supportsColor(stream = process.stdout, env = process.env) {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return false;
  if (env.FORCE_COLOR !== undefined) return env.FORCE_COLOR !== '0' && env.FORCE_COLOR !== 'false';
  if (!stream?.isTTY) return false;
  return env.TERM !== 'dumb';
}

/** Tiny colour helper. With `enabled` false every function returns its input unchanged. */
export function createColors(enabled = supportsColor()) {
  const style = (open, close) => (text) => (enabled ? `\x1b[${open}m${text}\x1b[${close}m` : String(text));
  return {
    enabled,
    bold: style(1, 22),
    dim: style(2, 22),
    red: style(31, 39),
    green: style(32, 39),
    yellow: style(33, 39),
    blue: style(34, 39),
    magenta: style(35, 39),
    cyan: style(36, 39),
  };
}
