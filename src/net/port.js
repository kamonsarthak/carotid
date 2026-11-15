function tryListen(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve(server.address().port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

/**
 * Listen on `port`, or, unless `strict`, on the next free port after it.
 *
 * @param {import('node:net').Server} server
 * @param {object} options
 * @param {number} options.port      first port to try
 * @param {string} options.host
 * @param {boolean} [options.strict] fail instead of moving on when the port is taken
 * @param {number[]} [options.avoid] ports never to pick (the proxy target)
 * @param {number} [options.attempts]
 * @returns {Promise<number>} the port actually bound
 */
export async function listen(server, { port, host, strict = false, avoid = [], attempts = 20 }) {
  let lastError;
  for (let candidate = port; candidate < port + attempts && candidate <= 65535; candidate++) {
    if (avoid.includes(candidate)) continue;
    try {
      return await tryListen(server, candidate, host);
    } catch (err) {
      lastError = err;
      const busy = err.code === 'EADDRINUSE' || err.code === 'EACCES';
      if (strict || !busy) throw err;
    }
  }
  throw lastError ?? new Error(`no usable port in ${port}-${port + attempts - 1}`);
}
