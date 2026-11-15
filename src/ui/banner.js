import { VERSION } from '../version.js';
import { renderQr } from './qr.js';

const indent = (text, by = '  ') =>
  text
    .split('\n')
    .map((line) => by + line)
    .join('\n');

/** Why a phone might not connect, per platform. */
export function firewallHint(platform, port) {
  const common = 'Phone must be on the same Wi-Fi (guest networks often block device-to-device traffic).';
  if (platform === 'win32') {
    return [
      common,
      'Windows: click "Allow" if a Windows Security prompt appears for Node.js. No prompt?',
      'Open "Allow an app through Windows Firewall", tick Node.js for Private networks,',
      'and check that this Wi-Fi is set to "Private network" in Settings.',
    ];
  }
  if (platform === 'darwin') {
    return [common, 'macOS: click "Allow" if asked whether node may accept incoming connections.'];
  }
  return [common, `Linux: open the port if you run a firewall, e.g. "sudo ufw allow ${port}/tcp".`];
}

/**
 * The startup screen.
 *
 * @param {object} info
 * @param {number} info.port                         port carotid listens on
 * @param {number} info.targetPort
 * @param {{ name: string, address: string }[]} info.lan
 * @param {string} info.rulesSummary                 e.g. "profile 3g (300ms ±100), 2 rules"
 * @param {string | null} info.configName
 * @param {boolean} info.targetUp
 * @param {number | null} info.movedFrom             the port we wanted, when it was busy
 * @param {boolean} info.qr
 * @param {NodeJS.Platform} info.platform
 * @param {ReturnType<import('./color.js').createColors>} c
 */
export function renderBanner(info, c) {
  const { port, targetPort, lan } = info;
  const row = (label, value) => `  ${c.dim(label.padEnd(9))} ${value}`;
  const lanUrl = lan.length ? `http://${lan[0].address}:${port}` : null;
  const out = [''];

  out.push(`  ${c.bold(c.red('carotid'))} ${c.dim('v' + VERSION)}`, '');
  out.push(row('Local', c.cyan(`http://localhost:${port}`)));
  out.push(row('Network', lanUrl ? c.bold(c.cyan(lanUrl)) + c.dim('   <- open this on your phone') : c.yellow('no LAN address found')));
  for (const extra of lan.slice(1, 3)) {
    out.push(row('', c.dim(`http://${extra.address}:${port}  (${extra.name})`)));
  }
  out.push(row('Target', `http://localhost:${targetPort}` + (info.targetUp ? '' : c.yellow('  (not running yet, carotid will wait for it)'))));
  out.push(row('Chaos', info.rulesSummary));
  out.push(row('Config', info.configName ?? c.dim('none (create carotid.yaml here to add rules, it loads live)')));
  out.push(row('Stats', c.dim(`http://localhost:${port}/__carotid/stats`)));

  if (info.movedFrom !== null) {
    out.push('', `  ${c.yellow(`Port ${info.movedFrom} was busy, using ${port} instead.`)}`);
  }

  out.push('');
  if (lanUrl) {
    if (info.qr) out.push(indent(renderQr(lanUrl)), '');
    for (const line of firewallHint(info.platform, port)) out.push(`  ${c.dim(line)}`);
  } else {
    out.push(`  ${c.yellow('Could not find a LAN IPv4 address, so there is no URL for your phone.')}`);
    out.push(`  ${c.dim('Connect this machine to Wi-Fi or Ethernet and restart carotid.')}`);
    out.push(`  ${c.dim(`Everything else works on this machine at http://localhost:${port}.`)}`);
  }

  out.push('', `  ${c.dim('Requests appear below. Press Ctrl+C to stop.')}`, '');
  return out.join('\n');
}
