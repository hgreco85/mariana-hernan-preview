// Read-only run against the REAL API (GET /api/catalog only). usage: node real.mjs <dir> <label> [baseUrl]
import fs from 'node:fs';
import { launch, serve, newPage, viol, sleep, WORKER } from './lib.mjs';
const [dir, label, remote] = [process.argv[2], process.argv[3], process.argv[4]];
const browser = await launch();
let base, srv;
if (remote) base = remote.replace(/\/$/, ''); else ({ srv, base } = await serve(dir));
const out = [];
for (const vp of ['desktop', 'android']) {
  // oracle truth: real statuses fetched just before (GET)
  const t0 = Date.now(); const live = await (await fetch(WORKER + '/api/catalog', { cache: 'no-store' })).json(); const apiMs = Date.now() - t0;
  const okIds = live.filter(r => r.status === 'Disponible').map(r => r.id);
  const paid = live.filter(r => /cobrad/i.test(r.status)).map(r => r.id);
  const ctx = await newPage(browser, { vp, base: remote ? 'https://regalos.hgstack.com' : base, cfg: null, extraInit: `window.__okInit=${JSON.stringify(okIds)}` });
  if (remote) { /* public URL: let the page document through */ }
  // seed oracle's allowed set only for gifts the real API says are available AND after the page has had its response
  await ctx.page.addInitScript(`window.__pendingOk=${JSON.stringify(okIds)};` + `const _f=window.fetch;window.fetch=function(...a){const p=_f.apply(this,a);try{if(String(a[0]).includes('/api/catalog'))p.then(r=>{window.__fetchResp=performance.now();window.__ok=new Set(window.__pendingOk)}).catch(()=>{})}catch(e){};return p};`);
  const nav = Date.now();
  await ctx.page.goto(base + '/', { waitUntil: 'domcontentloaded' });
  await ctx.page.waitForSelector('#cards [data-gift]', { timeout: 60000 });
  const firstPaintText = await ctx.page.locator('#cards').textContent();
  const firstPaint = { indicator: /Consultando disponibilidad/.test(firstPaintText), anyPrice: /ARS\s*\d/.test(firstPaintText) };
  await ctx.page.waitForFunction(() => window.__fetchResp, null, { timeout: 90000 }).catch(() => {});
  await sleep(1500);
  const v = await viol(ctx.page);
  const st = await ctx.page.evaluate(ids => ids.map(id => { const c = document.querySelector(`#cards [data-gift="${id}"]`); const t = c ? c.textContent : null; return { id, priced: t ? /ARS\s*\d/.test(t) : null, heart: t ? t.includes('ya forma parte') : null }; }), paid);
  const avail = await ctx.page.evaluate(() => { const c = document.querySelectorAll('#cards [data-gift]'); return [...c].filter(x => /ARS\s*\d/.test(x.textContent)).length; });
  const fetchResp = await ctx.page.evaluate(() => window.__fetchResp || null);
  const r = { label, vp, apiGetMsNode: apiMs, pagePaintToCatalogMs: fetchResp && Math.round(fetchResp), firstPaint, paidIds: paid, paidState: st, pricedCards: avail, violations: v.v.length, samples: v.n, markPriceV082: v.marks['price_V09-082'] && Math.round(v.marks['price_V09-082']), markHeartV082: v.marks['heart_V09-082'] && Math.round(v.marks['heart_V09-082']), markPriceV024: v.marks['price_V09-024'] && Math.round(v.marks['price_V09-024']), markHeartV024: v.marks['heart_V09-024'] && Math.round(v.marks['heart_V09-024']), forbidden: ctx.forbidden, pageErrors: ctx.errors, firstViolations: v.v.slice(0, 2) };
  out.push(r); console.log(JSON.stringify(r));
  await ctx.ctx.close();
}
fs.writeFileSync(`${label}.json`, JSON.stringify(out, null, 1));
await browser.close(); srv && srv.close();
