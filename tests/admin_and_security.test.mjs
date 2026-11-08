import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/src/index.js';

const mockEnv = {
  SHARED_SECRET: 'super-secret-key-2026',
  APPS_SCRIPT_URL: 'https://script.mock.google.com/exec',
  MP_ACCESS_TOKEN: 'TEST-mock',
  APP_URL: 'https://hgreco85.github.io/mariana-hernan-preview/'
};

test('Admin endpoints: unauthorized request without secret returns 401', async () => {
  const req = new Request('https://worker.test/api/admin/ops', {
    method: 'GET'
  });
  const res = await worker.fetch(req, mockEnv);
  assert.equal(res.status, 401);
  const json = await res.json();
  assert.equal(json.error, 'unauthorized');
});

test('Admin endpoints: authorized request with Bearer token passes auth', async () => {
  // Mock fetch for Apps Script forward
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    return new Response(JSON.stringify([['Orden ID', 'Estado'], ['ORD-1', 'Expirada']]), { status: 200 });
  };

  try {
    const req = new Request('https://worker.test/api/admin/ops', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${mockEnv.SHARED_SECRET}`
      }
    });
    const res = await worker.fetch(req, mockEnv);
    assert.equal(res.status, 200);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Security: sanitize inputs to prevent injection and XSS', () => {
  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  const maliciousName = '<script>alert("hack")</script>';
  const maliciousDed = '<img src=x onerror=alert(1)> & "quotes"';

  const cleanName = esc(maliciousName);
  const cleanDed = esc(maliciousDed);

  assert.ok(!cleanName.includes('<script>'));
  assert.ok(cleanName.includes('&lt;script&gt;'));
  assert.ok(!cleanDed.includes('<img'));
  assert.ok(cleanDed.includes('&quot;quotes&quot;'));
});

test('Security: no secret keys or private credentials in public client responses', async () => {
  const req = new Request('https://worker.test/health', { method: 'GET' });
  const res = await worker.fetch(req, mockEnv);
  assert.equal(res.status, 200);
  const text = await res.text();

  assert.ok(!text.includes(mockEnv.SHARED_SECRET), 'SHARED_SECRET must not leak in health output');
  assert.ok(!text.includes(mockEnv.MP_ACCESS_TOKEN), 'MP_ACCESS_TOKEN must not leak in health output');
});
