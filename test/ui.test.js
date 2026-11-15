import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { supportsColor, createColors } from '../src/ui/color.js';
import { formatEntry } from '../src/ui/logger.js';
import { renderBanner, firewallHint } from '../src/ui/banner.js';
import { lanAddresses } from '../src/net/lan.js';
import { listen } from '../src/net/port.js';

const plain = createColors(false);
const entry = (over = {}) => ({
  kind: 'http',
  startedAt: new Date(2026, 0, 2, 14, 2, 11).getTime(),
  method: 'GET',
  url: '/api/users',
  status: 200,
  duration: 312,
  chaos: [],
  ...over,
});

test('colour detection honours NO_COLOR, FORCE_COLOR, TTY and TERM', () => {
  const tty = { isTTY: true };
  assert.equal(supportsColor(tty, {}), true);
  assert.equal(supportsColor({ isTTY: false }, {}), false, 'piped output stays plain');
  assert.equal(supportsColor(tty, { NO_COLOR: '1' }), false);
  assert.equal(supportsColor(tty, { TERM: 'dumb' }), false);
  assert.equal(supportsColor({ isTTY: false }, { FORCE_COLOR: '1' }), true);
  assert.equal(supportsColor(tty, { FORCE_COLOR: '0' }), false);
});

test('colours fall back to plain text when disabled', () => {
  assert.equal(createColors(false).red('x'), 'x');
  assert.equal(createColors(true).red('x'), '\x1b[31mx\x1b[39m');
});

test('log line shows time, method, path, status, duration and chaos', () => {
  const line = formatEntry(entry({ chaos: ['delay 300ms', 'throttle 200KB/s'] }), plain);
  assert.match(line, /^14:02:11 GET {5}\/api\/users +200 +312ms {2}delay 300ms, throttle 200KB\/s$/);
  assert.ok(!line.includes('\x1b'), 'no escape codes without colour');
});

test('log line variants: drop, websocket, notes, long paths', () => {
  assert.match(formatEntry(entry({ status: 0, chaos: ['drop'] }), plain), / DROP /);
  assert.match(formatEntry(entry({ status: 0, error: 'client closed the connection' }), plain), / ---- .*client closed/);
  assert.match(formatEntry(entry({ kind: 'ws', status: 101 }), plain), /^14:02:11 WS /);
  assert.match(formatEntry(entry({ url: '/favicon.ico', note: 'favicon fallback' }), plain), /200 .*favicon fallback$/);

  const long = formatEntry(entry({ url: '/' + 'a'.repeat(300) }), plain, 100);
  assert.ok(long.length < 110, 'long paths are truncated');
  assert.match(long, /\.\.\. /);
  assert.match(formatEntry(entry({ duration: 12_345 }), plain), / 12\.3s/);
});

test('coloured log line colours the status by class', () => {
  const c = createColors(true);
  assert.ok(formatEntry(entry({ status: 503 }), c).includes(c.red('503 ')));
  assert.ok(formatEntry(entry({ status: 404 }), c).includes(c.yellow('404 ')));
  assert.ok(formatEntry(entry({ status: 200 }), c).includes(c.green('200 ')));
});

const bannerInfo = (over = {}) => ({
  port: 2345,
  targetPort: 3000,
  lan: [{ name: 'Wi-Fi', address: '192.168.1.20' }],
  rulesSummary: 'no profile, 0 rules',
  configName: null,
  targetUp: true,
  movedFrom: null,
  qr: true,
  platform: 'win32',
  ...over,
});

test('banner shows the LAN URL, a QR code and the Windows Firewall hint', () => {
  const banner = renderBanner(bannerInfo(), plain);
  assert.match(banner, /Network\s+http:\/\/192\.168\.1\.20:2345/);
  assert.match(banner, /Local\s+http:\/\/localhost:2345/);
  assert.match(banner, /[▄▀█]/, 'QR code is drawn');
  assert.match(banner, /Windows Firewall/);
  assert.ok(!banner.includes('\x1b'));
});

test('banner variants: no LAN, busy port, target down, no QR', () => {
  const noLan = renderBanner(bannerInfo({ lan: [] }), plain);
  assert.match(noLan, /no LAN address found/);
  assert.match(noLan, /Connect this machine to Wi-Fi or Ethernet/);
  assert.doesNotMatch(noLan, /[▄▀█]/);

  assert.match(renderBanner(bannerInfo({ port: 2346, movedFrom: 2345 }), plain), /Port 2345 was busy, using 2346/);
  assert.match(renderBanner(bannerInfo({ targetUp: false }), plain), /not running yet/);
  assert.doesNotMatch(renderBanner(bannerInfo({ qr: false }), plain), /[▄▀█]/);
  assert.match(firewallHint('linux', 2345).join(' '), /ufw allow 2345/);
  assert.match(firewallHint('darwin', 2345).join(' '), /macOS/);
});

test('LAN detection prefers real adapters over virtual ones', () => {
  const v4 = (address, internal = false) => ({ address, family: 'IPv4', internal });
  const found = lanAddresses({
    'Loopback Pseudo-Interface 1': [v4('127.0.0.1', true)],
    'vEthernet (WSL)': [v4('172.28.112.1')],
    'VirtualBox Host-Only Network': [v4('192.168.56.1')],
    'Wi-Fi': [{ address: 'fe80::1', family: 'IPv6', internal: false }, v4('192.168.1.20')],
    Ethernet: [v4('169.254.10.10')],
  });
  assert.equal(found[0].address, '192.168.1.20');
  assert.deepEqual(found.map((f) => f.address).sort(), ['172.28.112.1', '192.168.1.20', '192.168.56.1'], 'loopback, IPv6 and link-local are excluded');
  assert.deepEqual(lanAddresses({ lo: [v4('127.0.0.1', true)] }), []);
});

test('listen() moves to the next free port, skips the target, and can be strict', async (t) => {
  const blocker = http.createServer().listen(0, '127.0.0.1');
  await once(blocker, 'listening');
  const busy = blocker.address().port;
  t.after(() => blocker.close());

  const a = http.createServer();
  t.after(() => a.close());
  const got = await listen(a, { port: busy, host: '127.0.0.1', avoid: [busy + 1] });
  assert.ok(got > busy + 1, `picked ${got} after busy ${busy} and avoided ${busy + 1}`);

  const b = http.createServer();
  t.after(() => b.close());
  await assert.rejects(listen(b, { port: busy, host: '127.0.0.1', strict: true }), { code: 'EADDRINUSE' });
});
