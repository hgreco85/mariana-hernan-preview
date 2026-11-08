const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With'
};

function corsResponse(body, status = 200, extra = {}) {
  return new Response(body, {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', ...extra }
  });
}

function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let c = 0;
  for (let i = 0; i < a.length; i++) {
    c |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return c === 0;
}

// Public read-only GET (no secrets transmitted in URL query parameters)
async function appsScriptGet(env, params) {
  const url = new URL(env.APPS_SCRIPT_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const resp = await fetch(url.toString());
  const text = await resp.text();
  let data = {};
  try { data = JSON.parse(text); } catch (e) {}
  return { status: resp.status, data, text };
}

// Secure server-to-server POST (secret transmitted exclusively in encrypted POST body over TLS)
async function appsScriptPost(env, payload) {
  const bodyPayload = {
    ...payload,
    secret: env.SHARED_SECRET
  };
  const resp = await fetch(env.APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bodyPayload)
  });
  const text = await resp.text();
  let data = {};
  try { data = JSON.parse(text); } catch (e) {}
  return { status: resp.status, data, text };
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }
    const url = new URL(request.url);

    // Health check
    if (request.method === 'GET' && (url.pathname === '/health' || url.pathname === '/api/health')) {
      return corsResponse(JSON.stringify({
        status: 'ok',
        service: 'wedding-mp-backend',
        mode: env.LIVE_MODE === 'true' ? 'production' : 'staging_test',
        apiMode: env.MP_API_MODE || 'orders',
        timestamp: new Date().toISOString()
      }), 200);
    }

    // Public catalog proxy (read-only, no secret)
    if (request.method === 'GET' && url.pathname === '/api/catalog') {
      const info = await appsScriptGet(env, { format: 'json' });
      return corsResponse(info.text, info.status);
    }

    // Create reservation and Mercado Pago order
    if (request.method === 'POST' && url.pathname === '/api/create-order') {
      let body;
      try { body = await request.json(); } catch (e) { body = {}; }
      const orderId = body.orderId;
      if (!orderId) return corsResponse(JSON.stringify({ error: 'missing orderId' }), 400);

      // Verify reservation from Apps Script via secure POST body
      const info = await appsScriptPost(env, { type: 'order', orderId });
      const order = info.data;
      if (!order || order.error) {
        return corsResponse(JSON.stringify({ error: 'reservation not found' }), 404);
      }
      if (!order.amount || Number(order.amount) <= 0) {
        return corsResponse(JSON.stringify({ error: 'invalid amount' }), 400);
      }

      const token = env.MP_ACCESS_TOKEN;
      if (!token || token === 'REPLACE_WITH_MP_ACCESS_TOKEN') {
        return corsResponse(JSON.stringify({
          error: 'MP_ACCESS_TOKEN not configured in Worker',
          needsHumanAction: 'Set MP_ACCESS_TOKEN secret in worker environment',
          orderId
        }), 503);
      }

      const amount = Number(order.amount).toFixed(2);
      const appReturnUrl = env.APP_URL || 'https://hgreco85.github.io/mariana-hernan-preview/';
      const notificationUrl = env.WORKER_WEBHOOK_URL
        ? env.WORKER_WEBHOOK_URL.replace(/\/$/, '') + '/webhook/mp'
        : undefined;

      // Mercado Pago Orders API (/v1/orders)
      const ordersPayload = {
        type: 'online',
        total_amount: amount,
        external_reference: orderId,
        processing_mode: 'manual',
        capture_mode: 'automatic_async',
        expiration_time: 'P1D',
        description: order.title || order.experienceId || orderId,
        config: {
          online: {
            success_url: `${appReturnUrl}?mp_status=approved&order=${encodeURIComponent(orderId)}`,
            pending_url: `${appReturnUrl}?mp_status=pending&order=${encodeURIComponent(orderId)}`,
            failure_url: `${appReturnUrl}?mp_status=failure&order=${encodeURIComponent(orderId)}`,
            auto_return: 'approved'
          },
          payment_method: { max_installments: 12 }
        },
        items: [{
          title: order.title || order.experienceId || orderId,
          description: order.experienceId || '',
          category_id: 'travel',
          quantity: 1,
          unit_price: amount,
          type: 'travel'
        }]
      };
      if (notificationUrl) ordersPayload.notification_url = notificationUrl;

      let resp = await fetch('https://api.mercadopago.com/v1/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token,
          'X-Idempotency-Key': orderId
        },
        body: JSON.stringify(ordersPayload)
      });

      let text = await resp.text();
      let json = {};
      try { json = JSON.parse(text); } catch (e) {}

      const ordersFailed = (resp.status < 200 || resp.status >= 300) || !json.checkout_url;
      const ordersApiDiagnostic = ordersFailed ? {
        status: resp.status,
        error: json.message || json.error || text
      } : null;

      // Strict Orders API mode (default for E2E): Fail immediately without fallback
      const apiMode = env.MP_API_MODE || 'orders';
      if (ordersFailed && apiMode === 'orders') {
        return corsResponse(JSON.stringify({
          error: 'Orders API request failed in strict mode (no fallback)',
          diagnostic: ordersApiDiagnostic,
          orderId
        }), 502);
      }

      // Explicit fallback to Preferences API only if configured in auto mode
      if (ordersFailed) {
        const prefPayload = {
          items: [{
            id: order.experienceId,
            title: order.title || order.experienceId,
            description: order.experienceId || '',
            quantity: 1,
            currency_id: 'ARS',
            unit_price: Number(amount)
          }],
          external_reference: orderId,
          back_urls: {
            success: `${appReturnUrl}?mp_status=approved&order=${encodeURIComponent(orderId)}`,
            pending: `${appReturnUrl}?mp_status=pending&order=${encodeURIComponent(orderId)}`,
            failure: `${appReturnUrl}?mp_status=failure&order=${encodeURIComponent(orderId)}`
          },
          auto_return: 'approved'
        };
        if (notificationUrl) prefPayload.notification_url = notificationUrl;

        resp = await fetch('https://api.mercadopago.com/checkout/preferences', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + token
          },
          body: JSON.stringify(prefPayload)
        });
        text = await resp.text();
        try { json = JSON.parse(text); } catch (e) {}
        if (json.init_point || json.sandbox_init_point) {
          const checkoutUrl = (env.LIVE_MODE === 'true' && json.init_point) ? json.init_point : (json.sandbox_init_point || json.init_point);
          await appsScriptPost(env, {
            type: 'mp_order_created',
            orderId,
            mpOrderId: json.id
          });
          return corsResponse(JSON.stringify({
            checkoutUrl,
            mpOrderId: json.id,
            orderId,
            apiUsed: 'preferences',
            ordersApiDiagnostic
          }));
        }
      }

      if (resp.status < 200 || resp.status >= 300) {
        return corsResponse(JSON.stringify({
          error: json.message || text,
          ordersApiDiagnostic
        }), resp.status);
      }

      await appsScriptPost(env, {
        type: 'mp_order_created',
        orderId,
        mpOrderId: json.id
      });
      return corsResponse(JSON.stringify({
        checkoutUrl: json.checkout_url,
        mpOrderId: json.id,
        orderId,
        apiUsed: 'orders'
      }));
    }

    // Check order status and reconcile with Mercado Pago
    if (request.method === 'GET' && url.pathname === '/api/order-status') {
      const orderId = url.searchParams.get('orderId');
      if (!orderId) return corsResponse(JSON.stringify({ error: 'missing orderId' }), 400);

      const info = await appsScriptPost(env, { type: 'order', orderId });
      const order = info.data;
      if (!order || order.error) return corsResponse(JSON.stringify({ error: 'not found' }), 404);

      if (order.mpOrderId) {
        const token = env.MP_ACCESS_TOKEN;
        if (token && token !== 'REPLACE_WITH_MP_ACCESS_TOKEN') {
          const resp = await fetch('https://api.mercadopago.com/v1/orders/' + encodeURIComponent(order.mpOrderId), {
            headers: { 'Authorization': 'Bearer ' + token }
          });
          if (resp.status === 200) {
            const o = await resp.json();
            let paymentStatus = o.status;
            let mpPaymentId = '';
            try {
              const payments = o.transactions && o.transactions.payments;
              if (payments && payments.length) {
                paymentStatus = payments[0].status || paymentStatus;
                mpPaymentId = payments[0].id || '';
              }
            } catch (e) {}
            await appsScriptPost(env, {
              type: 'confirm',
              orderId,
              status: paymentStatus,
              paymentId: mpPaymentId
            });
          }
        }
      }
      const info2 = await appsScriptPost(env, { type: 'order', orderId });
      return corsResponse(JSON.stringify({
        orderId,
        status: (info2.data && info2.data.status) || order.status,
        experienceId: order.experienceId,
        amount: order.amount,
        currency: order.currency
      }));
    }

    // Public dedication endpoint (securely forwarded to Apps Script)
    if (request.method === 'POST' && url.pathname === '/api/dedication') {
      let body;
      try { body = await request.json(); } catch (e) { body = {}; }
      const { orderId, guestName, dedication } = body;
      if (!orderId) return corsResponse(JSON.stringify({ error: 'missing orderId' }), 400);
      const info = await appsScriptPost(env, {
        type: 'saveDedication',
        orderId,
        guestName: guestName || '',
        dedication: dedication || ''
      });
      return corsResponse(info.text, info.status);
    }

    // Mercado Pago Webhook with HMAC-SHA256 verification (Fail-Closed)
    if (request.method === 'POST' && url.pathname === '/webhook/mp') {
      const secret = env.MP_WEBHOOK_SECRET;
      // Fail-closed: Webhook processing is strictly forbidden if MP_WEBHOOK_SECRET is unconfigured
      if (!secret || secret === 'REPLACE_WITH_MP_WEBHOOK_SECRET') {
        return corsResponse(JSON.stringify({
          error: 'Webhook endpoint unconfigured: MP_WEBHOOK_SECRET is required (fail-closed)'
        }), 500);
      }

      const sigHeader = request.headers.get('x-signature') || '';
      const reqId = request.headers.get('x-request-id') || '';
      const tsMatch = sigHeader.match(/ts=(\d+)/);
      const v1Match = sigHeader.match(/v1=([a-f0-9]+)/);

      if (!tsMatch || !v1Match || !reqId) {
        return new Response('missing signature headers', { status: 401, headers: CORS });
      }
      const ts = tsMatch[1];
      const v1 = v1Match[1];

      // Timestamp freshness: handle both second and millisecond timestamps
      const tsSec = Number(ts) > 1e11 ? Math.floor(Number(ts) / 1000) : Number(ts);
      const nowSec = Math.floor(Date.now() / 1000);
      if (Math.abs(nowSec - tsSec) > 300) {
        return new Response('stale timestamp', { status: 401, headers: CORS });
      }

      const raw = await request.text();
      let body = {};
      try { body = JSON.parse(raw); } catch (e) {}

      // Data ID can come from query param or body
      const dataId = url.searchParams.get('data.id') ||
                     url.searchParams.get('id') ||
                     (body && body.data && body.data.id ? String(body.data.id) : (body && body.id ? String(body.id) : ''));

      const manifest = `id:${dataId};request-id:${reqId};ts:${ts};`;
      const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );
      const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(manifest));
      const hex = [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');

      if (!constantTimeEqual(hex, v1)) {
        return new Response('invalid signature', { status: 401, headers: CORS });
      }

      // Extract payment ID
      const paymentId = url.searchParams.get('data.id') ||
                        url.searchParams.get('id') ||
                        (body && body.data && body.data.id) ||
                        body.id ||
                        null;

      const token = env.MP_ACCESS_TOKEN;
      let mpStatus = 'pending';
      let mpPaymentId = paymentId;
      let orderId = null;

      if (token && token !== 'REPLACE_WITH_MP_ACCESS_TOKEN' && paymentId) {
        const resp = await fetch('https://api.mercadopago.com/v1/payments/' + encodeURIComponent(paymentId), {
          headers: { 'Authorization': 'Bearer ' + token }
        });
        if (resp.status === 200) {
          const p = await resp.json();
          mpStatus = p.status || mpStatus;
          mpPaymentId = p.id || mpPaymentId;
          orderId = p.external_reference;
        }
      }

      if (orderId) {
        await appsScriptPost(env, {
          type: 'confirm',
          orderId,
          status: mpStatus,
          paymentId: mpPaymentId
        });
      }

      return new Response('ok', { status: 200, headers: CORS });
    }

    // Admin endpoints (authenticated via Bearer token matching SHARED_SECRET)
    if (url.pathname.startsWith('/api/admin/')) {
      const authHeader = request.headers.get('Authorization') || '';
      const token = authHeader.replace(/^Bearer\s+/i, '');
      if (!env.SHARED_SECRET || !constantTimeEqual(token, env.SHARED_SECRET)) {
        return corsResponse(JSON.stringify({ error: 'unauthorized' }), 401);
      }

      if (url.pathname === '/api/admin/ops') {
        const info = await appsScriptPost(env, { type: 'listOps' });
        return corsResponse(info.text, info.status);
      }

      if (url.pathname === '/api/admin/stats') {
        const info = await appsScriptPost(env, { type: 'adminStats' });
        return corsResponse(info.text, info.status);
      }

      if (url.pathname === '/api/admin/reconcile' && request.method === 'POST') {
        let body;
        try { body = await request.json(); } catch (e) { body = {}; }
        const { orderId, status, note } = body;
        const info = await appsScriptPost(env, {
          type: 'reconcileOrder',
          orderId,
          status,
          note: note || ''
        });
        return corsResponse(info.text, info.status);
      }
    }

    return new Response('not found', { status: 404, headers: CORS });
  }
};
