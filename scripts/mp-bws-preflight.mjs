// Read-only Bitwarden Secrets Manager metadata readiness check for Mercado Pago sandbox.
// Never expose decrypted secret values, output fragments, token hashes, or raw CLI error streams.
// No local .env/.dev.vars/credential files, no network calls to Mercado Pago or Cloudflare.
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const REQUIRED = Object.freeze(['MP_ACCESS_TOKEN_TEST','MP_WEBHOOK_SECRET_TEST']);
const PROJECT = 'HG-DEV';

export function analyzeMetadata(projectJson, secretJson) {
  let projects, secrets;
  try {
    const parsedProjects = JSON.parse(projectJson);
    const parsedSecrets = JSON.parse(secretJson);
    projects = Array.isArray(parsedProjects) ? parsedProjects : parsedProjects?.data;
    secrets = Array.isArray(parsedSecrets) ? parsedSecrets : parsedSecrets?.data;
    if (!Array.isArray(projects) || !Array.isArray(secrets)) return 'BWS_INVALID_RESPONSE';
  } catch { return 'BWS_INVALID_RESPONSE'; }

  const dev = projects.filter(p => p?.name === PROJECT && typeof p?.id === 'string');
  if (dev.length !== 1) return 'BWS_PROJECT_UNAVAILABLE';
  const ids = new Set(dev.map(p => p.id));
  const allowed = secrets.filter(s => s && ids.has(s.projectId ?? s.project_id));
  for (const key of REQUIRED) {
    if (allowed.filter(s => s.key === key).length !== 1) return 'BWS_MP_SECRETS_MISSING';
  }
  return 'BWS_MP_SECRETS_READY';
}

function runBws(args) {
  // Buffer stdout only in the local process; do not print or save it. BWS may
  // return decrypted values even for secret list. Exit codes are sanitized.
  const result = spawnSync('bws', args, {
    encoding:'utf8', windowsHide:true, timeout:25000,
    maxBuffer:8*1024*1024, shell:false, stdio:['ignore','pipe','pipe'],
  });
  return result.status === 0 && !result.error ? result.stdout : null;
}

export function main() {
  if (typeof process.env.BWS_ACCESS_TOKEN !== 'string' || !process.env.BWS_ACCESS_TOKEN) {
    process.stdout.write('BLOCKED BWS_IDENTITY_UNAVAILABLE\n');
    return 2;
  }
  const projects = runBws(['project','list']);
  if (projects === null) { process.stdout.write('BLOCKED BWS_ACCESS_DENIED_OR_UNAVAILABLE\n'); return 2; }
  const secrets = runBws(['secret','list']);
  if (secrets === null) { process.stdout.write('BLOCKED BWS_ACCESS_DENIED_OR_UNAVAILABLE\n'); return 2; }
  const status = analyzeMetadata(projects, secrets);
  process.stdout.write((status === 'BWS_MP_SECRETS_READY' ? 'PASS ' : 'BLOCKED ') + status + '\n');
  return status === 'BWS_MP_SECRETS_READY' ? 0 : 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
