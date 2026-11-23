import { chromium, devices } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

export const CHROME = '/usr/bin/google-chrome';
export const WORKER = 'https://mp-webhook-production.hgreco85.workers.dev';
export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
export const REAL = JSON.parse(fs.readFileSync(new URL('./real_catalog_snapshot.json', import.meta.url)));

export function serve(dir) {
  const srv = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    const f = path.join(dir, u === '/' ? 'index.html' : u);
    if (!f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, base: `http://127.0.0.1:${srv.address().port}` })));
}

export async function launch() { return chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] }); }

export const VIEWPORTS = {
  desktop: { viewport: { width: 1280, height: 900 } },
  android: { ...devices['Pixel 7'] },
};

// In-page oracle: price / buy button for any id not in __availOK is a violation. Sampled on every DOM mutation, every rAF and every 5 ms.
export const ORACLE = `(() => {
  window.__viol = []; window.__ok = new Set(); window.__samples = 0; window.__marks = {};
  const PRICE = /ARS\\s*[\\d.]|≈ USD|≈ R\\$/;
  function check(src){
    window.__samples++;
    const t = performance.now();
    document.querySelectorAll('#cards [data-gift]').forEach(c => {
      const id = c.dataset.gift;
      const priced = PRICE.test(c.textContent);
      if (id === 'V09-082' || id === 'V09-024') {
        if (priced && !window.__marks['price_'+id]) window.__marks['price_'+id] = t;
        if (!priced && /❤️/.test(c.textContent) && !window.__marks['heart_'+id]) window.__marks['heart_'+id] = t;
      }
      if (priced && !window.__ok.has(id)) window.__viol.push({t, src, id, where:'card'});
    });
    const ov = document.getElementById('overlay');
    if (ov && ov.classList.contains('open')) {
      let id = null; try { id = activeGiftId; } catch(e) {}
      const dc = document.getElementById('dialogContent');
      const btn = document.getElementById('giftBtn');
      const priced = dc && PRICE.test(dc.textContent);
      if ((btn || priced) && id && !window.__ok.has(id)) window.__viol.push({t, src, id, where:'modal'});
    }
  }
  const mo = new MutationObserver(() => check('mo'));
  const start = () => { mo.observe(document.documentElement, {childList:true, subtree:true, characterData:true, attributes:true}); };
  if (document.documentElement) start(); else document.addEventListener('DOMContentLoaded', start);
  setInterval(() => check('iv'), 5);
  (function raf(){ check('raf'); requestAnimationFrame(raf); })();
  window.__check = check;
})();`;

// Mock API with per-request behaviour. cfg.queue: array of behaviours consumed per /api/catalog request (last one sticks).
export async function newPage(browser, { vp = 'desktop', base, cfg, extraInit = '', slowNet = false, rows = REAL, log }) {
  const ctx = await browser.newContext({ ...VIEWPORTS[vp], serviceWorkers: 'block' });
  await ctx.addInitScript(ORACLE);
  if (extraInit) await ctx.addInitScript(extraInit);
  const page = await ctx.newPage();
  const forbidden = [];   // any request that could create reservation/order/payment
  const catalogReqs = [];
  await ctx.route('**/*', async route => {
    const req = route.request(); const url = req.url(); const m = req.method();
    if (url.startsWith(base)) return route.continue();
    if (/\.(png|jpe?g|webp|gif|svg)(\?|$)/i.test(url) || /unsplash|wikimedia|googleusercontent/.test(url)) return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    if (url.startsWith(WORKER + '/api/catalog') && cfg) {
      const b = cfg.queue.length > 1 ? cfg.queue.shift() : cfg.queue[0];
      catalogReqs.push({ t: Date.now(), b: b.mode });
      if (b.delay) await new Promise(r => setTimeout(r, b.delay));
      let rs = rows;
      if (b.mode === 'ok' || b.mode === 'partial' || b.mode === 'empty' || b.mode === 'shape' || b.mode === 'blankstatus') {
        if (b.mode === 'ok') { rs = (b.rows || rows).map(r => ({ ...r })); if (b.mutate) b.mutate(rs); }
        if (b.mode === 'partial') rs = rows.filter(r => !(b.drop || []).includes(r.id));
        if (b.mode === 'empty') rs = [];
        if (b.mode === 'blankstatus') rs = rows.map(r => (b.drop || []).includes(r.id) ? { ...r, status: '' } : r);
        let body = b.mode === 'shape' ? JSON.stringify({ foo: 1 }) : JSON.stringify(rs);
        const okIds = (b.mode === 'ok' || b.mode === 'partial' || b.mode === 'blankstatus')
          ? rs.filter(r => r.status && String(r.status).trim() === 'Disponible').map(r => r.id) : [];
        try { await page.evaluate(([ids, u]) => { window.__ok = new Set(u ? [...window.__ok, ...ids] : ids); window.__apiDelivered = performance.now(); }, [okIds, !!b.union]); } catch {}
        return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body });
      }
      if (b.mode === '500') return route.fulfill({ status: 500, headers: { 'access-control-allow-origin': '*' }, body: 'boom' });
      if (b.mode === 'badjson') return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"oops": [<html>' });
      if (b.mode === 'abort') return route.abort('failed');
      if (b.mode === 'hang') return new Promise(() => {});
    }
    if (url.startsWith(WORKER + '/api/order-status')) return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ status: 'Pendiente', experienceId: 'V09-003' }) });
    if (url.startsWith(WORKER + '/api/catalog')) return route.continue();   // real API, GET only
    if (m !== 'GET' || /script\.google\.com|create-order|reserve|checkout|mercadopago|dedication/i.test(url)) { forbidden.push(m + ' ' + url.replace(/\?.*/, '?…')); return route.abort('blockedbyclient'); }
    return route.abort('blockedbyclient');
  });
  if (slowNet) {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 400, downloadThroughput: 50 * 1024, uploadThroughput: 20 * 1024 });
  }
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  return { ctx, page, forbidden, catalogReqs, errors };
}

export async function viol(page) { return page.evaluate(() => ({ v: window.__viol, n: window.__samples, marks: window.__marks, api: window.__apiDelivered })); }
export const sleep = ms => new Promise(r => setTimeout(r, ms));
