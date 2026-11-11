import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../index.html');
const html = readFileSync(file, 'utf8');

test('gifted state comes from live canonical catalog after initial static snapshot', () => {
  assert.match(html, /function refreshGiftStatuses\(\)/);
  assert.match(html, /fetch\(WORKER_URL\+'\/api\/catalog',\{cache:'no-store'\}\)/);
  assert.match(html, /function start\(rows\)[\s\S]*?refreshGiftStatuses\(\);\}/);
  assert.match(html, /if\(!r\.ok\)throw new Error\('catalog unavailable'\)/);
  assert.match(html, /if\(!current\|\|typeof current\.status!=='string'\)return/);
});

test('live gifted status is refreshed on return from payment and page reactivation', () => {
  assert.match(html, /if\(ded\) ded\.style\.display='block';\s*refreshGiftStatuses\(\);/);
  assert.match(html, /function closePayOverlay\(\)[^}]+refreshGiftStatuses\(\)/);
  assert.match(html, /document\.addEventListener\('visibilitychange'/);
  assert.match(html, /window\.addEventListener\('focus'/);
});

test('ES and PT gifted copy matches honeymoon trip language', () => {
  assert.ok(html.includes('Esta experiencia ya forma parte de nuestro viaje'));
  assert.ok(html.includes('Esta experiência já faz parte da nossa viagem'));
});

test('no direct payment approval from URL or HTML catalog', () => {
  assert.match(html, /api\.getOrderStatus\(order\)/);
  assert.match(html, /if\(low\.includes\('aprob'\)/);
  assert.match(html, /if\(giftStatusRefresh\) return giftStatusRefresh/);
});
