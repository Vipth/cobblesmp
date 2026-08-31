import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

/** Load every command module in this directory into a Map<name, module>. */
export async function loadCommands() {
  const files = readdirSync(here).filter(
    (f) => f.endsWith('.js') && f !== 'index.js' && !f.endsWith('.test.js'),
  );
  const commands = new Map();
  for (const file of files) {
    const mod = await import(pathToFileURL(join(here, file)).href);
    if (mod?.data?.name && typeof mod.execute === 'function') {
      commands.set(mod.data.name, mod);
    } else {
      console.warn(`[commands] ${file} has no { data, execute } export — skipped`);
    }
  }
  return commands;
}
