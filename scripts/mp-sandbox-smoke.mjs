// Local sandbox smoke test. Uses credential files only to:
//   1. GET https://api.mercadopago.com/users/me
//   2. Create one Checkout Pro preference via the Worker's createCheckoutPreference
// Prints PASS/FAIL and non-secret ids. Does not capture a payment and does not
// change production Worker or Apps Script config.

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createCheckoutPreference } from '../worker/src/index.js';
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

async function fetchMercadoPagoUser(token, fetchImpl) {
  const resp = await fetchImpl('https://api.mercadopago.com/users/me', {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: 'Bearer ' + token
    },
    redirect: 'manual'
  });
  if (resp.status !== 200) {
    try { await resp.arrayBuffer(); } catch { /* discard body */ }
    return { status: resp.status, id: null };
  }
  let json = {};
  try { json = await resp.json(); } catch { json = {}; }
  const id = json && typeof json.id === 'number' && Number.isSafeInteger(json.id) && json.id > 0
    ? String(json.id)
    : null;
  return { status: resp.status, id };
}

export async function runSandboxSmoke({
  token,
  webhookSecret,
  fetchImpl = fetch,
  emit = emitStatus
} = {}) {
  const secrets = [token, webhookSecret].filter(v => typeof v === 'string');
  const say = (line) => emit(line, secrets);

  if (typeof token !== 'string' || !token.startsWith('TEST-')) {
    say('FAIL token_not_sandbox');
    return { ok: false };
  }
  if (typeof webhookSecret !== 'string' || webhookSecret.length === 0) {
    say('FAIL webhook_missing');
    return { ok: false };
  }

  let user;
  try {
    user = await fetchMercadoPagoUser(token, fetchImpl);
  } catch {
    say('FAIL users_me');
    return { ok: false };
  }
  if (!user.id) {
    const status = Number.isInteger(user.status) ? user.status : 0;
    say('FAIL users_me status=' + status);
    return { ok: false };
  }
  if (!say('PASS users_me id=' + user.id)) return { ok: false };

  const orderId = 'sandbox-smoke-' + crypto.randomUUID();
  let pref;
  try {
    pref = await createCheckoutPreference({
      MP_ACCESS_TOKEN: token,
      MP_WEBHOOK_SECRET: webhookSecret,
      LIVE_MODE: 'false',
      APP_URL: 'https://hgreco85.github.io/mariana-hernan-preview/'
    }, {
      orderId,
      experienceId: 'sandbox-smoke',
      title: 'Sandbox smoke (no charge)',
      amount: 100
    }, { sandboxOnly: true, fetchImpl });
  } catch {
    say('FAIL preference');
    return { ok: false };
  }

  if (!pref.ok || typeof pref.preferenceId !== 'string') {
    const status = Number.isInteger(pref.status) ? pref.status : 0;
    say('FAIL preference status=' + status);
    return { ok: false };
  }
  const line = 'PASS preference id=' + pref.preferenceId + ' external_reference=' + orderId;
  if (!say(line)) return { ok: false };
  return { ok: true, userId: user.id, preferenceId: pref.preferenceId, orderId };
}

export async function main() {
  silenceConsole();
  try {
    const loaded = loadLocalMpSecrets();
    if (!loaded.ok) {
      emitStatus('FAIL ' + loaded.reason, []);
      return 1;
    }
    const result = await runSandboxSmoke({
      token: loaded.token,
      webhookSecret: loaded.webhookSecret
    });
    return result.ok ? 0 : 1;
  } catch {
    emitStatus('FAIL unexpected', []);
    return 1;
  }
}

if (isMain()) {
  main().then(code => process.exit(code));
}
