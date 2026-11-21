// Browser E2E against a LOCAL Firebase Hosting emulator (never production):
//   firebase emulators:start --only hosting --config firebase-shortlinks/firebase.json --project demo-mh-test
//   BASE=http://127.0.0.1:5000 CHROME=/usr/bin/google-chrome node firebase-shortlinks/tests/whatsapp_e2e.playwright.mjs
// All requests to WhatsApp are intercepted and stubbed: no message is ever sent.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://127.0.0.1:5000';
const PHONE = '5491122334455', TOKEN = 'mh27-abc123';
const HEART = '\u{1F49B}', PLANE = '\u2708\uFE0F';
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, channel: process.env.CHROME ? undefined : 'chrome' });
const ctx = await browser.newContext({ locale: 'pt-BR', userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36', viewport: { width: 412, height: 915 } });
const page = await ctx.newPage();
const waRequests = [];
await ctx.route(/api\.whatsapp\.com|wa\.me/, (route) => { waRequests.push(route.request().url()); route.fulfill({ status: 200, contentType: 'text/html', body: 'stub' }); });

// 1) route + rewrite resolves, page renders, anchors are set
const resp = await page.goto(`${BASE}/whatsapp?phone=%2B${PHONE}&token=${TOKEN}`, { waitUntil: 'commit' });
assert.equal(resp.status(), 200);
await page.waitForSelector('#open-app:not([hidden])', { timeout: 10000 });
assert.equal(await page.locator('#open-app').isVisible(), true);
assert.equal(await page.locator('#fallback').isVisible(), true);
const appHref = await page.locator('#open-app').getAttribute('href');
const webHref = await page.locator('#fallback').getAttribute('href');
assert.ok(appHref.startsWith('whatsapp://send?phone=' + PHONE + '&text='));
const decoded = new URL(webHref).searchParams.get('text');
assert.ok(decoded.includes(`Oi! ${HEART} Finalmente`));
assert.ok(decoded.includes(`RSVP ${HEART}\nhttps://marianayhernan.web.app/rsvp/${TOKEN}\n`));
assert.ok(decoded.includes(`Nossa viagem ${PLANE}\nhttps://regalos.hgstack.com\n`));
assert.ok(decoded.includes('30 de novembro'));
assert.ok(!decoded.includes('\uFFFD'));
assert.equal(new URL(appHref.replace('whatsapp://', 'https://x/')).searchParams.get('text'), decoded);

// 2) real browser navigation to the exact HTTPS fallback href => the request URL Chrome puts on the wire
// (opened in a fresh tab: the launcher tab is stuck on the pending whatsapp:// navigation in desktop Chrome)
const tab = await ctx.newPage();
await tab.goto(webHref, { waitUntil: 'commit' });
assert.equal(waRequests.length, 1);
const wire = waRequests[0];
assert.ok(wire.includes('%F0%9F%92%9B') && wire.includes('%E2%9C%88%EF%B8%8F') && wire.includes('%0A'));
assert.equal(new URL(wire).searchParams.get('text'), decoded);

// 3) invalid token
await page.goto(`${BASE}/whatsapp?phone=${PHONE}&token=bad`, { waitUntil: 'commit' });
await page.waitForFunction(() => document.getElementById('status')?.textContent === 'Link inválido.', null, { timeout: 10000 });
assert.equal(await page.locator('#status').innerText(), 'Link inválido.');

// 4) other routes
const r = await ctx.request.get(`${BASE}/`, { maxRedirects: 0 });
console.log('GET / ->', r.status(), r.headers()['location']);
assert.equal(r.status(), 302); assert.equal(r.headers()['location'].replace(/\/$/, ''), 'https://regalos.hgstack.com');
for (const p of ['/index.html', '/firebase.json', '/Code.js']) assert.equal((await ctx.request.get(BASE + p)).status(), 404, p);
console.log('E2E OK; text decoded =', JSON.stringify(decoded.slice(0, 60)) + '…');
await browser.close();
