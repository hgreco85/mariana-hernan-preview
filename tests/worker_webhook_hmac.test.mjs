import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import worker, { resolveOrderStatus } from '../worker/src/index.js';

const SHARED_SECRET = 'test-shared-secret-123';
const MP_WEBHOOK_SECRET = 'mp-secret-test-xyz';

const mockEnv = {
  SHARED_SECRET,
  MP_WEBHOOK_SECRET,
  APPS_SCRIPT_URL: 'https://mock.script.google.com/exec',
  MP_ACCESS_TOKEN: 'TEST-mock-access-token',
  APP_URL: 'https://hgreco85.github.io/mariana-hernan-preview/'
};

function generateSignature(secret, dataId, reqId, ts) {
  const manifest = `id:${dataId};request-id:${reqId};ts:${ts};`;
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(manifest);
  const hash = hmac.digest('hex');
  return `ts=${ts},v1=${hash}`;
}

test('Webhook accepts valid HMAC-SHA256 signature with query param data.id', async () => {
  const dataId = '99887766';
  const reqId = 'req-uuid-12345';
  const ts = Math.floor(Date.now() / 1000);
  const sigHeader = generateSignature(MP_WEBHOOK_SECRET, dataId, reqId, ts);

  const req = new Request(`https://worker.test/webhook/mp?data.id=${dataId}&type=payment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-signature': sigHeader,
      'x-request-id': reqId
    },
    body: JSON.stringify({ action: 'payment.created' })
  });

  const res = await worker.fetch(req, mockEnv);
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.equal(text, 'ok');
});

test('Webhook accepts valid HMAC-SHA256 signature with millisecond timestamp', async () => {
  const dataId = '55443322';
  const reqId = 'req-uuid-ms';
  const ts = Date.now(); // milliseconds
  const sigHeader = generateSignature(MP_WEBHOOK_SECRET, dataId, reqId, ts);

  const req = new Request(`https://worker.test/webhook/mp?data.id=${dataId}&type=payment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-signature': sigHeader,
      'x-request-id': reqId
    },
    body: JSON.stringify({ action: 'payment.created' })
  });

  const res = await worker.fetch(req, mockEnv);
  assert.equal(res.status, 200);
});

test('Webhook rejects missing signature headers with 401', async () => {
  const req = new Request('https://worker.test/webhook/mp?data.id=123', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'payment.created' })
  });

  const res = await worker.fetch(req, mockEnv);
  assert.equal(res.status, 401);
  const text = await res.text();
  assert.match(text, /missing signature/);
});

test('Webhook rejects invalid/tampered signature with 401', async () => {
  const dataId = '99887766';
  const reqId = 'req-uuid-12345';
  const ts = Math.floor(Date.now() / 1000);
  const fakeSig = `ts=${ts},v1=0000000000000000000000000000000000000000000000000000000000000000`;

  const req = new Request(`https://worker.test/webhook/mp?data.id=${dataId}&type=payment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-signature': fakeSig,
      'x-request-id': reqId
    },
    body: JSON.stringify({ action: 'payment.created' })
  });

  const res = await worker.fetch(req, mockEnv);
  assert.equal(res.status, 401);
  const text = await res.text();
  assert.match(text, /invalid signature/);
});

test('Webhook rejects stale timestamp (> 300 seconds old) with 401', async () => {
  const dataId = '99887766';
  const reqId = 'req-uuid-12345';
  const staleTs = Math.floor(Date.now() / 1000) - 350; // 350 seconds ago
  const sigHeader = generateSignature(MP_WEBHOOK_SECRET, dataId, reqId, staleTs);

  const req = new Request(`https://worker.test/webhook/mp?data.id=${dataId}&type=payment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-signature': sigHeader,
      'x-request-id': reqId
    },
    body: JSON.stringify({ action: 'payment.created' })
  });

  const res = await worker.fetch(req, mockEnv);
  assert.equal(res.status, 401);
  const text = await res.text();
  assert.match(text, /stale timestamp/);
});

// Negative Fail-Closed tests
test('Fail-Closed: Webhook returns 500 when MP_WEBHOOK_SECRET is missing/undefined', async () => {
  const envWithoutSecret = { ...mockEnv, MP_WEBHOOK_SECRET: undefined };
  const req = new Request('https://worker.test/webhook/mp?data.id=123', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-signature': 'ts=12345,v1=abcdef',
      'x-request-id': 'req-1'
    },
    body: JSON.stringify({ action: 'payment.created' })
  });

  const res = await worker.fetch(req, envWithoutSecret);
  assert.equal(res.status, 500);
  const json = await res.json();
  assert.match(json.error, /fail-closed/i);
});

test('Fail-Closed: Webhook returns 500 when MP_WEBHOOK_SECRET is default placeholder', async () => {
  const envWithPlaceholder = { ...mockEnv, MP_WEBHOOK_SECRET: 'REPLACE_WITH_MP_WEBHOOK_SECRET' };
  const req = new Request('https://worker.test/webhook/mp?data.id=123', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-signature': 'ts=12345,v1=abcdef',
      'x-request-id': 'req-1'
    },
    body: JSON.stringify({ action: 'payment.created' })
  });

  const res = await worker.fetch(req, envWithPlaceholder);
  assert.equal(res.status, 500);
  const json = await res.json();
  assert.match(json.error, /fail-closed/i);
});

test('Fail-Closed: Webhook returns 500 when MP_WEBHOOK_SECRET is empty string', async () => {
  const envWithEmptySecret = { ...mockEnv, MP_WEBHOOK_SECRET: '' };
  const req = new Request('https://worker.test/webhook/mp?data.id=123', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-signature': 'ts=12345,v1=abcdef',
      'x-request-id': 'req-1'
    },
    body: JSON.stringify({ action: 'payment.created' })
  });

  const res = await worker.fetch(req, envWithEmptySecret);
  assert.equal(res.status, 500);
  const json = await res.json();
  assert.match(json.error, /fail-closed/i);
});

test('Webhook rejects missing x-request-id header with 401', async () => {
  const ts = Math.floor(Date.now() / 1000);
  const sigHeader = generateSignature(MP_WEBHOOK_SECRET, '123', 'some-req', ts);
  const req = new Request('https://worker.test/webhook/mp?data.id=123', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-signature': sigHeader
      // Missing x-request-id
    },
    body: JSON.stringify({ action: 'payment.created' })
  });

  const res = await worker.fetch(req, mockEnv);
  assert.equal(res.status, 401);
  const text = await res.text();
  assert.match(text, /missing signature headers/);
});

test('Orders API Strict Mode: Fails immediately with 502 without fallback to Preferences', async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const urlStr = String(url);
    // Mock Apps Script POST for reservation check
    if (urlStr.includes('mock.script.google.com')) {
      return new Response(JSON.stringify({
        orderId: 'ORD-TEST-001',
        amount: 50000,
        experienceId: 'V09-001'
      }), { status: 200 });
    }
    // Mock MP /v1/orders returning 400 error
    if (urlStr.includes('/v1/orders')) {
      return new Response(JSON.stringify({
        message: 'Invalid merchant account configuration',
        error: 'bad_request',
        status: 400
      }), { status: 400 });
    }
    // If it attempts /checkout/preferences, fail the test!
    if (urlStr.includes('/checkout/preferences')) {
      throw new Error('Strict mode must never fall back to Preferences API!');
    }
    return new Response('{}', { status: 200 });
  };

  try {
    const strictEnv = {
      ...mockEnv,
      MP_API_MODE: 'orders',
      MP_ACCESS_TOKEN: 'TEST-mock-token'
    };
    const req = new Request('https://worker.test/api/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: 'ORD-TEST-001' })
    });

    const res = await worker.fetch(req, strictEnv);
    assert.equal(res.status, 502);
    const json = await res.json();
    assert.match(json.error, /strict mode \(no fallback\)/i);
    assert.equal(json.diagnostic.status, 400);
    assert.match(json.diagnostic.error, /Invalid merchant account configuration/);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('Public Dedication: Guest can submit dedication without client secret', async () => {
  const origFetch = globalThis.fetch;
  let forwardedPayload = null;

  globalThis.fetch = async (url, opts) => {
    forwardedPayload = JSON.parse(opts.body);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  try {
    const req = new Request('https://worker.test/api/dedication', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: 'ORD-TEST-APPROVED',
        guestName: 'Tía Marta',
        dedication: '¡Felicidades chicos!'
      })
    });

    const res = await worker.fetch(req, mockEnv);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.ok, true);
    // Worker securely attached the SHARED_SECRET to Apps Script payload
    assert.equal(forwardedPayload.secret, mockEnv.SHARED_SECRET);
    assert.equal(forwardedPayload.type, 'saveDedication');
    assert.equal(forwardedPayload.guestName, 'Tía Marta');
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('Webhook processes "Order (Mercado Pago)" Checkout Pro event (type: order)', async () => {
  const origFetch = globalThis.fetch;
  const mpOrderId = 'order-mp-998877';
  const reqId = 'req-order-test-1';
  const ts = Math.floor(Date.now() / 1000);
  const sigHeader = generateSignature(MP_WEBHOOK_SECRET, mpOrderId, reqId, ts);

  let mpOrderFetched = false;
  let appsScriptConfirmedPayload = null;

  globalThis.fetch = async (url, opts) => {
    const urlStr = String(url);
    if (urlStr.includes('/v1/orders/' + mpOrderId)) {
      mpOrderFetched = true;
      assert.equal(opts.headers['Authorization'], 'Bearer ' + mockEnv.MP_ACCESS_TOKEN);
      return new Response(JSON.stringify({
        id: mpOrderId,
        status: 'closed',
        external_reference: 'ORD-TEST-ORDER-API-1',
        transactions: {
          payments: [
            {
              id: 'pay-mp-554433',
              status: 'approved',
              transaction_amount: 120000
            }
          ]
        }
      }), { status: 200 });
    }
    if (urlStr.includes('mock.script.google.com')) {
      appsScriptConfirmedPayload = JSON.parse(opts.body);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    throw new Error('Unexpected fetch call: ' + urlStr);
  };

  try {
    const req = new Request('https://worker.test/webhook/mp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-signature': sigHeader,
        'x-request-id': reqId
      },
      body: JSON.stringify({
        action: 'order.updated',
        api_version: 'v1',
        data: { id: mpOrderId },
        type: 'order'
      })
    });

    const res = await worker.fetch(req, mockEnv);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.equal(text, 'ok');

    assert.equal(mpOrderFetched, true, 'Worker must query /v1/orders/{id}');
    assert.ok(appsScriptConfirmedPayload, 'Worker must forward confirmation to Apps Script');
    assert.equal(appsScriptConfirmedPayload.type, 'confirm');
    assert.equal(appsScriptConfirmedPayload.orderId, 'ORD-TEST-ORDER-API-1');
    assert.equal(appsScriptConfirmedPayload.status, 'approved');
    assert.equal(appsScriptConfirmedPayload.paymentId, 'pay-mp-554433');
    assert.equal(appsScriptConfirmedPayload.secret, mockEnv.SHARED_SECRET);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('Webhook processes "merchant_order" IPN notification', async () => {
  const origFetch = globalThis.fetch;
  const merchantOrderId = 'mo-776655';
  const reqId = 'req-mo-test-1';
  const ts = Math.floor(Date.now() / 1000);
  const sigHeader = generateSignature(MP_WEBHOOK_SECRET, merchantOrderId, reqId, ts);

  let moFetched = false;
  let appsScriptConfirmedPayload = null;

  globalThis.fetch = async (url, opts) => {
    const urlStr = String(url);
    if (urlStr.includes('/merchant_orders/' + merchantOrderId)) {
      moFetched = true;
      return new Response(JSON.stringify({
        id: merchantOrderId,
        order_status: 'paid',
        external_reference: 'ORD-TEST-MO-1',
        payments: [{ id: 'pay-mo-1122', status: 'approved' }]
      }), { status: 200 });
    }
    if (urlStr.includes('mock.script.google.com')) {
      appsScriptConfirmedPayload = JSON.parse(opts.body);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    throw new Error('Unexpected fetch call: ' + urlStr);
  };

  try {
    const req = new Request(`https://worker.test/webhook/mp?topic=merchant_order&id=${merchantOrderId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-signature': sigHeader,
        'x-request-id': reqId
      },
      body: JSON.stringify({ resource: `https://api.mercadopago.com/merchant_orders/${merchantOrderId}`, topic: 'merchant_order' })
    });

    const res = await worker.fetch(req, mockEnv);
    assert.equal(res.status, 200);
    assert.equal(moFetched, true);
    assert.ok(appsScriptConfirmedPayload);
    assert.equal(appsScriptConfirmedPayload.orderId, 'ORD-TEST-MO-1');
    assert.equal(appsScriptConfirmedPayload.status, 'approved');
    assert.equal(appsScriptConfirmedPayload.paymentId, 'pay-mo-1122');
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('Webhook processes "payment" notification (v1/payments fallback/direct)', async () => {
  const origFetch = globalThis.fetch;
  const paymentId = 'pay-998811';
  const reqId = 'req-pay-test-1';
  const ts = Math.floor(Date.now() / 1000);
  const sigHeader = generateSignature(MP_WEBHOOK_SECRET, paymentId, reqId, ts);

  let paymentFetched = false;
  let appsScriptConfirmedPayload = null;

  globalThis.fetch = async (url, opts) => {
    const urlStr = String(url);
    if (urlStr.includes('/v1/payments/' + paymentId)) {
      paymentFetched = true;
      return new Response(JSON.stringify({
        id: paymentId,
        status: 'approved',
        external_reference: 'ORD-TEST-PAY-1'
      }), { status: 200 });
    }
    if (urlStr.includes('mock.script.google.com')) {
      appsScriptConfirmedPayload = JSON.parse(opts.body);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    throw new Error('Unexpected fetch call: ' + urlStr);
  };

  try {
    const req = new Request('https://worker.test/webhook/mp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-signature': sigHeader,
        'x-request-id': reqId
      },
      body: JSON.stringify({
        action: 'payment.updated',
        data: { id: paymentId },
        type: 'payment'
      })
    });

    const res = await worker.fetch(req, mockEnv);
    assert.equal(res.status, 200);
    assert.equal(paymentFetched, true);
    assert.ok(appsScriptConfirmedPayload);
    assert.equal(appsScriptConfirmedPayload.orderId, 'ORD-TEST-PAY-1');
    assert.equal(appsScriptConfirmedPayload.status, 'approved');
    assert.equal(appsScriptConfirmedPayload.paymentId, paymentId);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('Security & Negative Tests: resolveOrderStatus handles all official Orders API terminal states', () => {
  // 1. Never assume closed = approved: closed order without accredited payment is cancelled
  const closedNoPayment = resolveOrderStatus({ status: 'closed', transactions: { payments: [] } });
  assert.equal(closedNoPayment.status, 'cancelled');
  assert.equal(closedNoPayment.paymentId, '');

  // 2. Canceled / expired orders
  const canceledOrder = resolveOrderStatus({ status: 'canceled', transactions: { payments: [] } });
  assert.equal(canceledOrder.status, 'cancelled');

  const expiredOrder = resolveOrderStatus({ status: 'expired', transactions: { payments: [] } });
  assert.equal(expiredOrder.status, 'cancelled');

  // 3. Action required is pending
  const actionRequired = resolveOrderStatus({ status: 'action_required', transactions: { payments: [] } });
  assert.equal(actionRequired.status, 'pending');

  // 4. Rejected / failed payment inside transactions
  const rejectedPayment = resolveOrderStatus({
    status: 'failed',
    transactions: {
      payments: [{ id: 'pay-fail-1', status: 'rejected', status_detail: 'high_risk' }]
    }
  });
  assert.equal(rejectedPayment.status, 'rejected');
  assert.equal(rejectedPayment.paymentId, 'pay-fail-1');

  // 5. Pending payment inside transactions
  const pendingPayment = resolveOrderStatus({
    status: 'action_required',
    transactions: {
      payments: [{ id: 'pay-pend-1', status: 'pending', status_detail: 'waiting_payment' }]
    }
  });
  assert.equal(pendingPayment.status, 'pending');
  assert.equal(pendingPayment.paymentId, 'pay-pend-1');

  // 6. Accredited payment is verified as approved
  const accreditedPayment = resolveOrderStatus({
    status: 'processed',
    transactions: {
      payments: [{ id: 'pay-acc-1', status: 'processed', status_detail: 'accredited' }]
    }
  });
  assert.equal(accreditedPayment.status, 'approved');
  assert.equal(accreditedPayment.paymentId, 'pay-acc-1');

  // 7. Legacy approved status
  const legacyApproved = resolveOrderStatus({
    status: 'closed',
    transactions: {
      payments: [{ id: 'pay-leg-1', status: 'approved' }]
    }
  });
  assert.equal(legacyApproved.status, 'approved');
  assert.equal(legacyApproved.paymentId, 'pay-leg-1');
});

test('Security & Negative Tests: Webhook never marks closed order without payment as approved', async () => {
  const origFetch = globalThis.fetch;
  const orderId = 'ORDTST-CLOSED-ORDER';
  const reqId = 'req-closed-test';
  const ts = Math.floor(Date.now() / 1000);
  const sigHeader = generateSignature(MP_WEBHOOK_SECRET, orderId, reqId, ts);

  let appsScriptConfirmedPayload = null;

  globalThis.fetch = async (url, opts) => {
    const urlStr = String(url);
    if (urlStr.includes('/v1/orders/' + orderId)) {
      return new Response(JSON.stringify({
        id: orderId,
        status: 'closed',
        external_reference: 'ORD-V09-001-CLOSED',
        transactions: { payments: [] }
      }), { status: 200 });
    }
    if (urlStr.includes('mock.script.google.com')) {
      appsScriptConfirmedPayload = JSON.parse(opts.body);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    throw new Error('Unexpected fetch call: ' + urlStr);
  };

  try {
    const req = new Request('https://worker.test/webhook/mp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-signature': sigHeader,
        'x-request-id': reqId
      },
      body: JSON.stringify({
        action: 'order.updated',
        data: { id: orderId },
        type: 'order'
      })
    });

    const res = await worker.fetch(req, mockEnv);
    assert.equal(res.status, 200);
    assert.ok(appsScriptConfirmedPayload);
    assert.equal(appsScriptConfirmedPayload.orderId, 'ORD-V09-001-CLOSED');
    assert.notEqual(appsScriptConfirmedPayload.status, 'approved');
    assert.equal(appsScriptConfirmedPayload.status, 'cancelled');
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('Security & Negative Tests: Webhook marks rejected payment as rejected', async () => {
  const origFetch = globalThis.fetch;
  const orderId = 'ORDTST-REJECTED-ORDER';
  const reqId = 'req-rejected-test';
  const ts = Math.floor(Date.now() / 1000);
  const sigHeader = generateSignature(MP_WEBHOOK_SECRET, orderId, reqId, ts);

  let appsScriptConfirmedPayload = null;

  globalThis.fetch = async (url, opts) => {
    const urlStr = String(url);
    if (urlStr.includes('/v1/orders/' + orderId)) {
      return new Response(JSON.stringify({
        id: orderId,
        status: 'failed',
        external_reference: 'ORD-V09-001-REJECTED',
        transactions: {
          payments: [{ id: 'pay-rejected-1', status: 'rejected', status_detail: 'cc_rejected_insufficient_amount' }]
        }
      }), { status: 200 });
    }
    if (urlStr.includes('mock.script.google.com')) {
      appsScriptConfirmedPayload = JSON.parse(opts.body);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    throw new Error('Unexpected fetch call: ' + urlStr);
  };

  try {
    const req = new Request('https://worker.test/webhook/mp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-signature': sigHeader,
        'x-request-id': reqId
      },
      body: JSON.stringify({
        action: 'order.updated',
        data: { id: orderId },
        type: 'order'
      })
    });

    const res = await worker.fetch(req, mockEnv);
    assert.equal(res.status, 200);
    assert.ok(appsScriptConfirmedPayload);
    assert.equal(appsScriptConfirmedPayload.orderId, 'ORD-V09-001-REJECTED');
    assert.equal(appsScriptConfirmedPayload.status, 'rejected');
    assert.equal(appsScriptConfirmedPayload.paymentId, 'pay-rejected-1');
  } finally {
    globalThis.fetch = origFetch;
  }
});
