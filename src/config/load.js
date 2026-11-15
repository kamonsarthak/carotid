import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { validateConfig } from '../rules/validate.js';
import { profileNames } from '../profiles/index.js';

export const CONFIG_FILES = ['carotid.yaml', 'carotid.yml'];

const EMPTY = Object.freeze({ profile: null, rules: [] });

/**
 * Look for carotid.yaml in `dir`, parse and validate it. Never throws: problems come
 * back as human-readable strings in `errors` (and `config` is then null).
 *
 * @returns {Promise<{ name: string | null, text: string | null, config: { profile: string | null, rules: object[] } | null, errors: string[] }>}
 */
export async function readConfig(dir) {
  const name = CONFIG_FILES.find((file) => existsSync(path.join(dir, file))) ?? null;
  if (!name) return { name: null, text: null, config: { ...EMPTY }, errors: [] };

  let text;
  try {
    text = readFileSync(path.join(dir, name), 'utf8');
  } catch (err) {
    return { name, text: null, config: null, errors: [`cannot read the file: ${err.message}`] };
  }

  let raw;
  try {
    // Loaded on demand: the zero-config path never pays for the YAML parser.
    const { parse } = await import('yaml');
    raw = parse(text);
  } catch (err) {
    // yaml's messages already include line, column and a code frame
    const message = err.message.split('\n').filter((line) => line.trim()).join('\n');
    return { name, text, config: null, errors: [`invalid YAML: ${message}`] };
  }

  const { config, errors } = validateConfig(raw, profileNames);
  return { name, text, config, errors };
}
