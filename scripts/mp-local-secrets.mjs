// Local-only Mercado Pago sandbox secret loader.
// Reads credential files (defaults are the Windows sandbox paths) and writes
// gitignored worker/.dev.vars for `wrangler dev`. Never prints secret values,
// fragments, or hashes. Status output is PASS/FAIL only.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_TOKEN_FILE = 'C:\\Users\\Administrator\\.mp_test_token';
export const DEFAULT_WEBHOOK_FILE = 'C:\\Users\\Administrator\\.mp_webhook_secret';

const PLACEHOLDERS = new Set([
  'REPLACE_WITH_MP_ACCESS_TOKEN',
  'REPLACE_WITH_MP_WEBHOOK_SECRET'
]);

const SAFE_LINE = /^(PASS|FAIL)( [A-Za-z0-9_.=-]{1,160})*$/;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function resolveSecretPaths(env = process.env) {
  return {
    tokenFile: env.MP_TEST_TOKEN_FILE || DEFAULT_TOKEN_FILE,
    webhookFile: env.MP_WEBHOOK_SECRET_FILE || DEFAULT_WEBHOOK_FILE,
    devVarsFile: env.MP_DEV_VARS_FILE || ''
  };
}

export function validateSecretBytes(buf) {
  const bytes = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
    return { ok: false, reason: 'bom' };
  }
  if (bytes.length >= 2 && ((bytes[0] === 0xFF && bytes[1] === 0xFE) || (bytes[0] === 0xFE && bytes[1] === 0xFF))) {
    return { ok: false, reason: 'bom' };
  }

  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, reason: 'invalid_encoding' };
  }

  if (text.length > 0 && text.charCodeAt(0) === 0xFEFF) {
    return { ok: false, reason: 'bom' };
  }
  if (text.length === 0) return { ok: false, reason: 'empty' };
  if (/[\r\n\u2028\u2029]/.test(text)) return { ok: false, reason: 'not_single_line' };
  if (/\s$/u.test(text)) return { ok: false, reason: 'trailing_whitespace' };
  if (/^\s/u.test(text)) return { ok: false, reason: 'leading_whitespace' };
  if (/[\u0000-\u001F\u007F]/.test(text)) return { ok: false, reason: 'not_single_line' };
  if (PLACEHOLDERS.has(text)) return { ok: false, reason: 'placeholder' };
  return { ok: true, value: text };
}

function readSecretFile(filePath) {
  let bytes;
  try {
    bytes = fs.readFileSync(filePath);
  } catch (err) {
    if (err && err.code === 'ENOENT') return { ok: false, reason: 'missing' };
    return { ok: false, reason: 'unreadable' };
  }
  return validateSecretBytes(bytes);
}

function quoteDevVar(value) {
  return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

export function mergeDevVars(existingText, token, webhookSecret) {
  const lines = existingText ? existingText.split(/\r?\n/) : [];
  let sawToken = false;
  let sawWebhook = false;
  const out = [];
  for (const line of lines) {
    if (/^\s*MP_ACCESS_TOKEN\s*=/.test(line)) {
      out.push('MP_ACCESS_TOKEN=' + quoteDevVar(token));
      sawToken = true;
      continue;
    }
    if (/^\s*MP_WEBHOOK_SECRET\s*=/.test(line)) {
      out.push('MP_WEBHOOK_SECRET=' + quoteDevVar(webhookSecret));
      sawWebhook = true;
      continue;
    }
    out.push(line);
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  if (!sawToken) out.push('MP_ACCESS_TOKEN=' + quoteDevVar(token));
  if (!sawWebhook) out.push('MP_WEBHOOK_SECRET=' + quoteDevVar(webhookSecret));
  return out.join('\n') + '\n';
}

function isGitignored(repoRoot, filePath) {
  try {
    execFileSync('git', ['-C', repoRoot, 'check-ignore', '-q', '--', filePath], {
      stdio: 'ignore'
    });
    return true;
  } catch {
    return false;
  }
}

function lineLeaks(line, secrets) {
  if (/Bearer\s/i.test(line)) return true;
  if (/TEST-/i.test(line) || /APP_USR-/i.test(line)) return true;
  if (/\b[a-f0-9]{64}\b/i.test(line)) return true;
  const stripped = line
    .replace(/\bid=[A-Za-z0-9_-]{1,128}\b/g, '')
    .replace(/\bexternal_reference=sandbox-smoke-[0-9a-f-]{36}\b/g, '');
  for (const secret of secrets) {
    if (typeof secret !== 'string' || secret.length < 8) continue;
    if (stripped.includes(secret)) return true;
    const sha = createHash('sha256').update(secret).digest('hex');
    if (line.includes(sha)) return true;
    const window = Math.min(16, secret.length);
    if (window < 8) continue;
    for (let i = 0; i + window <= secret.length; i++) {
      if (stripped.includes(secret.slice(i, i + window))) return true;
    }
  }
  return false;
}

export function emitStatus(line, secrets = []) {
  if (typeof line !== 'string' || lineLeaks(line, secrets) || !SAFE_LINE.test(line)) {
    process.stdout.write('FAIL output_guard\n');
    return false;
  }
  process.stdout.write(line + '\n');
  return true;
}

export function loadLocalMpSecrets(options = {}) {
  const env = options.env || process.env;
  const paths = resolveSecretPaths(env);
  const repoRoot = options.repoRoot || REPO_ROOT;
  const tokenFile = options.tokenFile || paths.tokenFile;
  const webhookFile = options.webhookFile || paths.webhookFile;
  const devVarsFile = path.resolve(
    options.devVarsFile || paths.devVarsFile || path.join(repoRoot, 'worker', '.dev.vars')
  );

  const tokenResult = readSecretFile(tokenFile);
  if (!tokenResult.ok) return { ok: false, reason: 'token_' + tokenResult.reason };
  const webhookResult = readSecretFile(webhookFile);
  if (!webhookResult.ok) return { ok: false, reason: 'webhook_' + webhookResult.reason };

  if (!isGitignored(repoRoot, devVarsFile)) {
    return { ok: false, reason: 'dev_vars_not_ignored' };
  }

  let existingStat = null;
  try {
    existingStat = fs.lstatSync(devVarsFile);
  } catch (err) {
    if (!err || err.code !== 'ENOENT') return { ok: false, reason: 'dev_vars_unwritable' };
  }
  if (existingStat && existingStat.isSymbolicLink()) {
    return { ok: false, reason: 'dev_vars_symlink' };
  }

  const parent = path.dirname(devVarsFile);
  let parentStat;
  try {
    parentStat = fs.lstatSync(parent);
  } catch {
    return { ok: false, reason: 'dev_vars_unwritable' };
  }
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
    return { ok: false, reason: 'dev_vars_unwritable' };
  }

  let existing = '';
  if (existingStat) {
    try {
      existing = fs.readFileSync(devVarsFile, 'utf8');
    } catch {
      return { ok: false, reason: 'dev_vars_unwritable' };
    }
  }

  const body = mergeDevVars(existing, tokenResult.value, webhookResult.value);
  const tmp = path.join(parent, '.dev.vars.' + process.pid + '.tmp');
  try {
    fs.writeFileSync(tmp, body, { mode: 0o600, flag: 'w' });
    fs.renameSync(tmp, devVarsFile);
    try { fs.chmodSync(devVarsFile, 0o600); } catch { /* Windows */ }
  } catch {
    try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
    return { ok: false, reason: 'dev_vars_unwritable' };
  }

  return {
    ok: true,
    token: tokenResult.value,
    webhookSecret: webhookResult.value,
    devVarsFile
  };
}
