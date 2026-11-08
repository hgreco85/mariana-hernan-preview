import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import worker, { createCheckoutPreference } from '../worker/src/index.js';
import {
  DEFAULT_TOKEN_FILE,
  DEFAULT_WEBHOOK_FILE,
  emitStatus,
  loadLocalMpSecrets,
  mergeDevVars,
  resolveSecretPaths,
  validateSecretBytes
} from '../scripts/mp-local-secrets.mjs';
import { runSandboxSmoke } from '../scripts/mp-sandbox-smoke.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FAKE_TOKEN = 'TEST-fake-sandbox-token';
const FAKE_WEBHOOK = 'fake-webhook-secret-value';

function captureStdout(fn) {
  const chunks = [];
  const orig = process.stdout.write;
  process.stdout.write = (chunk) => {
    chunks.push(String(chunk));
    return true;
  };
  try {
    const value = fn();
    return { value, output: chunks.join('') };
  } finally {
    process.stdout.write = orig;
  }
}

test('default credential paths are the Windows sandbox files and can be overridden', () => {
  assert.equal(DEFAULT_TOKEN_FILE, 'C:\\Users\\Administrator\\.mp_test_token');
  assert.equal(DEFAULT_WEBHOOK_FILE, 'C:\\Users\\Administrator\\.mp_webhook_secret');
  const defaults = resolveSecretPaths({});
  assert.equal(defaults.tokenFile, DEFAULT_TOKEN_FILE);
  assert.equal(defaults.webhookFile, DEFAULT_WEBHOOK_FILE);
  const overridden = resolveSecretPaths({
    MP_TEST_TOKEN_FILE: 'D:\\secrets\\token',
    MP_WEBHOOK_SECRET_FILE: 'D:\\secrets\\hook',
    MP_DEV_VARS_FILE: 'D:\\secrets\\.dev.vars'
  });
  assert.equal(overridden.tokenFile, 'D:\\secrets\\token');
  assert.equal(overridden.webhookFile, 'D:\\secrets\\hook');
  assert.equal(overridden.devVarsFile, 'D:\\secrets\\.dev.vars');
});

test('validateSecretBytes accepts one clean line and rejects empty, BOM, multiline, and whitespace', () => {
  assert.equal(validateSecretBytes(Buffer.from(FAKE_TOKEN)).ok, true);
  assert.equal(validateSecretBytes(Buffer.from(FAKE_TOKEN)).value, FAKE_TOKEN);
  assert.equal(validateSecretBytes(Buffer.from('')).reason, 'empty');
  assert.equal(validateSecretBytes(Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(FAKE_TOKEN)])).reason, 'bom');
  assert.equal(validateSecretBytes(Buffer.from([0xFF, 0xFE, 0x41, 0x00])).reason, 'bom');
  assert.equal(validateSecretBytes(Buffer.from(FAKE_TOKEN + '\n')).reason, 'not_single_line');
  assert.equal(validateSecretBytes(Buffer.from(FAKE_TOKEN + '\r\n')).reason, 'not_single_line');
  assert.equal(validateSecretBytes(Buffer.from(FAKE_TOKEN + '\n' + 'second')).reason, 'not_single_line');
  assert.equal(validateSecretBytes(Buffer.from(FAKE_TOKEN + ' ')).reason, 'trailing_whitespace');
  assert.equal(validateSecretBytes(Buffer.from(FAKE_TOKEN + '\t')).reason, 'trailing_whitespace');
  assert.equal(validateSecretBytes(Buffer.from(' ' + FAKE_TOKEN)).reason, 'leading_whitespace');
  assert.equal(validateSecretBytes(Buffer.from('REPLACE_WITH_MP_ACCESS_TOKEN')).reason, 'placeholder');
  assert.equal(validateSecretBytes(Buffer.from([0xFF, 0x00])).reason, 'invalid_encoding');
});

test('secret files and dev vars paths are gitignored', () => {
  const paths = [
    'worker/.dev.vars',
    'worker/.dev.vars.local',
    'worker/.dev.vars.unittest',
    '.dev.vars',
    '.mp_test_token',
    '.mp_webhook_secret',
    'worker/.mp_test_token',
    'nested/.mp_webhook_secret'
  ];
  for (const rel of paths) {
    const result = spawnSync('git', ['check-ignore', '-q', '--', rel], { cwd: repoRoot });
    assert.equal(result.status, 0, rel + ' must be gitignored');
  }
});

test('loader writes gitignored .dev.vars from fake files and does not print them', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-local-'));
  const tokenFile = path.join(dir, 'token');
  const webhookFile = path.join(dir, 'webhook');
  const devVars = path.join(repoRoot, 'worker', '.dev.vars.unittest');
  fs.writeFileSync(tokenFile, FAKE_TOKEN);
  fs.writeFileSync(webhookFile, FAKE_WEBHOOK);
  fs.writeFileSync(devVars, 'SHARED_SECRET="keep-me"\nOTHER=1\n');
  try {
    const loaded = loadLocalMpSecrets({
      tokenFile,
      webhookFile,
      devVarsFile: devVars,
      repoRoot
    });
    assert.equal(loaded.ok, true);
    assert.equal(loaded.token, FAKE_TOKEN);
    assert.equal(loaded.webhookSecret, FAKE_WEBHOOK);
    const written = fs.readFileSync(devVars, 'utf8');
    assert.match(written, /SHARED_SECRET="keep-me"/);
    assert.match(written, /OTHER=1/);
    assert.match(written, new RegExp('MP_ACCESS_TOKEN="' + FAKE_TOKEN + '"'));
    assert.match(written, new RegExp('MP_WEBHOOK_SECRET="' + FAKE_WEBHOOK + '"'));
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(devVars).mode & 0o777, 0o600);
    }
    assert.equal(fs.lstatSync(devVars).isSymbolicLink(), false);
  } finally {
    fs.rmSync(devVars, { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('loader refuses to write a tracked path and reports file validation failures', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-local-'));
  const tokenFile = path.join(dir, 'token');
  const webhookFile = path.join(dir, 'webhook');
  const tracked = path.join(repoRoot, 'worker', 'mp-secrets-tracked.txt');
  fs.writeFileSync(tokenFile, FAKE_TOKEN);
  fs.writeFileSync(webhookFile, FAKE_WEBHOOK + '\n');
  try {
    const badWebhook = loadLocalMpSecrets({ tokenFile, webhookFile, devVarsFile: path.join(repoRoot, 'worker', '.dev.vars'), repoRoot });
    assert.equal(badWebhook.ok, false);
    assert.equal(badWebhook.reason, 'webhook_not_single_line');
    assert.equal(fs.existsSync(path.join(repoRoot, 'worker', '.dev.vars')), false);

    fs.writeFileSync(webhookFile, FAKE_WEBHOOK);
    const badDest = loadLocalMpSecrets({ tokenFile, webhookFile, devVarsFile: tracked, repoRoot });
    assert.equal(badDest.ok, false);
    assert.equal(badDest.reason, 'dev_vars_not_ignored');
    assert.equal(fs.existsSync(tracked), false);

    const missing = loadLocalMpSecrets({
      tokenFile: path.join(dir, 'nope'),
      webhookFile,
      devVarsFile: path.join(repoRoot, 'worker', '.dev.vars'),
      repoRoot
    });
    assert.equal(missing.ok, false);
    assert.equal(missing.reason, 'token_missing');
  } finally {
    fs.rmSync(tracked, { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('mergeDevVars quotes embedded quotes and replaces only the MP keys', () => {
  const merged = mergeDevVars('MP_ACCESS_TOKEN="old"\nKEEP=yes\n', 'TEST-quo"te', 'hook');
  assert.match(merged, /KEEP=yes/);
  assert.match(merged, /MP_ACCESS_TOKEN="TEST-quo\\"te"/);
  assert.match(merged, /MP_WEBHOOK_SECRET="hook"/);
  assert.equal(merged.includes('old'), false);
});

test('emitStatus prints PASS/FAIL only and blocks values, fragments, and hashes', () => {
  const hash = createHash('sha256').update(FAKE_TOKEN).digest('hex');
  const cases = [
    ['PASS', 'PASS\n'],
    ['FAIL token_missing', 'FAIL token_missing\n'],
    ['PASS users_me id=4242', 'PASS users_me id=4242\n'],
    ['PASS ' + FAKE_TOKEN, 'FAIL output_guard\n'],
    ['PASS ' + FAKE_TOKEN.slice(0, 16), 'FAIL output_guard\n'],
    ['PASS ' + FAKE_TOKEN.slice(5), 'FAIL output_guard\n'],
    ['PASS ' + FAKE_WEBHOOK.slice(0, 16), 'FAIL output_guard\n'],
    ['PASS ' + hash, 'FAIL output_guard\n'],
    ['Bearer ' + FAKE_TOKEN, 'FAIL output_guard\n']
  ];
  for (const [line, expected] of cases) {
    const captured = captureStdout(() => emitStatus(line, [FAKE_TOKEN, FAKE_WEBHOOK]));
    assert.equal(captured.output, expected);
    assert.equal(captured.output.includes(FAKE_TOKEN), false);
    assert.equal(captured.output.includes(FAKE_WEBHOOK), false);
    assert.equal(captured.output.includes(hash), false);
  }
});

test('loader CLI prints PASS only for fake credential files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-local-'));
  const tokenFile = path.join(dir, 'token');
  const webhookFile = path.join(dir, 'webhook');
  const devVars = path.join(repoRoot, 'worker', '.dev.vars.unittest');
  fs.writeFileSync(tokenFile, FAKE_TOKEN);
  fs.writeFileSync(webhookFile, FAKE_WEBHOOK);
  const result = spawnSync(process.execPath, [path.join(repoRoot, 'scripts', 'load-mp-local-secrets.mjs')], {
    cwd: repoRoot,
    env: {
      ...process.env,
      MP_TEST_TOKEN_FILE: tokenFile,
      MP_WEBHOOK_SECRET_FILE: webhookFile,
      MP_DEV_VARS_FILE: devVars
    },
    encoding: 'utf8'
  });
  try {
    assert.equal(result.status, 0);
    assert.equal(result.stdout, 'PASS\n');
    assert.equal(result.stderr, '');
    assert.equal(result.stdout.includes(FAKE_TOKEN), false);
    assert.equal(result.stdout.includes(FAKE_WEBHOOK), false);
    const hash = createHash('sha256').update(FAKE_TOKEN).digest('hex');
    assert.equal(result.stdout.includes(hash), false);
  } finally {
    fs.rmSync(devVars, { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('loader CLI prints FAIL when the token file is missing', () => {
  const result = spawnSync(process.execPath, [path.join(repoRoot, 'scripts', 'load-mp-local-secrets.mjs')], {
    cwd: repoRoot,
    env: {
      ...process.env,
      MP_TEST_TOKEN_FILE: path.join(os.tmpdir(), 'mp-missing-token-' + process.pid),
      MP_WEBHOOK_SECRET_FILE: path.join(os.tmpdir(), 'mp-missing-webhook-' + process.pid),
      MP_DEV_VARS_FILE: path.join(repoRoot, 'worker', '.dev.vars.unittest')
    },
    encoding: 'utf8'
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, 'FAIL token_missing\n');
  assert.equal(result.stderr, '');
});

test('sandbox smoke uses the worker preference path and prints only ids', async () => {
  const calls = [];
  const lines = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url: String(url), opts });
    if (String(url) === 'https://api.mercadopago.com/users/me') {
      return new Response(JSON.stringify({
        id: 4242,
        email: 'hidden@example.com',
        nickname: FAKE_TOKEN
      }), { status: 200 });
    }
    if (String(url) === 'https://api.mercadopago.com/checkout/preferences') {
      return new Response(JSON.stringify({
        id: '998877-abc',
        init_point: 'https://www.mercadopago.com/checkout/v1/redirect?pref_id=998877-abc',
        sandbox_init_point: 'https://sandbox.mercadopago.com/checkout/v1/redirect?pref_id=998877-abc'
      }), { status: 201 });
    }
    throw new Error('unexpected url');
  };

  const result = await runSandboxSmoke({
    token: FAKE_TOKEN,
    webhookSecret: FAKE_WEBHOOK,
    fetchImpl,
    emit(line) {
      lines.push(line);
      return true;
    }
  });

  assert.equal(result.ok, true);
  assert.deepEqual(lines, [
    'PASS users_me id=4242',
    'PASS preference id=998877-abc external_reference=' + result.orderId
  ]);
  assert.equal(lines.join('\n').includes(FAKE_TOKEN), false);
  assert.equal(lines.join('\n').includes(FAKE_WEBHOOK), false);
  assert.equal(lines.join('\n').includes('hidden@example.com'), false);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer ' + FAKE_TOKEN);
  assert.equal(calls[1].url, 'https://api.mercadopago.com/checkout/preferences');
  assert.equal(calls[1].opts.method, 'POST');
  assert.equal(calls[1].opts.headers.Authorization, 'Bearer ' + FAKE_TOKEN);
  const body = JSON.parse(calls[1].opts.body);
  assert.equal(body.external_reference, result.orderId);
  assert.equal(body.items[0].unit_price, 100);
  assert.equal(body.items[0].currency_id, 'ARS');
  assert.equal(body.items[0].title, 'Sandbox smoke (no charge)');
  assert.equal(body.notification_url, undefined);
  assert.equal(JSON.stringify(body).includes(FAKE_WEBHOOK), false);
  assert.equal(JSON.stringify(calls[1].opts.headers).includes(FAKE_WEBHOOK), false);
});

test('sandbox smoke refuses a production token and live mode before any request', async () => {
  let called = 0;
  const fetchImpl = async () => {
    called += 1;
    return new Response('{}', { status: 200 });
  };
  const lines = [];
  const emit = (line) => {
    lines.push(line);
    return true;
  };
  const prod = await runSandboxSmoke({
    token: 'APP_USR-fake-production-token',
    webhookSecret: FAKE_WEBHOOK,
    fetchImpl,
    emit
  });
  assert.equal(prod.ok, false);
  assert.equal(lines[0], 'FAIL token_not_sandbox');
  assert.equal(called, 0);

  const live = await createCheckoutPreference({
    LIVE_MODE: 'true',
    MP_ACCESS_TOKEN: FAKE_TOKEN,
    MP_WEBHOOK_SECRET: FAKE_WEBHOOK
  }, {
    orderId: 'sandbox-smoke-skip',
    experienceId: 'sandbox-smoke',
    title: 'Sandbox smoke (no charge)',
    amount: 100
  }, { sandboxOnly: true, fetchImpl });
  assert.equal(live.ok, false);
  assert.equal(live.reason, 'live_mode');
  assert.equal(called, 0);
});

test('users/me failure does not create a preference', async () => {
  const urls = [];
  const lines = [];
  const result = await runSandboxSmoke({
    token: FAKE_TOKEN,
    webhookSecret: FAKE_WEBHOOK,
    fetchImpl: async (url) => {
      urls.push(String(url));
      return new Response('{}', { status: 401 });
    },
    emit(line) {
      lines.push(line);
      return true;
    }
  });
  assert.equal(result.ok, false);
  assert.deepEqual(urls, ['https://api.mercadopago.com/users/me']);
  assert.deepEqual(lines, ['FAIL users_me status=401']);
});

test('worker preference fallback calls checkout/preferences outside strict orders mode', async () => {
  const origFetch = globalThis.fetch;
  let preferenceCalls = 0;
  let prefBody = null;
  globalThis.fetch = async (url, opts) => {
    const urlStr = String(url);
    if (urlStr.includes('mock.script.google.com')) {
      const payload = opts && opts.body ? JSON.parse(opts.body) : {};
      if (payload.type === 'order') {
        return new Response(JSON.stringify({
          orderId: 'ORD-PREF-1',
          amount: 1500,
          experienceId: 'V09-002',
          title: 'Test gift'
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (urlStr.includes('/v1/orders')) {
      return new Response(JSON.stringify({ message: 'no orders' }), { status: 400 });
    }
    if (urlStr.includes('/checkout/preferences')) {
      preferenceCalls += 1;
      prefBody = JSON.parse(opts.body);
      return new Response(JSON.stringify({
        id: 'pref-sandbox-1',
        init_point: 'https://www.mercadopago.com/checkout/v1/redirect?pref_id=pref-sandbox-1',
        sandbox_init_point: 'https://sandbox.mercadopago.com/checkout/v1/redirect?pref_id=pref-sandbox-1'
      }), { status: 201 });
    }
    throw new Error('unexpected fetch');
  };

  try {
    const res = await worker.fetch(new Request('https://worker.test/api/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: 'ORD-PREF-1' })
    }), {
      SHARED_SECRET: 'super-secret-key-2026',
      APPS_SCRIPT_URL: 'https://mock.script.google.com/exec',
      MP_ACCESS_TOKEN: FAKE_TOKEN,
      MP_WEBHOOK_SECRET: FAKE_WEBHOOK,
      MP_API_MODE: 'auto',
      LIVE_MODE: 'false',
      APP_URL: 'https://example.test/'
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.apiUsed, 'preferences');
    assert.equal(json.mpOrderId, 'pref-sandbox-1');
    assert.equal(json.checkoutUrl, 'https://sandbox.mercadopago.com/checkout/v1/redirect?pref_id=pref-sandbox-1');
    assert.equal(preferenceCalls, 1);
    assert.equal(prefBody.external_reference, 'ORD-PREF-1');
    assert.equal(prefBody.items[0].unit_price, 1500);
    assert.equal(prefBody.items[0].currency_id, 'ARS');
    assert.equal(prefBody.expires, undefined);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('production wrangler config stays sandbox-off and strict orders', () => {
  const toml = fs.readFileSync(path.join(repoRoot, 'worker', 'wrangler.toml'), 'utf8');
  assert.match(toml, /MP_API_MODE = "orders"/);
  assert.match(toml, /LIVE_MODE = "false"/);
  assert.equal(toml.includes(FAKE_TOKEN), false);
  assert.equal(toml.includes('APP_USR-'), false);
});
