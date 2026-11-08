// CLI: validate local sandbox credential files and write gitignored .dev.vars.
// Stdout is PASS or FAIL <code>. Secret values are never printed.

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { emitStatus, loadLocalMpSecrets } from './mp-local-secrets.mjs';

function silenceConsole() {
  const noop = () => {};
  for (const method of ['log', 'info', 'debug', 'warn', 'error', 'dir', 'trace', 'table']) {
    console[method] = noop;
  }
}

function isMain() {
  const self = fileURLToPath(import.meta.url);
  const arg = process.argv[1] ? path.resolve(process.argv[1]) : '';
  return arg === self;
}

export function main() {
  silenceConsole();
  try {
    const loaded = loadLocalMpSecrets();
    if (!loaded.ok) {
      emitStatus('FAIL ' + loaded.reason, []);
      return 1;
    }
    const printed = emitStatus('PASS', [loaded.token, loaded.webhookSecret]);
    return printed ? 0 : 1;
  } catch {
    emitStatus('FAIL unexpected', []);
    return 1;
  }
}

if (isMain()) {
  process.exit(main());
}
