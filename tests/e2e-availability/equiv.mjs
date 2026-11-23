// Final-state DOM equivalence: baseline vs hotfix, same mocked API, after statuses confirmed.
import { launch, serve, newPage, sleep } from './lib.mjs';
const A = await serve(process.argv[2]), B = await serve(process.argv[3]);
const browser = await launch();
async function snap(base) {
  const cfg = { queue: [{ mode: 'ok', delay: 300, mutate: rs => { const r = rs.find(r => r.id === 'V09-004'); r.status = 'Reservada temporalmente'; r.reservedUntil = '2099-01-01T00:00:00Z'; } }] };
  const { ctx, page } = await newPage(browser, { vp: 'desktop', base, cfg });
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => /ARS\s*\d/.test(document.querySelector('#cards [data-gift="V09-003"]')?.textContent || '') && (document.querySelector('#cards [data-gift="V09-082"]')?.textContent||'').includes('viaje'), null, { timeout: 30000 });
  const out = {};
  for (const lang of ['es', 'pt']) {
    await page.click(`.lang button[data-lang="${lang}"]`);
    for (const s of ['trip', 'priceAsc', 'priceDesc', 'nameAsc', 'cityAsc', 'typeAsc']) { await page.selectOption('#sort', s); out[`${lang}/${s}`] = await page.$eval('#cards', e => e.innerHTML); }
    await page.selectOption('#sort', 'trip'); await page.selectOption('#city', 'Roma'); out[`${lang}/Roma`] = await page.$eval('#cards', e => e.innerHTML); await page.click('#clearBtn');
    for (const id of ['V09-082', 'V09-024', 'V09-001', 'V09-004', 'V09-003', 'V09-010']) { await page.evaluate(id => showGift(id), id); out[`${lang}/modal/${id}`] = await page.$eval('#dialogContent', e => e.innerHTML); await page.evaluate(() => hideGift()); }
  }
  out.count = await page.$eval('#count', e => e.textContent); out.body = await page.evaluate(() => document.querySelector('header,.top').outerHTML + document.querySelector('.hero').outerHTML);
  await ctx.close(); return out;
}
const a = await snap(A.base), b = await snap(B.base);
let diff = 0; for (const k of Object.keys(a)) if (a[k] !== b[k]) { diff++; console.log('DIFF', k); }
console.log(`compared ${Object.keys(a).length} DOM snapshots: ${diff} differences`);
await browser.close(); A.srv.close(); B.srv.close(); process.exit(diff ? 1 : 0);
