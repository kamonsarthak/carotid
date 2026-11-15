import { createProxy } from './proxy/server.js';
import { createRuleset } from './rules/engine.js';
import { profiles, describeEffects } from './profiles/index.js';
import { readConfig } from './config/load.js';
import { watchConfig } from './config/watch.js';
import { lanAddresses } from './net/lan.js';
import { listen } from './net/port.js';
import { createColors } from './ui/color.js';
import { renderBanner } from './ui/banner.js';
import { formatEntry } from './ui/logger.js';

export const DEFAULT_LISTEN_PORT = 2345;

/** The CLI flag wins over the file, so a one-off `--profile` always does what it says. */
function effectiveProfile(cliProfile, config) {
  return cliProfile ?? config.profile;
}

function buildRuleset(cliProfile, config) {
  const name = effectiveProfile(cliProfile, config);
  return createRuleset({ profileName: name, profile: name ? profiles[name] : null, rules: config.rules });
}

function summarise(cliProfile, config) {
  const name = effectiveProfile(cliProfile, config);
  const parts = [name ? `profile ${name} (${describeEffects(profiles[name])})` : 'no profile'];
  parts.push(`${config.rules.length} rule${config.rules.length === 1 ? '' : 's'}`);
  if (cliProfile && config.profile && config.profile !== cliProfile) {
    parts.push(`--profile ${cliProfile} overrides "profile: ${config.profile}" from the file`);
  }
  return parts.join(', ');
}

function printConfigErrors(name, errors, c) {
  console.error(c.red(`  ${name} has ${errors.length === 1 ? 'a problem' : `${errors.length} problems`}:`));
  for (const error of errors) {
    console.error(c.red(`    - ${error.split('\n').join('\n      ')}`));
  }
}

/**
 * Run the proxy until the process is stopped.
 *
 * @param {object} options
 * @param {number} options.targetPort
 * @param {number | null} options.listenPort  explicit --listen port, or null to auto-pick
 * @param {string | null} options.profile     --profile flag
 * @param {boolean} options.qr
 * @param {string} [options.cwd]
 */
export async function start({ targetPort, listenPort, profile: cliProfile, qr, cwd = process.cwd() }) {
  const c = createColors();
  const empty = { profile: null, rules: [] };

  // Config: a broken file is reported but never stops carotid from starting.
  const loaded = await readConfig(cwd);
  let config = loaded.config ?? empty;
  let lastText = loaded.text;

  const proxy = createProxy({
    targetPort,
    ruleset: buildRuleset(cliProfile, config),
    onEntry: (entry) => console.log(formatEntry(entry, c, process.stdout.columns)),
  });

  const wanted = listenPort ?? DEFAULT_LISTEN_PORT;
  let port;
  try {
    port = await listen(proxy.server, { port: wanted, host: '0.0.0.0', strict: listenPort !== null, avoid: [targetPort] });
  } catch (err) {
    const reason =
      err.code === 'EADDRINUSE'
        ? `Port ${wanted} is already in use. Pick another with --listen, or omit --listen to auto-pick.`
        : err.code === 'EACCES'
          ? `Not allowed to listen on port ${wanted}. Try a port above 1024.`
          : `Could not start listening: ${err.message}`;
    console.error(c.red(`\n  ${reason}\n`));
    process.exit(1);
  }

  console.log(
    renderBanner(
      {
        port,
        targetPort,
        lan: lanAddresses(),
        rulesSummary: summarise(cliProfile, config),
        configName: loaded.name,
        targetUp: await proxy.upstream.isUp(),
        movedFrom: port === wanted ? null : wanted,
        qr,
        platform: process.platform,
      },
      c,
    ),
  );
  if (loaded.errors.length) {
    printConfigErrors(loaded.name, loaded.errors, c);
    console.error(c.yellow('  Running without it for now. Fix the file and save: carotid reloads it automatically.\n'));
  }

  // Hot reload. Compare file contents so duplicate watch events stay silent.
  const stopWatching = watchConfig(cwd, async () => {
    const next = await readConfig(cwd);
    if (next.text === lastText) return;
    lastText = next.text;

    if (next.errors.length) {
      printConfigErrors(next.name, next.errors, c);
      console.error(c.yellow('  Keeping the previous rules until the file is fixed.'));
      return;
    }
    config = next.config;
    proxy.setRuleset(buildRuleset(cliProfile, config));
    const what = next.name ? `${next.name} reloaded` : 'config file removed';
    console.log(c.cyan(`  [config] ${what}: ${summarise(cliProfile, config)}`));
  });

  proxy.server.on('error', (err) => {
    console.error(c.red(`  Server error: ${err.message}`));
  });

  const shutdown = () => {
    stopWatching();
    const { total } = proxy.store.stats().requests;
    console.log(c.dim(`\n  carotid stopped after ${total} request${total === 1 ? '' : 's'}.`));
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return { proxy, port };
}
