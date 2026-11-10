import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const STAGING_URL = 'https://script.google.com/macros/s/AKfycbx5YvudciPjG0OUmqSjOocMHxLMFZy2MTN9V3VrBb5FQP_VK1B7O3T3z8aiZP574K1E/exec';

// Read rotated secret from environment or local scratch file
function getRotatedSecret() {
  if (process.env.SHARED_SECRET) return process.env.SHARED_SECRET;
  try {
    const scratchPath = 'C:\\Users\\Administrator\\.gemini\\antigravity\\brain\\bda96913-4374-4e90-a76e-8efa6bb2d873\\scratch\\new_shared_secret.txt';
    if (fs.existsSync(scratchPath)) {
      return fs.readFileSync(scratchPath, 'utf8').trim();
    }
  } catch (e) {}
  return 'test-fallback-secret';
}

const SHARED_SECRET = getRotatedSecret();

test('Live Apps Script: Public catalog endpoint returns 62 experiences (GET, no secret)', async () => {
  const resp = await fetch(`${STAGING_URL}?format=json`);
  assert.equal(resp.status, 200);
  const data = await resp.json();
  assert.ok(Array.isArray(data));
  assert.equal(data.length, 62);
  assert.equal(data[0].id, 'V09-001');
});

test('Live Apps Script: Administrative actions in GET URL parameters are strictly forbidden', async () => {
  // Querying admin endpoints via GET URL parameters must fail closed
  const resp = await fetch(`${STAGING_URL}?action=adminStats&secret=${SHARED_SECRET}`);
  const data = await resp.json();
  assert.match(data.error, /forbidden: administrative and sensitive actions must use POST/i);
});

test('Live Apps Script: Administrative POST requires valid rotated secret', async () => {
  // 1. Unauthorized POST with wrong secret
  const unauthResp = await fetch(STAGING_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'adminStats', secret: 'bad-secret-xyz' })
  });
  const unauthData = await unauthResp.json();
  assert.equal(unauthData.error, 'unauthorized');

  // 2. Authorized POST with rotated secret
  const authResp = await fetch(STAGING_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'adminStats', secret: SHARED_SECRET })
  });
  assert.equal(authResp.status, 200);
  const stats = await authResp.json();
  assert.equal(stats.total, 62);
  assert.ok(stats.disponibles > 0);
});

test('Live Apps Script: Real atomic concurrency test on Google Sheet with LockService', async () => {
  const testExpId = 'V09-075';

  // Release test experience via secure POST before starting
  await fetch(STAGING_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'forceRelease', secret: SHARED_SECRET })
  });

  // Send 3 concurrent HTTP reservation requests simultaneously
  const results = await Promise.allSettled([
    fetch(`${STAGING_URL}?action=reserve&experienceId=${testExpId}`).then(r => r.json()),
    fetch(`${STAGING_URL}?action=reserve&experienceId=${testExpId}`).then(r => r.json()),
    fetch(`${STAGING_URL}?action=reserve&experienceId=${testExpId}`).then(r => r.json())
  ]);

  const successfulReservations = [];
  const rejectedReservations = [];

  for (const res of results) {
    assert.equal(res.status, 'fulfilled');
    const data = res.value;
    if (data.orderId) {
      successfulReservations.push(data);
    } else if (data.error && data.error.includes('no está disponible')) {
      rejectedReservations.push(data);
    }
  }

  // LockService on Google Apps Script MUST guarantee exactly ONE successful reservation
  assert.equal(successfulReservations.length, 1, 'Exactly one concurrent reservation must succeed');
  assert.equal(rejectedReservations.length, 2, 'Concurrent attempts must be rejected with unavailable message');

  const createdOrder = successfulReservations[0];
  assert.ok(createdOrder.orderId.startsWith(`ORD-${testExpId}-`));

  // Verify order can be read with rotated shared secret via secure POST
  const orderResp = await fetch(STAGING_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'order', orderId: createdOrder.orderId, secret: SHARED_SECRET })
  });
  const orderData = await orderResp.json();
  assert.equal(orderData.orderId, createdOrder.orderId);
  assert.equal(orderData.status, 'Reservada');

  // Reconcile order safely without deleting historical evidence via secure POST
  const reconcileResp = await fetch(STAGING_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'reconcileOrder',
      orderId: createdOrder.orderId,
      status: 'Expirada (no abonada)',
      note: 'Prueba de integración live concurrencia (POST seguro)',
      secret: SHARED_SECRET
    })
  });
  const reconcileData = await reconcileResp.json();
  assert.equal(reconcileData.ok, true);

  // Release experience back to Disponible via secure POST
  await fetch(STAGING_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'forceRelease', secret: SHARED_SECRET })
  });
});
