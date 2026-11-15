const pad2 = (n) => String(n).padStart(2, '0');

function clock(ms) {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function truncate(text, max) {
  return text.length <= max ? text : text.slice(0, max - 3) + '...';
}

function formatDuration(ms) {
  return ms < 10_000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function statusCell(entry, c) {
  const { status } = entry;
  if (status === 0) return entry.chaos.includes('drop') ? c.red('DROP') : c.dim('----');
  const text = String(status).padEnd(4);
  if (status >= 500) return c.red(text);
  if (status >= 400) return c.yellow(text);
  if (status >= 300) return c.cyan(text);
  return c.green(text);
}

/**
 * One log line per request:
 *   14:02:11 GET     /api/users                    200    312ms  delay 300ms, throttle 200KB/s
 *
 * @param {import('../store/ring.js').Entry} entry
 * @param {ReturnType<import('./color.js').createColors>} c
 * @param {number} [columns] terminal width, used to size the path column
 */
export function formatEntry(entry, c, columns = 100) {
  const pathWidth = Math.max(20, Math.min(48, columns - 62));
  const duration = formatDuration(entry.duration).padStart(7);
  const slow = entry.duration >= 1000 ? c.red(duration) : entry.duration >= 300 ? c.yellow(duration) : c.dim(duration);

  const extras = [];
  if (entry.chaos.length) extras.push(c.magenta(entry.chaos.join(', ')));
  if (entry.note) extras.push(c.dim(entry.note));
  else if (entry.error) extras.push(c.dim(entry.error));

  return [
    c.dim(clock(entry.startedAt)),
    c.bold((entry.kind === 'ws' ? 'WS' : entry.method).padEnd(7)),
    truncate(entry.url, pathWidth).padEnd(pathWidth),
    statusCell(entry, c),
    slow,
    extras.length ? ' ' + extras.join(c.dim(' | ')) : '',
  ]
    .join(' ')
    .trimEnd();
}
