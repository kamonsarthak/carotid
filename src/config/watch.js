import { watch, watchFile, unwatchFile } from 'node:fs';
import path from 'node:path';
import { CONFIG_FILES } from './load.js';

/**
 * Call `onChange` (debounced) whenever carotid.yaml is created, saved or deleted.
 *
 * We watch the directory rather than the file: editors often save by writing a temp
 * file and renaming it, which silently breaks a watch on the file itself, and watching
 * the directory also notices a config file that did not exist at startup.
 *
 * @returns {() => void} stop watching
 */
export function watchConfig(dir, onChange, debounceMs = 100) {
  let timer = null;
  const trigger = () => {
    clearTimeout(timer);
    timer = setTimeout(onChange, debounceMs);
  };

  try {
    const watcher = watch(dir, { persistent: false }, (_event, filename) => {
      // filename can be null on some platforms: then we cannot tell, so check anyway
      if (!filename || CONFIG_FILES.includes(path.basename(filename.toString()))) trigger();
    });
    watcher.on('error', () => {});
    return () => {
      clearTimeout(timer);
      watcher.close();
    };
  } catch {
    // fs.watch is unavailable on a few filesystems (some network shares): poll instead
    const files = CONFIG_FILES.map((file) => path.join(dir, file));
    for (const file of files) watchFile(file, { interval: 500, persistent: false }, trigger);
    return () => {
      clearTimeout(timer);
      for (const file of files) unwatchFile(file, trigger);
    };
  }
}
