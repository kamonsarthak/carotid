import os from 'node:os';

// Adapters that have an IPv4 address but that a phone on the wifi cannot reach.
const VIRTUAL = /vethernet|wsl|hyper-v|virtualbox|vbox|vmware|vmnet|docker|br-|veth|bridge|loopback|tailscale|zerotier|wireguard|utun|tun\d|tap\d|vpn|bluetooth/i;
const PHYSICAL = /wi-?fi|wlan|wireless|^en\d|^eth\d|^ethernet|^wl/i;

function score(name, address) {
  const [a, b, c] = address.split('.').map(Number);
  let points = 0;
  if (a === 192 && b === 168 && c === 56) points -= 40; // VirtualBox host-only default subnet
  if (a === 192 && b === 168) points += 30; // typical home / office wifi
  else if (a === 10) points += 20;
  else if (a === 172 && b >= 16 && b <= 31) points += 10; // private, but often Docker / WSL
  else if (a === 100 && b >= 64 && b <= 127) points -= 20; // CGNAT range: usually a VPN overlay
  if (VIRTUAL.test(name)) points -= 50;
  else if (PHYSICAL.test(name)) points += 5;
  return points;
}

/**
 * IPv4 addresses other devices on the network can use, best guess first.
 * @param {ReturnType<typeof os.networkInterfaces>} [interfaces] injectable for tests
 * @returns {{ name: string, address: string }[]}
 */
export function lanAddresses(interfaces = os.networkInterfaces()) {
  const found = [];
  for (const [name, addrs] of Object.entries(interfaces)) {
    for (const addr of addrs ?? []) {
      const isV4 = addr.family === 'IPv4' || addr.family === 4;
      if (!isV4 || addr.internal || addr.address.startsWith('169.254.')) continue; // skip loopback and link-local
      found.push({ name, address: addr.address, points: score(name, addr.address) });
    }
  }
  return found.sort((x, y) => y.points - x.points).map(({ name, address }) => ({ name, address }));
}
