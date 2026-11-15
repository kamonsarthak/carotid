import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { toHar } from './har.js';
import { toJson } from './json.js';
import { createColors } from '../ui/color.js';
import { DEFAULT_LISTEN_PORT } from '../start.js';

export const EXPORT_FORMATS = ['har', 'json'];
const SCAN_PORTS = 20; // same range the auto-picker uses

class ExportError extends Error {
  friendly = true;
}

/** Fetch the ring buffer from a carotid on `port`, or null if there is none. */
async function fetchCapture(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/__carotid/requests`, { signal: AbortSignal.timeout(800) });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.carotid === 'string' && Array.isArray(data.entries) ? { port, ...data } : null;
  } catch {
    return null;
  }
}

/** Find a running carotid: the given port, or the first one in the default range. */
async function findInstance(listenPort) {
  if (listenPort !== null) {
    const capture = await fetchCapture(listenPort);
    if (!capture) throw new ExportError(`No carotid is running on port ${listenPort}.`);
    return capture;
  }
  const ports = Array.from({ length: SCAN_PORTS }, (_, i) => DEFAULT_LISTEN_PORT + i);
  const found = (await Promise.all(ports.map(fetchCapture))).filter(Boolean);
  if (!found.length) {
    throw new ExportError(
      'No running carotid found. Start one first (e.g. "carotid 3000") and run export from another terminal.\n' +
        '  If it uses a custom port, pass it: carotid export --listen <port>',
    );
  }
  return { ...found[0], others: found.slice(1).map((f) => f.port) };
}

const timestamp = () => new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');

/**
 * `carotid export`: the capture lives in the memory of the running proxy, so this
 * asks it for the buffer over HTTP and writes the file from here.
 *
 * @param {{ format: 'har' | 'json', out: string | null, listenPort: number | null }} options
 */
export async function runExport({ format, out, listenPort }) {
  const c = createColors();
  const capture = await findInstance(listenPort);
  const data = format === 'har' ? toHar(capture.entries) : toJson(capture.entries, capture);

  const file = path.resolve(out ?? `carotid-export-${timestamp()}.${format}`);
  try {
    writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  } catch (err) {
    throw new ExportError(`Could not write ${file}: ${err.message}`);
  }

  const n = capture.entries.length;
  console.log(`\n  ${c.green('Exported')} ${n} request${n === 1 ? '' : 's'} from carotid on port ${capture.port} (${capture.target})`);
  console.log(`  ${c.bold(file)}`);
  if (capture.others?.length) {
    console.log(c.dim(`  Other carotid instances on: ${capture.others.join(', ')}. Use --listen <port> to export from one of them.`));
  }
  if (n === 0) console.log(c.dim('  Nothing captured yet: send some requests through carotid first.'));
  console.log(c.dim('  Note: exports include request headers such as cookies and tokens. Check before sharing.\n'));
}
