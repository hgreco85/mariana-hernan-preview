import fs from 'node:fs';
import { launch, serve, newPage, viol, sleep, REAL } from './lib.mjs';
const target = process.argv[2];           // dir containing index.html
const label = process.argv[3] || 'new';
const { srv, base } = await serve(target);
const browser = await launch();
const R = []; let fail = 0;
const AVAIL = 'V09-003';
const PAID = ['V09-082', 'V09-024'];
const realPaid = REAL.filter(r => /cobrad/i.test(r.status)).map(r => r.id);
const price = /ARS\s*[\d.]|≈ USD|≈ R\$/;
async function T(name, vp, fn, opts = {}) {
  if (process.env.ONLY && !new RegExp(process.env.ONLY).test(name)) return; if (process.env.VP && process.env.VP !== vp) return;
  const cfg = { queue: opts.queue || [{ mode: 'ok', delay: 300 }] };
  const ctx = await newPage(browser, { vp, base, cfg, slowNet: opts.slow, extraInit: opts.init || '' });
  const t0 = Date.now(); let err = null, extra = {};
  try { extra = (await fn(ctx, cfg)) || {}; } catch (e) { err = e; }
  const v = await viol(ctx.page).catch(() => ({ v: [], n: 0 }));
  const okRule = !err && v.v.length === 0 && ctx.forbidden.length === 0 && ctx.errors.length === 0 && v.n > 50;
  if (!okRule) fail++;
  R.push({ test: name, vp, pass: okRule, violations: v.v.length, samples: v.n, forbiddenReqs: ctx.forbidden.length, pageErrors: ctx.errors.length, err: err && String(err.message).slice(0, 200), ms: Date.now() - t0, ...extra, firstViolations: v.v.slice(0, 2) });
  console.log((okRule ? 'PASS' : 'FAIL'), name, vp, `viol=${v.v.length} samples=${v.n}`, err ? 'ERR ' + String(err.message).slice(0, 160) : '', JSON.stringify(extra));
  await ctx.ctx.close();
}
const card = (p, id) => p.locator(`#cards [data-gift="${id}"]`);
const txt = async (p, id) => (await card(p, id).textContent());
const heartTxt = 'ya forma parte de nuestro viaje', heartPt = 'já faz parte da nossa viagem';
const waitHeart = (p, id, pt) => p.waitForFunction(([id, t]) => { const c = document.querySelector(`#cards [data-gift="${id}"]`); return c && c.textContent.includes(t) }, [id, pt ? heartPt : heartTxt], { timeout: 60000 });
const waitPrice = (p, id) => p.waitForFunction(id => { const c = document.querySelector(`#cards [data-gift="${id}"]`); return c && /ARS\s*\d/.test(c.textContent) }, id, { timeout: 60000 });
const load = (p, q = '') => p.goto(base + '/' + q, { waitUntil: 'domcontentloaded' });
const stuck = async (p, ids) => { for (const id of ids) { const t = await txt(p, id); if (price.test(t) || await card(p, id).locator('.cta').count() > 1) throw new Error('price while unknown ' + id); } };

for (const vp of ['desktop', 'android']) {
  // 1 fast network, ES
  await T('fast ES: loading -> paid heart, available price', vp, async ({ page }) => {
    await load(page);
    await page.waitForSelector('#cards [data-gift]');
    // immediate: content visible, no price anywhere, indicator present
    const first = await page.locator('#cards').textContent();
    if (price.test(first) && label === 'new') throw new Error('price visible at first paint');
    if (label === 'new' && !first.includes('Consultando disponibilidad…')) throw new Error('indicator missing');
    await page.waitForSelector('#cards [data-gift] img');
    for (const id of PAID) await waitHeart(page, id);
    await waitPrice(page, AVAIL);
    const gone = await page.locator('.avail-wait').count();
    if (label === 'new' && gone) throw new Error('indicator still shown after confirmation');
    // paid gifts: no price, available: price. detail modal
    for (const id of PAID) { await card(page, id).click(); if (await page.locator('#giftBtn').count()) throw new Error('buy btn on paid'); await page.keyboard.press('Escape'); }
    await card(page, AVAIL).click(); await page.waitForSelector('#giftBtn'); if (await page.locator('#giftBtn').isDisabled()) throw new Error('btn disabled'); 
    return { heart: Math.round((await viol(page)).marks['heart_V09-082'] || 0), priceV082: Math.round((await viol(page)).marks['price_V09-082'] || 0) };
  });
  // 2 PT
  await T('fast PT', vp, async ({ page }) => {
    await load(page); await page.waitForSelector('#cards [data-gift]');
    await page.click('.lang button[data-lang="pt"]');
    const t1 = await page.locator('#cards').textContent();
    if (label === 'new' && !t1.includes('Consultando disponibilidade…')) throw new Error('PT indicator missing');
    for (const id of PAID) await waitHeart(page, id, true);
    await waitPrice(page, AVAIL);
  });
  // 3 slow network + 8s API
  await T('slow net (3G) + API 8s', vp, async ({ page }) => {
    await load(page); await page.waitForSelector('#cards [data-gift]', { timeout: 60000 });
    await sleep(3000); if (label === 'new') await stuck(page, [...PAID, AVAIL]);
    for (const id of PAID) await waitHeart(page, id); await waitPrice(page, AVAIL);
  }, { slow: true, queue: [{ mode: 'ok', delay: 8000 }] });
  // 4 API 20s
  await T('API delayed 20s', vp, async ({ page }) => {
    await load(page); await page.waitForSelector('#cards [data-gift]');
    await sleep(19000); if (label === 'new') await stuck(page, [...PAID, AVAIL]);
    for (const id of PAID) await waitHeart(page, id); await waitPrice(page, AVAIL);
  }, { queue: [{ mode: 'ok', delay: 20000 }] });
  // 5 API failures: safe state + retry
  for (const mode of ['500', 'abort', 'badjson', 'shape', 'empty']) {
    await T('API ' + mode + ' -> safe state, retry recovers', vp, async ({ page }, cfg) => {
      await load(page); await page.waitForSelector('#cards [data-gift]');
      if (label === 'new') { await page.waitForSelector('#cards .retry', { timeout: 15000 }); await stuck(page, [...PAID, AVAIL]);
        const note = await txt(page, 'V09-082'); if (!note.includes('No pudimos verificar la disponibilidad')) throw new Error('no fail msg');
        await page.click('.lang button[data-lang="pt"]'); if (!(await txt(page, 'V09-082')).includes('Tentar novamente')) throw new Error('no PT retry');
        await page.click('.lang button[data-lang="es"]');
        cfg.queue = [{ mode: 'ok', delay: 400 }];
        await card(page, 'V09-082').locator('.retry').click();
        if (await page.locator('#overlay.open').count()) throw new Error('retry opened modal');
      } else { await sleep(2000); cfg.queue = [{ mode: 'ok', delay: 400 }]; await page.evaluate(() => refreshGiftStatuses()); }
      for (const id of PAID) await waitHeart(page, id); await waitPrice(page, AVAIL);
    }, { queue: [{ mode }] });
  }
  // 6 partial response: missing gifts stay unknown, others resolved, retry offered
  await T('partial response (V09-082, V09-003 missing; V09-024 blank status)', vp, async ({ page }, cfg) => {
    await load(page); await page.waitForSelector('#cards [data-gift]'); await waitHeart(page, 'V09-001').catch(() => {});
    await sleep(2500);
    if (label === 'new') { await stuck(page, ['V09-082', 'V09-024', AVAIL]); await page.waitForSelector('#cards .retry'); await waitPrice(page, 'V09-004'); }
  }, { queue: [{ mode: 'partial', drop: ['V09-082', 'V09-003'], delay: 300 }] });
  await T('blank status for V09-024', vp, async ({ page }) => {
    await load(page); await page.waitForSelector('#cards [data-gift]'); await sleep(2500);
    if (label === 'new') { await stuck(page, ['V09-024']); }
  }, { queue: [{ mode: 'blankstatus', drop: ['V09-024'], delay: 300 }] });
  // 7 timeout (override 3s, API hangs 10s)
  await T('client timeout -> safe state + retry', vp, async ({ page }, cfg) => {
    await load(page); await page.waitForSelector('#cards [data-gift]');
    if (label === 'new') { await page.waitForSelector('#cards .retry', { timeout: 9000 }); await stuck(page, [...PAID, AVAIL]); cfg.queue = [{ mode: 'ok', delay: 200 }]; await card(page, AVAIL).locator('.retry').click(); }
    else await sleep(3500);
    for (const id of PAID) await waitHeart(page, id); await waitPrice(page, AVAIL);
  }, { queue: [{ mode: 'hang' }], init: 'window.CATALOG_TIMEOUT_MS_OVERRIDE=3000' });
  // 8 direct links
  for (const id of ['V09-082', 'V09-024', AVAIL]) await T('direct link #' + id, vp, async ({ page }) => {
    await load(page, '#' + id); await page.waitForSelector('#overlay.open');
    if (label === 'new') { await sleep(1500); if (await page.locator('#giftBtn').count() || price.test(await page.locator('#dialogContent').textContent())) throw new Error('modal price while unknown'); if (!(await page.locator('#dialogContent').textContent()).includes('Consultando')) throw new Error('modal no indicator'); }
    if (id === AVAIL) { await page.waitForSelector('#giftBtn', { timeout: 30000 }); if (await page.locator('#giftBtn').isDisabled()) throw new Error('disabled'); }
    else { await page.waitForFunction(() => document.getElementById('dialogContent').textContent.includes('ya forma parte de nuestro viaje'), null, { timeout: 30000 }); if (await page.locator('#giftBtn').count()) throw new Error('btn on paid'); }
  }, { queue: [{ mode: 'ok', delay: 4000 }] });
  await T('direct link under API failure then retry in modal', vp, async ({ page }, cfg) => {
    await load(page, '#V09-082'); await page.waitForSelector('#overlay.open'); 
    if (label === 'new') { await page.waitForSelector('#dialogContent .retry', { timeout: 15000 }); if (await page.locator('#giftBtn').count()) throw new Error('btn'); cfg.queue = [{ mode: 'ok', delay: 300 }]; await page.click('#dialogContent .retry'); }
    else await sleep(1500);
    await page.waitForFunction(() => document.getElementById('dialogContent').textContent.includes('ya forma parte de nuestro viaje'), null, { timeout: 30000 });
  }, { queue: [{ mode: '500' }] });
  // 9 filters/sort/lang while loading and after
  await T('filters + sort + lang during loading and after', vp, async ({ page }) => {
    await load(page); await page.waitForSelector('#cards [data-gift]');
    const cycle = async () => {
      for (const s of ['priceAsc', 'priceDesc', 'nameAsc', 'nameDesc', 'cityAsc', 'typeAsc', 'trip']) { await page.selectOption('#sort', s); }
      await page.selectOption('#city', 'Estrasburgo'); await page.selectOption('#price', '78000'); await page.selectOption('#price', ''); await page.selectOption('#city', ''); 
      const types = await page.$$eval('#type option', o => o.map(x => x.value).filter(Boolean)); if (types[0]) { await page.selectOption('#type', types[0]); await page.selectOption('#type', ''); }
      await page.click('.lang button[data-lang="pt"]'); await page.click('.lang button[data-lang="es"]');
      await page.selectOption('#city', 'Roma'); await page.click('#clearBtn');
    };
    await cycle(); await sleep(500); await cycle();   // while unknown (API 5s)
    await waitPrice(page, AVAIL); await cycle();      // after confirmation
    for (const id of PAID) { await page.selectOption('#sort', 'trip'); await waitHeart(page, id); }
  }, { queue: [{ mode: 'ok', delay: 5000 }] });
  // 10 MP return + refocus
  await T('return from Mercado Pago (?mp_status&order) + overlay close', vp, async ({ page }, cfg) => {
    await load(page, '?mp_status=success&order=ORD-FAKE-TEST'); await page.waitForSelector('#payOverlay');
    await sleep(1000); if (label === 'new') await stuck(page, [...PAID, AVAIL]);
    for (const id of PAID) await waitHeart(page, id);
    await page.waitForFunction(() => document.getElementById('payTitle')); 
    if (!page.url().includes('mp_status') === false) throw new Error('url not cleaned');
    await sleep(11000); await page.click('#payOverlay button[onclick="closePayOverlay()"]'); await waitPrice(page, AVAIL);
  }, { queue: [{ mode: 'ok', delay: 3000 }] });
  await T('tab refresh/focus/visibility never revert to static', vp, async ({ page }, cfg) => {
    await load(page); for (const id of PAID) await waitHeart(page, id); await waitPrice(page, AVAIL);
    for (const b of [{ mode: '500' }, { mode: 'ok', delay: 3000, union: true }, { mode: 'abort' }, { mode: 'badjson' }, { mode: 'partial', drop: ['V09-082', 'V09-003'], union: true }]) {
      cfg.queue = [b];
      await page.evaluate(() => { window.dispatchEvent(new Event('focus')); Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
      await sleep(b.delay ? 3600 : 800);
      for (const id of PAID) { const t = await txt(page, id); if (price.test(t)) throw new Error('static reverted ' + id); }
      if (await page.locator('#cards .retry').count()) throw new Error('retry shown for confirmed');
      if (!price.test(await txt(page, AVAIL)) && b.mode !== 'partial') throw new Error('available lost price');
    }
    // new payment lands mid-session: V09-003 becomes gifted via focus refresh
    cfg.queue = [{ mode: 'ok', delay: 200, union: true, mutate: rs => { rs.find(r => r.id === 'V09-003').status = 'Regalada y cobrada'; } }];
    await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await waitHeart(page, 'V09-003');
  });
  // 11 pending status preserved
  await T('pending (Reservada temporalmente) treatment unchanged', vp, async ({ page }) => {
    await load(page); await page.waitForFunction(() => document.querySelector('#cards [data-gift="V09-004"]')?.textContent.includes('Alguien ya eligió'), null, { timeout: 30000 });
    await card(page, 'V09-004').click(); await page.waitForFunction(() => document.getElementById('dialogContent').textContent.includes('Alguien ya eligió')); if (await page.locator('#giftBtn').count()) throw new Error('btn on pending');
  }, { queue: [{ mode: 'ok', delay: 400, mutate: rs => { const r = rs.find(r => r.id === 'V09-004'); r.status = 'Reservada temporalmente'; r.reservedUntil = '2099-01-01T00:00:00Z'; } }] });
  // 12 purchase guard: giftExperience on unconfirmed/paid never calls the Apps Script
  await T('giftExperience() on unknown/paid gift is a no-op (no reserve request)', vp, async ({ page, forbidden }) => {
    await load(page); await page.waitForSelector('#cards [data-gift]');
    if (label === 'new') { await page.evaluate(() => { giftExperience('V09-082'); giftExperience('V09-003'); }); await sleep(500); if (forbidden.length) throw new Error('request fired'); }
    await waitHeart(page, 'V09-082'); if (label === 'new') { await page.evaluate(() => giftExperience('V09-082')); await sleep(500); if (forbidden.length) throw new Error('request fired on paid'); }
  }, { queue: [{ mode: 'ok', delay: 3000 }] });
}
// 13 DOM equivalence between baseline and new after confirmation (final state)
fs.writeFileSync(`results-${label}.json`, JSON.stringify(R, null, 1));
console.log(`\n${label}: ${R.length - fail}/${R.length} passed`);
await browser.close(); srv.close();
process.exit(fail ? 1 : 0);
