import net from 'node:net';

const CANDIDATES = ['127.0.0.1', '::1'];

/**
 * Works out where "localhost:<port>" really is. Dev servers that listen on "localhost"
 * (Vite, for one) may be bound to IPv6 ::1 only, so we probe both loopback addresses,
 * remember the one that answered, and re-probe after a connection failure.
 */
export function createUpstream(port) {
  let host = null;
  let probing = null;

  const canConnect = (candidate) =>
    new Promise((resolve) => {
      const socket = net.connect({ host: candidate, port });
      const done = (ok) => {
        socket.destroy();
        resolve(ok);
      };
      socket.setTimeout(1000, () => done(false));
      socket.once('connect', () => done(true));
      socket.once('error', () => done(false));
    });

  async function probe() {
    for (const candidate of CANDIDATES) {
      if (await canConnect(candidate)) return candidate;
    }
    return null;
  }

  return {
    port,
    /** Loopback address to connect to. Falls back to 127.0.0.1 when nothing is listening. */
    async host() {
      if (host) return host;
      probing ??= probe().finally(() => {
        probing = null;
      });
      host = await probing;
      return host ?? CANDIDATES[0];
    },
    /** True when something is accepting connections on the target port. */
    async isUp() {
      host = null;
      await this.host();
      return host !== null;
    },
    /** Forget the cached address (call after ECONNREFUSED). */
    invalidate() {
      host = null;
    },
  };
}
