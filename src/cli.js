import { parseArgs } from 'node:util';
import { VERSION } from './version.js';
import { profiles, profileNames, describeEffects } from './profiles/index.js';
import { createColors } from './ui/color.js';
import { start, DEFAULT_LISTEN_PORT } from './start.js';
import { runExport, EXPORT_FORMATS } from './export/index.js';

function helpText() {
  const width = Math.max(...profileNames.map((name) => name.length));
  const profileLines = profileNames.map((name) => `  ${name.padEnd(width)}  ${describeEffects(profiles[name])}`);
  return `carotid ${VERSION}: make localhost behave like the real world

Usage
  carotid <port> [options]     proxy localhost:<port>, print a LAN URL + QR code
  carotid export [options]     save the traffic captured by a running carotid

Options
  -p, --profile <name>   apply a network profile (see below)
  -l, --listen <port>    port carotid listens on (default ${DEFAULT_LISTEN_PORT}, next free one if busy)
      --no-qr            do not print the QR code
  -h, --help             show this help
  -v, --version          show the version

Export options
  -f, --format <fmt>     har (default) or json
  -o, --out <file>       output file (default carotid-export-<time>.<fmt>)
  -l, --listen <port>    port of the running carotid (default: found automatically)

Profiles
${profileLines.join('\n')}

Config
  Put a carotid.yaml in the folder you run carotid from. It is picked up
  automatically and reloaded on every save. Example:

    profile: 3g
    rules:
      - path: /api/**
        method: POST
        fail: 20        # percent
        status: 503

Examples
  carotid 3000
  carotid 5173 --profile slow-3g
  carotid export --format har
`;
}

function parsePort(value, what) {
  const port = Number(value);
  if (!/^\d+$/.test(String(value)) || port < 1 || port > 65535) {
    throw new UsageError(`${what} must be a port number between 1 and 65535, got "${value}".`);
  }
  return port;
}

class UsageError extends Error {}

async function run(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        profile: { type: 'string', short: 'p' },
        listen: { type: 'string', short: 'l' },
        format: { type: 'string', short: 'f' },
        out: { type: 'string', short: 'o' },
        'no-qr': { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    });
  } catch (err) {
    throw new UsageError(err.message.split('. ')[0] + '.');
  }
  const { values, positionals } = parsed;

  if (values.help) return console.log(helpText());
  if (values.version) return console.log(VERSION);

  const [command, ...rest] = positionals;
  if (command === undefined) {
    throw new UsageError('Which port is your app on? Try: carotid 3000');
  }
  const listenPort = values.listen !== undefined ? parsePort(values.listen, '--listen') : null;

  if (command === 'export') {
    const format = values.format ?? 'har';
    if (!EXPORT_FORMATS.includes(format)) {
      throw new UsageError(`--format must be one of: ${EXPORT_FORMATS.join(', ')}. Got "${format}".`);
    }
    return runExport({ format, out: values.out ?? null, listenPort });
  }

  if (rest.length) throw new UsageError(`Unexpected extra argument "${rest[0]}".`);
  const targetPort = parsePort(command, 'The port');
  if (listenPort === targetPort) {
    throw new UsageError(`--listen ${listenPort} is the port of your app. carotid needs a different port for itself.`);
  }
  if (values.profile !== undefined && !profileNames.includes(values.profile)) {
    throw new UsageError(`Unknown profile "${values.profile}". Available: ${profileNames.join(', ')}.`);
  }

  await start({ targetPort, listenPort, profile: values.profile ?? null, qr: !values['no-qr'] });
}

export async function main(argv) {
  try {
    await run(argv);
  } catch (err) {
    const c = createColors();
    if (err.friendly) {
      console.error(`\n  ${c.red(err.message)}\n`);
    } else if (err instanceof UsageError) {
      console.error(`\n  ${c.red(err.message)}\n  ${c.dim('Run "carotid --help" for usage.')}\n`);
    } else {
      console.error(`\n  ${c.red(`carotid failed: ${err.message}`)}\n`);
    }
    process.exitCode = 1;
  }
}
