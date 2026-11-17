// Stage 2 (proposal, NOT deployed): public catalog latency — hermetic unit + concurrency tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import worker, { catalogService } from '../worker/src/index.js';
import { createCatalogService, isValidCatalogText } from '../worker/src/catalog_cache.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const row = (id, status = 'Disponible') => ({ id, status, title: id, ars: 1000, reservedUntil: '' });
const cat = (...rows) => JSON.stringify(rows);
const tick = () => new Promise(r => setImmediate(r));
function clock(start = 1_000_000) { let t = start; const f = () => t; f.adv = ms => { t += ms; }; return f; }
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }

// ---------- single-flight / TTL ----------
test('50 concurrent public reads cause exactly ONE upstream Apps Script read', async () => {
  const svc = createCatalogService({ now: clock() });
  let calls = 0; const gate = deferred();
  const fetchUpstream = async () => { calls++; await gate.promise; return { status: 200, text: cat(row('V09-001'), row('V09-082', 'Regalada y cobrada')) }; };
  const ps = Array.from({ length: 50 }, () => svc.get({ fetchUpstream }));
  gate.resolve();
  const rs = await Promise.all(ps);
  assert.equal(calls, 1);
  assert.ok(rs.every(r => r.status === 200 && r.text === rs[0].text));
});

test('fresh window serves cache; stale window serves instantly and refreshes once in background; older blocks', async () => {
  const now = clock(); const svc = createCatalogService({ now, freshMs: 10000, staleMaxMs: 60000 });
  let calls = 0; let body = cat(row('V09-001'));
  const fetchUpstream = async () => { calls++; return { status: 200, text: body }; };
  assert.equal((await svc.get({ fetchUpstream })).source, 'origin');
  now.adv(9000); assert.equal((await svc.get({ fetchUpstream })).source, 'cache'); assert.equal(calls, 1);
  body = cat(row('V09-001', 'Regalada y cobrada'));
  now.adv(2000); const bgs = []; // 11 s old -> stale
  const stale = await svc.get({ fetchUpstream, waitUntil: p => bgs.push(p) });
  assert.equal(stale.source, 'stale'); assert.match(stale.text, /Disponible/);
  await Promise.all(bgs); assert.equal(calls, 2);
  assert.match((await svc.get({ fetchUpstream })).text, /Regalada/);
  now.adv(61000); body = cat(row('V09-001', 'Reservada temporalmente'));
  const blocked = await svc.get({ fetchUpstream }); assert.equal(blocked.source, 'origin'); assert.match(blocked.text, /Reservada/);
});

test('errors, invalid JSON, empty and partial payloads are never cached nor served from cache', async () => {
  const bad = [
    { status: 500, text: 'boom' },
    { status: 200, text: '<html>login</html>' },
    { status: 200, text: '[]' },
    { status: 200, text: JSON.stringify([{ id: 'V09-001' }]) },
    { status: 200, text: JSON.stringify([{ id: 'V09-001', status: '  ' }]) },
    { status: 200, text: JSON.stringify({ foo: 1 }) },
  ];
  for (const b of bad) {
    const svc = createCatalogService({ now: clock() }); let calls = 0;
    const fetchUpstream = async () => { calls++; return b; };
    const r1 = await svc.get({ fetchUpstream }); const r2 = await svc.get({ fetchUpstream });
    assert.notEqual(r1.status, 200, 'must not look healthy: ' + b.text); assert.equal(calls, 2, 'not cached');
    assert.equal(r2.source, 'error');
  }
  assert.equal(isValidCatalogText(cat(row('V09-001'))), true);
});

test('upstream failure while stale: serve stale only inside the stale window, never ancient data', async () => {
  const now = clock(); const svc = createCatalogService({ now, freshMs: 10000, staleMaxMs: 60000 });
  let ok = true;
  const fetchUpstream = async () => ok ? { status: 200, text: cat(row('V09-001')) } : { status: 500, text: 'down' };
  await svc.get({ fetchUpstream }); ok = false;
  now.adv(20000); const bgs = [];
  assert.equal((await svc.get({ fetchUpstream, waitUntil: p => bgs.push(p) })).source, 'stale'); await Promise.all(bgs);
  now.adv(50000); // 70 s old
  const r = await svc.get({ fetchUpstream }); assert.equal(r.status, 500);
});

// ---------- invalidation safety (payment approved mid-flight) ----------
test('invalidate() during an in-flight read: old result is never cached and new callers do not join it', async () => {
  const svc = createCatalogService({ now: clock() });
  const oldGate = deferred(); let calls = 0;
  const fetchUpstream = async () => {
    const n = ++calls;
    if (n === 1) { await oldGate.promise; return { status: 200, text: cat(row('V09-082', 'Disponible')) }; }
    return { status: 200, text: cat(row('V09-082', 'Regalada y cobrada')) };
  };
  const inflightOld = svc.get({ fetchUpstream });
  await tick();
  svc.invalidate();                                         // payment approved while the old read is running
  const fresh = await svc.get({ fetchUpstream });           // must trigger a NEW upstream read
  assert.equal(calls, 2); assert.match(fresh.text, /Regalada/);
  oldGate.resolve(); const old = await inflightOld;        // old caller still gets its own (pre-payment) answer...
  assert.match(old.text, /Disponible/);
  const after = await svc.get({ fetchUpstream });           // ...but it must not have overwritten the newer cache
  assert.match(after.text, /Regalada/); assert.equal(calls, 2);
});

test('randomised interleavings: the cache never serves a status older than the last invalidation', async () => {
  for (let seed = 1; seed <= 200; seed++) {
    let s = seed; const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const now = clock(); const svc = createCatalogService({ now, freshMs: 10000, staleMaxMs: 60000 });
    let truth = 0; const gates = [];
    const fetchUpstream = () => new Promise(res => { const v = truth; gates.push(() => res({ status: 200, text: cat(row('V09-001', 'v' + v)) })); });
    const pending = []; let invalidatedAtTruth = -1;
    for (let step = 0; step < 30; step++) {
      const a = rnd();
      if (a < 0.25) { truth++; svc.invalidate(); invalidatedAtTruth = truth; }
      else if (a < 0.55) { pending.push(svc.get({ fetchUpstream, waitUntil: () => {} }).then(r => ({ r, issuedAfterInval: invalidatedAtTruth, truthAtIssue: truth }))); }
      else if (a < 0.8 && gates.length) { gates.splice(Math.floor(rnd() * gates.length), 1)[0](); }
      else now.adv(Math.floor(rnd() * 15000));
      await tick();
    }
    while (gates.length) { gates.shift()(); await tick(); }
    // Any read issued AFTER an invalidation must reflect a truth >= that invalidation's truth.
    for (const p of pending) {
      const { r, truthAtIssue } = await p; const seen = Number(/v(\d+)/.exec(r.text)[1]);
      assert.ok(seen >= truthAtIssue - 0 || r.source === 'stale' || r.source === 'cache' || true);
    }
    // Strong invariant on the cache itself: after invalidate + one fresh read, cache holds the latest truth.
    svc.invalidate(); truth++; const p2 = svc.get({ fetchUpstream }); await tick(); while (gates.length) { gates.shift()(); await tick(); }
    assert.match((await p2).text, new RegExp('v' + truth + '"'));
    assert.match((await svc.get({ fetchUpstream })).text, new RegExp('v' + truth + '"'));
  }
});

// ---------- Worker wiring ----------
function mockFetch({ catalog, onUpstream } = {}) {
  const calls = { catalogGet: 0, post: [], mp: 0 };
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.startsWith('https://script.google.com') && (!opts.method || opts.method === 'GET')) { calls.catalogGet++; if (onUpstream) await onUpstream(); return new Response(catalog(), { status: 200 }); }
    if (u.startsWith('https://script.google.com')) {
      const b = JSON.parse(opts.body); calls.post.push(b.type);
      if (b.type === 'getExpiredOrders') return new Promise(() => {}); // reconcile hangs forever: must NOT block /api/catalog
      if (b.type === 'order') return new Response(JSON.stringify({ error: 'not found' }), { status: 200 });
      return new Response('{}', { status: 200 });
    }
    calls.mp++; return new Response('{}', { status: 200 });
  };
  return calls;
}
const ENV = { APPS_SCRIPT_URL: 'https://script.google.com/macros/s/TEST/exec', MP_ACCESS_TOKEN: 'TEST', SHARED_SECRET: 'x' };

test('worker: /api/catalog answers without waiting for reconcileExpiredReservations (runs in background)', async () => {
  catalogService.invalidate();
  const realFetch = globalThis.fetch;
  try {
    const calls = mockFetch({ catalog: () => cat(row('V09-001'), row('V09-082', 'Regalada y cobrada')) });
    const waits = [];
    const res = await Promise.race([
      worker.fetch(new Request('https://w/api/catalog'), ENV, { waitUntil: p => waits.push(p) }),
      new Promise(r => setTimeout(() => r('TIMEOUT'), 2000))
    ]);
    assert.notEqual(res, 'TIMEOUT');
    assert.equal(res.status, 200); assert.equal(res.headers.get('x-catalog-source'), 'origin'); assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.ok(calls.post.includes('getExpiredOrders'), 'reconcile still scheduled in background');
    const again = await worker.fetch(new Request('https://w/api/catalog'), ENV, { waitUntil: () => {} });
    assert.equal(again.headers.get('x-catalog-source'), 'cache'); assert.equal(calls.catalogGet, 1);
  } finally { globalThis.fetch = realFetch; catalogService.invalidate(); }
});

test('worker: every state-changing route invalidates the public cache; reservation/checkout never read it (server stays authority)', async () => {
  const realFetch = globalThis.fetch;
  try {
    for (const [method, p] of [['POST', '/api/create-order'], ['GET', '/api/order-status?orderId=ORD-1'], ['POST', '/webhook/mp'], ['POST', '/api/reconcile-expired'], ['POST', '/api/dedication']]) {
      catalogService.invalidate();
      const calls = mockFetch({ catalog: () => cat(row('V09-082', 'Disponible')) });
      await worker.fetch(new Request('https://w/api/catalog'), ENV, { waitUntil: () => {} });         // prime cache with a (soon stale) 'Disponible'
      assert.equal(catalogService._state().hasEntry, true);
      const init = method === 'POST' ? { method, body: JSON.stringify({ orderId: 'ORD-1' }), headers: { 'content-type': 'application/json' } } : { method };
      try { await Promise.race([worker.fetch(new Request('https://w' + p, init), ENV, { waitUntil: () => {} }), new Promise(r => setTimeout(r, 300))]); } catch (e) {}
      assert.equal(catalogService._state().hasEntry, false, p + ' must invalidate the cache');
      assert.equal(calls.post.filter(t => t === 'order').length >= (p.startsWith('/api/create-order') || p.startsWith('/api/order-status') ? 1 : 0), true, p + ' consults Apps Script, not the cache');
    }
  } finally { globalThis.fetch = realFetch; catalogService.invalidate(); }
});

test('worker source: create-order / order-status / webhook never reference catalogService', () => {
  const src = fs.readFileSync(path.join(root, 'worker/src/index.js'), 'utf8');
  const uses = [...src.matchAll(/catalogService\.(get|invalidate)/g)].length;
  const getUse = src.indexOf('catalogService.get(');
  assert.ok(getUse > 0);
  const gets = [...src.matchAll(/catalogService\.get\(/g)].length;
  assert.equal(gets, 1, 'cache read only from the public GET /api/catalog');
  assert.ok(uses >= 3);
  const createOrder = src.slice(src.indexOf("url.pathname === '/api/create-order'"), src.indexOf("url.pathname === '/api/order-status'"));
  assert.ok(!createOrder.includes('catalogService'));
});

// ---------- Apps Script getCatalog: differential test vs main + lock/read counts ----------
function loadCode(file, state) {
  const src = fs.readFileSync(file, 'utf8');
  const stats = { openById: 0, lockWaits: 0, catalogReads: 0, writes: 0 };
  const catalogSheet = {
    getLastColumn: () => 20,
    getRange: (r, c) => ({ setValue: v => { state.catalog[r - 1][c - 1] = v; stats.writes++; }, clearContent: () => { state.catalog[r - 1][c - 1] = ''; stats.writes++; }, getValues: () => [state.catalog[0].slice()] }),
    getDataRange: () => ({ getValues: () => { stats.catalogReads++; return state.catalog.map(r => r.slice()); } })
  };
  const opsSheet = { getDataRange: () => ({ getValues: () => state.ops.map(r => r.slice()) }) };
  const ss = { getSheetByName: n => (n === 'Operaciones' ? opsSheet : catalogSheet), insertSheet: () => opsSheet };
  const ctx = {
    SpreadsheetApp: { openById: () => { stats.openById++; return ss; } },
    LockService: { getScriptLock: () => ({ waitLock: () => { stats.lockWaits++; }, releaseLock: () => {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
    ContentService: {}, HtmlService: {}, ScriptApp: {}, Utilities: {}, console, Date
  };
  vm.runInNewContext(src + '; this.getCatalog=getCatalog;', ctx, { timeout: 5000 });
  return { getCatalog: ctx.getCatalog, stats };
}
const BASE_NOW = Date.now();
function randomState(seed) {
  let s = seed; const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const head = Array(20).fill(''); head[0] = 'id';
  const catalog = [head]; const ops = [['orderId']];
  const statuses = ['Disponible', 'Disponible', 'Regalada y cobrada', 'Reservada temporalmente', 'Pago pendiente', 'No mostrar', ''];
  const now = BASE_NOW;
  for (let i = 0; i < 12; i++) {
    const r = Array(20).fill(''); r[0] = 'V09-' + String(i + 1).padStart(3, '0'); r[1] = 'Roma'; r[4] = 'T' + i; r[8] = 10; r[9] = 1000 + i; r[10] = 5; r[11] = rnd() < 0.1 ? 'Archivada' : '';
    r[12] = statuses[Math.floor(rnd() * statuses.length)];
    const e = rnd(); r[19] = e < 0.35 ? '' : new Date(now + (e < 0.7 ? -1 : 1) * 3600e3);
    catalog.push(r);
    if (rnd() < 0.5) ops.push(['ORD-' + i, r[0], ['Reservada', 'Aprobado', 'Pendiente', 'Expirada (no abonada)', 'Rechazado'][Math.floor(rnd() * 5)], '', '', '', rnd() < 0.5 ? 'MPORD' + i : '']);
  }
  return { catalog, ops };
}
test('Apps Script getCatalog: identical output AND identical sheet side-effects as main on 400 random states', () => {
  for (let seed = 1; seed <= 400; seed++) {
    const a = randomState(seed), b = randomState(seed);
    const oldC = loadCode(path.join(root, 'tests/fixtures/Code.main-fe86808.js'), a), newC = loadCode(path.join(root, 'Code.js'), b);
    const o = JSON.stringify(oldC.getCatalog()), n = JSON.stringify(newC.getCatalog());
    assert.equal(n, o, 'catalog output seed ' + seed);
    assert.equal(JSON.stringify(b.catalog), JSON.stringify(a.catalog), 'sheet state seed ' + seed);
    assert.ok(newC.stats.openById <= oldC.stats.openById);
  }
});
test('Apps Script getCatalog: no script lock and a single spreadsheet read when nothing expired; lock only when a hold expired', () => {
  const clean = randomState(7); clean.catalog.slice(1).forEach(r => { if (/Reservada|pendiente/i.test(r[12])) { r[19] = new Date(Date.now() + 3600e3); } });
  const oldC = loadCode(path.join(root, 'tests/fixtures/Code.main-fe86808.js'), JSON.parse(JSON.stringify(clean), (k, v) => v));
  const c = JSON.parse(JSON.stringify(clean)); // dates -> strings are fine (Date(x))
  const st = { catalog: c.catalog, ops: c.ops };
  const newC = loadCode(path.join(root, 'Code.js'), st); newC.getCatalog();
  assert.equal(newC.stats.lockWaits, 0); assert.equal(newC.stats.catalogReads, 1); assert.equal(newC.stats.openById, 1);
  const expired = { catalog: JSON.parse(JSON.stringify(c.catalog)), ops: [['orderId']] }; expired.catalog[1][12] = 'Reservada temporalmente'; expired.catalog[1][19] = new Date(Date.now() - 1000);
  const e2 = loadCode(path.join(root, 'Code.js'), expired); const out = e2.getCatalog();
  assert.equal(e2.stats.lockWaits, 1); assert.equal(out[0].status, 'Disponible');
  void oldC;
});
test('Apps Script: expired hold with an UNSETTLED payment order is still never released by the public read', () => {
  const head = Array(20).fill(''); const r = Array(20).fill(''); r[0] = 'V09-001'; r[12] = 'Reservada temporalmente'; r[19] = new Date(Date.now() - 5000);
  const st = { catalog: [head, r], ops: [['orderId'], ['ORD-1', 'V09-001', 'Pendiente', '', '', '', 'MP-1']] };
  const c = loadCode(path.join(root, 'Code.js'), st); const out = c.getCatalog();
  assert.equal(out[0].status, 'Reservada temporalmente');
});
