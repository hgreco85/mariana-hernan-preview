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

// Checkout Pro preference used by the non-strict fallback and by the local sandbox smoke test.
// sandboxOnly refuses live mode and non-TEST tokens before any network call, and omits
// notification_url so a smoke preference is not subscribed to a deployed webhook.
export async function createCheckoutPreference(arg1, arg2, arg3) {
  // Flexible signature: supports both (env, order, deps) and (order, env, deps/fetch).
  let env, order, deps = {};
  if (arg1 && typeof arg1 === 'object' && (arg1.orderId || arg1.experienceId || arg1.amountArs !== undefined || arg1.amount !== undefined)) {
    order = arg1;
    env = arg2 || {};
    deps = typeof arg3 === 'function' ? { fetchImpl: arg3 } : (arg3 || {});
  } else {
    env = arg1 || {};
    order = arg2 || {};
    deps = typeof arg3 === 'function' ? { fetchImpl: arg3 } : (arg3 || {});
  }

  const fetchImpl = deps.fetchImpl || fetch;
  const token = env && env.MP_ACCESS_TOKEN;
  const sandboxOnly = deps.sandboxOnly === true;

  if (sandboxOnly) {
    if (!env || env.LIVE_MODE === 'true') {
      return { ok: false, status: 403, json: {}, text: '', checkoutUrl: null, preferenceId: null, reason: 'live_mode' };
    }
    const webhook = env.MP_WEBHOOK_SECRET;
    if (!webhook || webhook === 'REPLACE_WITH_MP_WEBHOOK_SECRET') {
      return { ok: false, status: 500, json: {}, text: '', checkoutUrl: null, preferenceId: null, reason: 'webhook_missing' };
    }
    if (typeof token !== 'string' || !token.startsWith('TEST-')) {
      return { ok: false, status: 403, json: {}, text: '', checkoutUrl: null, preferenceId: null, reason: 'not_sandbox_token' };
    }
  }

  if (!token || token === 'REPLACE_WITH_MP_ACCESS_TOKEN') {
    return {
      ok: false,
      status: 503,
      json: { message: 'MP_ACCESS_TOKEN not configured' },
      text: '',
      checkoutUrl: null,
      preferenceId: null,
      reason: 'token_missing'
    };
  }

  const orderId = order.orderId;
  const experienceId = order.experienceId;
  const appReturnUrl = env.APP_URL || 'https://hgreco85.github.io/mariana-hernan-preview/';
  const notificationUrl = !sandboxOnly && env.WORKER_WEBHOOK_URL
    ? env.WORKER_WEBHOOK_URL.replace(/\/$/, '') + '/webhook/mp'
    : undefined;

  const itemTitle = order.title || order.experienceId || 'Regalo de casamiento';
  const itemDescription = order.title ? `${order.title} (${order.experienceId})` : (order.experienceId || '');
  const amount = Number(order.amountArs !== undefined ? order.amountArs : (order.amount || 0));

  // Sandbox smoke path: keep legacy Checkout Pro preferences.
  if (sandboxOnly) {
    const prefPayload = {
      items: [{
        id: experienceId,
        title: itemTitle,
        description: itemDescription,
        quantity: 1,
        currency_id: 'ARS',
        unit_price: amount
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

    const resp = await fetchImpl('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify(prefPayload),
      redirect: 'manual'
    });
    const text = await resp.text();
    let json = {};
    try { json = JSON.parse(text); } catch (e) {}
    const checkoutUrl = (env.LIVE_MODE === 'true' && json.init_point)
      ? json.init_point
      : (json.sandbox_init_point || json.init_point || null);
    const preferenceId = json.id === undefined || json.id === null ? null : String(json.id);
    const ok = resp.status >= 200 && resp.status < 300 && Boolean(json.init_point || json.sandbox_init_point);
    return {
      ok,
      status: resp.status,
      json,
      text,
      checkoutUrl,
      preferenceId,
      title: itemTitle,
      reason: ok ? 'ok' : 'preference_failed'
    };
  }

  // Orders API path (primary for production and E2E)
  const expirationTime = 'PT30M';
  const ordersPayload = {
    type: 'online',
    total_amount: amount.toFixed(2),
    external_reference: orderId,
    processing_mode: 'manual',
    capture_mode: 'automatic_async',
    expiration_time: expirationTime,
    description: itemTitle,
    items: [{
      title: itemTitle,
      description: itemDescription,
      category_id: 'travel',
      quantity: 1,
      unit_price: amount.toFixed(2),
      type: 'travel'
    }]
  };

  const resp = await fetchImpl('https://api.mercadopago.com/v1/orders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token
    },
    body: JSON.stringify(ordersPayload),
    redirect: 'manual'
  });
  const text = await resp.text();
  let json = {};
  try { json = JSON.parse(text); } catch (e) {}
  const checkoutUrl = json.checkout_url || (json.type_response && json.type_response.ticket_url) || json.ticket_url || json.init_point || null;
  const preferenceId = json.id === undefined || json.id === null ? null : String(json.id);
  const ok = resp.status >= 200 && resp.status < 300 && Boolean(preferenceId);
  if (ok) {
    return {
      ok,
      status: resp.status,
      json,
      text,
      checkoutUrl,
      preferenceId,
      title: itemTitle,
      expirationTime,
      reason: 'ok'
    };
  }

  // Fallback to Checkout Pro preferences outside strict orders mode
  if (env.MP_API_MODE && env.MP_API_MODE !== 'auto') {
    return { ok, status: resp.status, json, text, checkoutUrl: null, preferenceId, title: itemTitle, expirationTime, reason: 'orders_failed' };
  }

  const prefPayload = {
    items: [{
      id: experienceId,
      title: itemTitle,
      description: itemDescription,
      quantity: 1,
      currency_id: 'ARS',
      unit_price: amount
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

  const prefResp = await fetchImpl('https://api.mercadopago.com/checkout/preferences', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token
    },
    body: JSON.stringify(prefPayload),
    redirect: 'manual'
  });
  const prefText = await prefResp.text();
  let prefJson = {};
  try { prefJson = JSON.parse(prefText); } catch (e) {}
  const prefCheckoutUrl = (env.LIVE_MODE === 'true' && prefJson.init_point)
    ? prefJson.init_point
    : (prefJson.sandbox_init_point || prefJson.init_point || null);
  const prefId = prefJson.id === undefined || prefJson.id === null ? null : String(prefJson.id);
  const prefOk = prefResp.status >= 200 && prefResp.status < 300 && Boolean(prefJson.init_point || prefJson.sandbox_init_point);
  return {
    ok: prefOk,
    status: prefResp.status,
    json: prefJson,
    text: prefText,
    checkoutUrl: prefCheckoutUrl,
    preferenceId: prefId,
    title: itemTitle,
    expirationTime,
    reason: prefOk ? 'ok' : 'preference_failed'
  };
}

// Securely resolve Mercado Pago Orders API status
// Only an accredited payment (approved, or processed with accredited detail) can be confirmed as approved.
// A closed, canceled, or failed order without an accredited payment is NEVER approved.
export function resolveOrderStatus(o) {
  const payments = (o && o.transactions && Array.isArray(o.transactions.payments)) ? o.transactions.payments : [];
  const approvedPayment = payments.find(p => 
    p.status === 'approved' || 
    (p.status === 'processed' && p.status_detail === 'accredited')
  );

  if (approvedPayment) {
    return {
      status: 'approved',
      paymentId: String(approvedPayment.id || '')
    };
  }

  if (payments.length > 0) {
    const last = payments[payments.length - 1];
    const pStatus = String(last.status || '').toLowerCase();
    if (pStatus === 'rejected' || pStatus === 'cancelled' || pStatus === 'failed') {
      return { status: 'rejected', paymentId: String(last.id || '') };
    }
    if (pStatus === 'pending' || pStatus === 'in_process' || pStatus === 'authorized') {
      return { status: 'pending', paymentId: String(last.id || '') };
    }
    if (pStatus === 'refunded' || pStatus === 'charged_back') {
      return { status: pStatus, paymentId: String(last.id || '') };
    }
    return { status: pStatus || 'pending', paymentId: String(last.id || '') };
  }

  const oStatus = String((o && o.status) || '').toLowerCase();
  if (oStatus === 'canceled' || oStatus === 'expired' || oStatus === 'failed' || oStatus === 'closed') {
    return { status: 'cancelled', paymentId: '' };
  }
  if (oStatus === 'action_required') {
    return { status: 'pending', paymentId: '' };
  }
  if (oStatus === 'processed') {
    const oDetail = String((o && o.status_detail) || '').toLowerCase();
    // The order status alone cannot prove funds were credited. Require payment evidence.
    return { status: 'pending', paymentId: '' };
  }

  return { status: oStatus || 'pending', paymentId: '' };
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

// Function to check and reconcile expired reservations
export async function reconcileExpiredReservations(env, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const appsScriptPostImpl = deps.postToAppsScriptImpl || deps.appsScriptPostImpl || appsScriptPost;
  const token = env && env.MP_ACCESS_TOKEN;
  if (!token || token.startsWith('REPLACE_') || token === 'REPLACE_WITH_MP_ACCESS_TOKEN') {
    return { ok: false, reason: 'no_token', checked: 0, results: [] };
  }

  const info = await appsScriptPostImpl(env, { type: 'getExpiredOrders', action: 'getExpiredOrders' });
  const data = (info && info.data) ? info.data : (info || {});
  const resMins = (data && data.reservationMinutes) || 15;
  const expiredRaw = (data && (data.expiredOrders || data.expired)) || [];
  const expired = Array.isArray(expiredRaw) ? expiredRaw : [];
  if (expired.length === 0) {
    return { ok: true, checked: 0, count: 0, results: [], reservationMinutes: resMins };
  }

  const results = [];
  let reconciled = 0;
  for (const item of expired) {
    const orderId = item.orderId;
    const mpOrderId = item.mpOrderId || item.mpPreferenceId || '';
    const result = { orderId, canceledInMp: false, mpStatus: '', preserved: false };

    if (mpOrderId) {
      try {
        const mpResp = await fetchImpl('https://api.mercadopago.com/v1/orders/' + encodeURIComponent(mpOrderId), {
          headers: { 'Authorization': 'Bearer ' + token }
        });
        if (mpResp.status === 200) {
          const mpOrder = await mpResp.json();
          const payments = (mpOrder.transactions && Array.isArray(mpOrder.transactions.payments))
            ? mpOrder.transactions.payments
            : [];
          const hasActivePayment = payments.some(p => {
            const s = String(p.status || '').toLowerCase();
            return s === 'approved' || s === 'pending' || s === 'in_process' || s === 'authorized';
          });
          const paymentStatus = payments.length ? String(payments[payments.length - 1].status || '').toLowerCase() : '';

          if (hasActivePayment) {
            result.preserved = true;
            result.paymentStatus = paymentStatus || 'pending';
            result.mpStatus = paymentStatus || String(mpOrder.status || '').toLowerCase();
            results.push(result);
            continue;
          }

          const mpStatus = String(mpOrder.status || '').toLowerCase();
          if (mpStatus === 'created' || mpStatus === 'action_required') {
            const cancelResp = await fetchImpl('https://api.mercadopago.com/v1/orders/' + encodeURIComponent(mpOrderId) + '/cancel', {
              method: 'POST',
              headers: {
                'Authorization': 'Bearer ' + token,
                'X-Idempotency-Key': orderId + '-cancel-expired'
              }
            });
            let cancelJson = {};
            try { cancelJson = await cancelResp.json(); } catch (e) {}
            result.canceledInMp = cancelResp.status >= 200 && cancelResp.status < 300;
            result.mpStatus = cancelJson && cancelJson.status ? String(cancelJson.status).toLowerCase() : 'canceled';
          } else {
            result.mpStatus = mpStatus || 'canceled';
            result.canceledInMp = false;
          }

          await appsScriptPostImpl(env, {
            type: 'reconcileOrder',
            action: 'reconcileOrder',
            orderId: orderId,
            status: 'Expirada (no abonada)',
            mpStatus: 'cancelled',
            note: 'Liberado: tiempo límite excedido sin pago acreditado'
          });
          reconciled++;
        } else if (mpResp.status === 404) {
          await appsScriptPostImpl(env, {
            type: 'reconcileOrder',
            action: 'reconcileOrder',
            orderId: orderId,
            status: 'Expirada (no abonada)',
            mpStatus: 'cancelled',
            note: 'Liberado: orden no encontrada en Mercado Pago'
          });
          result.mpStatus = 'canceled';
          result.canceledInMp = false;
          reconciled++;
        }
      } catch (e) {
        // leave preserved? On error, do not release
        result.preserved = true;
        result.mpStatus = 'error';
      }
    } else {
      await appsScriptPostImpl(env, {
        type: 'reconcileOrder',
        action: 'reconcileOrder',
        orderId: orderId,
        status: 'Expirada (no abonada)',
        mpStatus: 'cancelled',
        note: 'Liberado: reserva abandonada antes de checkout'
      });
      result.mpStatus = 'canceled';
      result.canceledInMp = false;
      reconciled++;
    }

    if (!result.preserved && !result.mpStatus) result.mpStatus = 'canceled';
    results.push(result);
  }

  return {
    ok: true,
    checked: expired.length,
    count: reconciled,
    reconciled,
    results,
    reservationMinutes: resMins
  };
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

    // Secure seller verification probe (authenticated with SHARED_SECRET in POST body)
    if (request.method === 'POST' && url.pathname === '/api/verify-seller') {
      let body;
      try { body = await request.json(); } catch (e) { body = {}; }
      if (!body.secret || !constantTimeEqual(body.secret, env.SHARED_SECRET || '')) {
        return corsResponse(JSON.stringify({ error: 'unauthorized' }), 401);
      }
      const token = env.MP_ACCESS_TOKEN;
      if (!token || token.startsWith('REPLACE_')) {
        return corsResponse(JSON.stringify({ error: 'MP_ACCESS_TOKEN not configured' }), 503);
      }
      const resp = await fetch('https://api.mercadopago.com/users/me', {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      if (resp.status !== 200) {
        return corsResponse(JSON.stringify({ error: 'failed to fetch user info', status: resp.status }), 502);
      }
      const u = await resp.json();
      const isTestUser = Array.isArray(u.tags) && u.tags.includes('test_user');
      const matchesTargetSeller = String(u.id) === '84725274';
      return corsResponse(JSON.stringify({
        ok: matchesTargetSeller && !isTestUser,
        sellerId: u.id,
        nickname: u.nickname,
        siteId: u.site_id,
        isTestUser,
        matchesTargetSeller
      }), 200);
    }

    // Secure read-only order inspection in Mercado Pago LIVE (authenticated with SHARED_SECRET)
    if (request.method === 'POST' && url.pathname === '/api/admin/inspect-order') {
      let body;
      try { body = await request.json(); } catch (e) { body = {}; }
      if (!body.secret || !constantTimeEqual(body.secret, env.SHARED_SECRET || '')) {
        return corsResponse(JSON.stringify({ error: 'unauthorized' }), 401);
      }
      const mpOrderId = body.mpOrderId;
      if (!mpOrderId) return corsResponse(JSON.stringify({ error: 'missing mpOrderId' }), 400);
      const token = env.MP_ACCESS_TOKEN;
      if (!token || token.startsWith('REPLACE_')) {
        return corsResponse(JSON.stringify({ error: 'MP_ACCESS_TOKEN not configured' }), 503);
      }
      const resp = await fetch('https://api.mercadopago.com/v1/orders/' + encodeURIComponent(mpOrderId), {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      const data = await resp.json();
      return corsResponse(JSON.stringify({
        status: resp.status,
        mpOrder: {
          id: data.id,
          status: data.status,
          status_detail: data.status_detail,
          total_amount: data.total_amount,
          external_reference: data.external_reference,
          items: data.items,
          transactions: data.transactions,
          date_created: data.date_created,
          expiration_time: data.expiration_time
        }
      }), resp.status);
    }

    // Secure order cancellation probe in Mercado Pago (authenticated with SHARED_SECRET)
    if (request.method === 'POST' && url.pathname === '/api/admin/cancel-order') {
      let body;
      try { body = await request.json(); } catch (e) { body = {}; }
      if (!body.secret || !constantTimeEqual(body.secret, env.SHARED_SECRET || '')) {
        return corsResponse(JSON.stringify({ error: 'unauthorized' }), 401);
      }
      const mpOrderId = body.mpOrderId;
      const orderId = body.orderId;
      if (!mpOrderId) return corsResponse(JSON.stringify({ error: 'missing mpOrderId' }), 400);
      const token = env.MP_ACCESS_TOKEN;
      if (!token || token.startsWith('REPLACE_')) {
        return corsResponse(JSON.stringify({ error: 'MP_ACCESS_TOKEN not configured' }), 503);
      }

      // Official Mercado Pago Orders API cancellation: POST /v1/orders/:id/cancel with X-Idempotency-Key
      let postCancelJson = null;
      const postResp = await fetch('https://api.mercadopago.com/v1/orders/' + encodeURIComponent(mpOrderId) + '/cancel', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + token,
          'X-Idempotency-Key': (orderId || mpOrderId) + '-cancel'
        }
      });
      const postCancelStatus = postResp.status;
      try { postCancelJson = await postResp.json(); } catch(e) {}

      return corsResponse(JSON.stringify({
        postCancelStatus,
        postCancelJson
      }), postCancelStatus === 200 || postCancelStatus === 201 ? 200 : postCancelStatus);
    }

    // Reconcile expired reservations (safe, checks Mercado Pago first)
    if (url.pathname === '/api/reconcile-expired') {
      const res = await reconcileExpiredReservations(env);
      return corsResponse(JSON.stringify(res), res.ok ? 200 : 500);
    }

    // Public catalog proxy (read-only, no secret)
    if (request.method === 'GET' && url.pathname === '/api/catalog') {
      try { await reconcileExpiredReservations(env); } catch(e) {}
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

      const payerEmail = order.guestEmail || (env.LIVE_MODE === 'true' ? null : 'test_user_8372187013275911136@testuser.com');

      const itemTitle = order.title || order.experienceId || 'Regalo de casamiento';
      const itemDescription = order.title ? `${order.title} (${order.experienceId})` : (order.experienceId || '');

      // Mercado Pago Orders API (/v1/orders)
      const ordersPayload = {
        type: 'online',
        total_amount: amount,
        external_reference: orderId,
        processing_mode: 'manual',
        capture_mode: 'automatic_async',
        expiration_time: 'PT30M',
        description: itemTitle,
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
          title: itemTitle,
          description: itemDescription,
          category_id: 'travel',
          quantity: 1,
          unit_price: amount,
          type: 'travel'
        }]
      };
      if (payerEmail) {
        ordersPayload.payer = { email: payerEmail };
      }

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

      // Explicit fallback to Preferences API only if configured outside strict orders mode
      if (ordersFailed) {
        const pref = await createCheckoutPreference(env, {
          orderId,
          experienceId: order.experienceId,
          title: order.title || order.experienceId,
          amount
        });
        text = pref.text;
        json = pref.json;
        resp = { status: pref.status };
        if (json.init_point || json.sandbox_init_point) {
          await appsScriptPost(env, {
            type: 'mp_order_created',
            orderId,
            mpOrderId: json.id
          });
          return corsResponse(JSON.stringify({
            checkoutUrl: pref.checkoutUrl,
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
            const resolved = resolveOrderStatus(o);
            await appsScriptPost(env, {
              type: 'confirm',
              orderId,
              status: resolved.status,
              paymentId: resolved.paymentId
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

      // Extract resource ID and event type/topic
      const resourceId = url.searchParams.get('data.id') ||
                         url.searchParams.get('id') ||
                         (body && body.data && body.data.id) ||
                         (body && body.id) ||
                         null;

      const eventType = (body && body.type) || url.searchParams.get('type') || '';
      const eventTopic = (body && body.topic) || url.searchParams.get('topic') || '';
      const eventAction = (body && body.action) || url.searchParams.get('action') || '';

      const token = env.MP_ACCESS_TOKEN;
      let mpStatus = 'pending';
      let mpPaymentId = resourceId ? String(resourceId) : '';
      let orderId = null;

      if (token && token !== 'REPLACE_WITH_MP_ACCESS_TOKEN' && resourceId) {
        const isOrderEvent = eventType === 'order' || eventTopic === 'order' || eventAction.startsWith('order.');
        const isMerchantOrderEvent = eventType === 'merchant_order' || eventTopic === 'merchant_order' || eventAction.startsWith('merchant_order.');
        const isPaymentEvent = eventType === 'payment' || eventTopic === 'payment' || eventAction.startsWith('payment.');

        const authHeaders = { 'Authorization': 'Bearer ' + token };

        if (isOrderEvent) {
          const resp = await fetch('https://api.mercadopago.com/v1/orders/' + encodeURIComponent(resourceId), { headers: authHeaders });
          if (resp.status === 200) {
            const o = await resp.json();
            orderId = o.external_reference || null;
            const res = resolveOrderStatus(o);
            mpStatus = res.status;
            mpPaymentId = res.paymentId || mpPaymentId;
          }
        } else if (isMerchantOrderEvent) {
          const resp = await fetch('https://api.mercadopago.com/merchant_orders/' + encodeURIComponent(resourceId), { headers: authHeaders });
          if (resp.status === 200) {
            const m = await resp.json();
            orderId = m.external_reference || null;
            const payments = Array.isArray(m.payments) ? m.payments : [];
            const approved = payments.find(p => p.status === 'approved');
            if (m.order_status === 'paid' || approved) {
              mpStatus = 'approved';
              if (approved) mpPaymentId = String(approved.id);
            } else if (payments.length > 0) {
              const last = payments[payments.length - 1];
              mpStatus = last.status || m.status || 'pending';
              mpPaymentId = String(last.id || mpPaymentId);
            } else {
              mpStatus = m.status || 'pending';
            }
          }
        } else if (isPaymentEvent) {
          const resp = await fetch('https://api.mercadopago.com/v1/payments/' + encodeURIComponent(resourceId), { headers: authHeaders });
          if (resp.status === 200) {
            const p = await resp.json();
            mpStatus = p.status || mpStatus;
            mpPaymentId = String(p.id || mpPaymentId);
            orderId = p.external_reference || null;
          }
        } else {
          // Unspecified event type: probe Orders API first, then Payments API, then Merchant Orders API
          let resolved = false;
          const orderResp = await fetch('https://api.mercadopago.com/v1/orders/' + encodeURIComponent(resourceId), { headers: authHeaders });
          if (orderResp.status === 200) {
            const o = await orderResp.json();
            orderId = o.external_reference || null;
            const res = resolveOrderStatus(o);
            mpStatus = res.status;
            mpPaymentId = res.paymentId || mpPaymentId;
            resolved = true;
          }
          if (!resolved) {
            const payResp = await fetch('https://api.mercadopago.com/v1/payments/' + encodeURIComponent(resourceId), { headers: authHeaders });
            if (payResp.status === 200) {
              const p = await payResp.json();
              mpStatus = p.status || mpStatus;
              mpPaymentId = String(p.id || mpPaymentId);
              orderId = p.external_reference || null;
              resolved = true;
            }
          }
          if (!resolved) {
            const moResp = await fetch('https://api.mercadopago.com/merchant_orders/' + encodeURIComponent(resourceId), { headers: authHeaders });
            if (moResp.status === 200) {
              const m = await moResp.json();
              orderId = m.external_reference || null;
              const payments = Array.isArray(m.payments) ? m.payments : [];
              const approved = payments.find(p => p.status === 'approved');
              if (m.order_status === 'paid' || approved) {
                mpStatus = 'approved';
                if (approved) mpPaymentId = String(approved.id);
              } else {
                mpStatus = m.status || 'pending';
              }
            }
          }
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
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(reconcileExpiredReservations(env));
  }
};
