import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import worker, { createCheckoutPreference, reconcileExpiredReservations } from '../worker/src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

test('createCheckoutPreference sends full experience title, description, external_reference, ARS 10000.00, and PT30M expiration', async () => {
  let capturedUrl = '';
  let capturedOptions = null;

  const mockFetch = async (url, options) => {
    capturedUrl = url;
    capturedOptions = options;
    return new Response(
      JSON.stringify({
        id: 'ORD01TESTTITLE0001',
        status: 'action_required',
        external_reference: 'ORD-V09-081-1794345000000',
        total_amount: '10000.00',
        items: [
          {
            title: 'Brunch junto a la Grand-Place',
            unit_price: '10000.00',
            quantity: 1,
            description: 'Brunch junto a la Grand-Place (V09-081)',
          },
        ],
        type_response: {
          ticket_url: 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=test-title-1',
        },
      }),
      { status: 201, headers: { 'Content-Type': 'application/json' } }
    );
  };

  const env = { MP_ACCESS_TOKEN: 'TEST-TOKEN-123' };
  const result = await createCheckoutPreference(
    {
      orderId: 'ORD-V09-081-1794345000000',
      experienceId: 'V09-081',
      title: 'Brunch junto a la Grand-Place',
      amountArs: 10000,
    },
    env,
    mockFetch
  );

  assert.equal(capturedUrl, 'https://api.mercadopago.com/v1/orders');
  const body = JSON.parse(capturedOptions.body);
  assert.equal(body.external_reference, 'ORD-V09-081-1794345000000');
  assert.equal(body.total_amount, '10000.00');
  assert.equal(body.expiration_time, 'PT30M');
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].title, 'Brunch junto a la Grand-Place');
  assert.equal(body.items[0].description, 'Brunch junto a la Grand-Place (V09-081)');
  assert.equal(body.items[0].unit_price, '10000.00');
  assert.equal(body.items[0].quantity, 1);
  assert.equal(result.preferenceId, 'ORD01TESTTITLE0001');
  assert.equal(result.title, 'Brunch junto a la Grand-Place');
  assert.equal(result.expirationTime, 'PT30M');
});

test('reconcileExpiredReservations cancels abandoned created MP order and releases reservation', async () => {
  const mpCalls = [];
  const gasCalls = [];

  const mockFetch = async (url, options = {}) => {
    mpCalls.push({ url, method: options.method || 'GET', headers: options.headers || {} });
    if (url.endsWith('/v1/orders/ORD01ABANDONED123')) {
      return new Response(
        JSON.stringify({
          id: 'ORD01ABANDONED123',
          status: 'created',
          external_reference: 'ORD-V09-081-1794342810215',
          transactions: {},
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (url.endsWith('/v1/orders/ORD01ABANDONED123/cancel')) {
      return new Response(
        JSON.stringify({
          id: 'ORD01ABANDONED123',
          status: 'canceled',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    throw new Error('Unexpected MP URL: ' + url);
  };

  const mockPostToAppsScript = async (env, payload) => {
    gasCalls.push(payload);
    if (payload.action === 'getExpiredOrders') {
      return {
        ok: true,
        reservationMinutes: 15,
        expiredOrders: [
          {
            orderId: 'ORD-V09-081-1794342810215',
            experienceId: 'V09-081',
            mpPreferenceId: 'ORD01ABANDONED123',
          },
        ],
      };
    }
    if (payload.action === 'reconcileOrder') {
      return { ok: true, status: 'Cancelado', released: true };
    }
    throw new Error('Unexpected GAS action: ' + payload.action);
  };

  const env = {
    MP_ACCESS_TOKEN: 'TEST-TOKEN',
    SHARED_SECRET: 'SHARED-123',
    APPS_SCRIPT_URL: 'https://script.google.com/macros/s/test/exec',
  };

  const res = await reconcileExpiredReservations(env, {
    fetchImpl: mockFetch,
    postToAppsScriptImpl: mockPostToAppsScript,
  });

  assert.equal(res.ok, true);
  assert.equal(res.checked, 1);
  assert.equal(res.results.length, 1);
  assert.equal(res.results[0].orderId, 'ORD-V09-081-1794342810215');
  assert.equal(res.results[0].canceledInMp, true);
  assert.equal(res.results[0].mpStatus, 'canceled');

  const cancelCall = mpCalls.find((c) => c.url.endsWith('/cancel'));
  assert.ok(cancelCall, 'Expected POST /v1/orders/:id/cancel to be called');
  assert.equal(cancelCall.method, 'POST');
  assert.ok(cancelCall.headers['X-Idempotency-Key'], 'Expected X-Idempotency-Key on cancel request');

  const reconcileCall = gasCalls.find((c) => c.action === 'reconcileOrder');
  assert.ok(reconcileCall, 'Expected reconcileOrder to be called');
  assert.equal(reconcileCall.mpStatus, 'cancelled');
});

test('reconcileExpiredReservations NEVER cancels or releases if MP order has pending/in_process/approved payment', async () => {
  const mpCalls = [];
  const gasCalls = [];

  const mockFetch = async (url, options = {}) => {
    mpCalls.push({ url, method: options.method || 'GET' });
    if (url.endsWith('/v1/orders/ORD01PENDINGPAY')) {
      return new Response(
        JSON.stringify({
          id: 'ORD01PENDINGPAY',
          status: 'processing',
          external_reference: 'ORD-V09-081-9999',
          transactions: {
            payments: [
              {
                id: 'PAY999888777',
                status: 'in_process',
                status_detail: 'pending_review_manual',
                amount: '10000.00',
              },
            ],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    throw new Error('Unexpected MP URL: ' + url);
  };

  const mockPostToAppsScript = async (env, payload) => {
    gasCalls.push(payload);
    if (payload.action === 'getExpiredOrders') {
      return {
        ok: true,
        reservationMinutes: 15,
        expiredOrders: [
          {
            orderId: 'ORD-V09-081-9999',
            experienceId: 'V09-081',
            mpPreferenceId: 'ORD01PENDINGPAY',
          },
        ],
      };
    }
    return { ok: true };
  };

  const env = {
    MP_ACCESS_TOKEN: 'TEST-TOKEN',
    SHARED_SECRET: 'SHARED-123',
    APPS_SCRIPT_URL: 'https://script.google.com/macros/s/test/exec',
  };

  const res = await reconcileExpiredReservations(env, {
    fetchImpl: mockFetch,
    postToAppsScriptImpl: mockPostToAppsScript,
  });

  assert.equal(res.ok, true);
  assert.equal(res.results[0].preserved, true);
  assert.equal(res.results[0].paymentStatus, 'in_process');
  const cancelCall = mpCalls.find((c) => c.url.endsWith('/cancel'));
  assert.equal(cancelCall, undefined, 'Must NOT cancel an order with an active/pending payment');
  const reconcileCall = gasCalls.find((c) => c.action === 'reconcileOrder');
  assert.equal(reconcileCall, undefined, 'Must NOT release an order with an active/pending payment without webhook/payment confirmation');
});

test('index.html has production APPS_SCRIPT_URL, 5-stage UX messages in ES/PT, no PREVIEW stubs, and backend-verified showPayOverlay', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');

  assert.ok(
    html.includes('AKfycbyRqR87jjH05vaDS_5UL8G9CkFfChGE2P8FqhwvFn2HVyjqdTdbl0T1Ts41sfnILHv1/exec'),
    'index.html must point APPS_SCRIPT_URL to production deployment'
  );
  assert.ok(
    !html.includes('AKfycbx5YvudciPjG0OUmqSjOocMHxLMFZy2MTN9V3VrBb5FQP_VK1B7O3T3z8aiZP574K1E'),
    'index.html must not point to staging Apps Script URL'
  );
  assert.ok(!html.includes('/*PREVIEW*/'), 'index.html must not contain residual /*PREVIEW*/ stubs');

  // Verify 5 stages exist in ES & PT
  for (const key of ['step1:', 'step2:', 'step3:', 'step4:', 'step5:', 'ttlNotice:']) {
    const matches = html.split(key).length - 1;
    assert.ok(matches >= 2, `Expected ${key} in both ES and PT translations (found ${matches})`);
  }

  // Verify showPayOverlay calls api.getOrderStatus(order) and checks backend status
  assert.ok(html.includes('api.getOrderStatus(order)'), 'showPayOverlay must poll api.getOrderStatus(order)');
  assert.ok(html.includes('window.__checkoutMetrics'), 'giftExperience must record per-stage checkout latency metrics');
});
