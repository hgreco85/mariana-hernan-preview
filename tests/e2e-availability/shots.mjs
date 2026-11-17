import { launch, serve, newPage, sleep } from './lib.mjs';
const { srv, base } = await serve(process.argv[2]); const browser = await launch();
for (const vp of ['desktop','android']) {
  const cfg = { queue: [{ mode: 'hang' }] };
  const c = await newPage(browser, { vp, base, cfg, extraInit: 'window.CATALOG_TIMEOUT_MS_OVERRIDE=2500' });
  await c.page.goto(base + '/', { waitUntil: 'domcontentloaded' }); await c.page.waitForSelector('#cards [data-gift]'); await c.page.evaluate(()=>document.querySelector('#cards').scrollIntoView());
  await sleep(500); await c.page.screenshot({ path: `shot-${vp}-loading.png` });
  await c.page.waitForSelector('#cards .retry'); await sleep(300); await c.page.screenshot({ path: `shot-${vp}-error.png` });
  await c.page.evaluate(()=>showGift('V09-082')); await sleep(300); await c.page.screenshot({ path: `shot-${vp}-modal-error.png` });
  await c.ctx.close();
  const c2 = await newPage(browser, { vp, base, cfg: { queue: [{ mode: 'ok', delay: 200 }] } });
  await c2.page.goto(base + '/', { waitUntil: 'domcontentloaded' }); await c2.page.waitForFunction(()=>/ARS\s*\d/.test(document.querySelector('#cards').textContent)); await c2.page.evaluate(()=>document.querySelector('#cards').scrollIntoView()); await sleep(300); await c2.page.screenshot({ path: `shot-${vp}-ready.png` }); await c2.ctx.close();
}
await browser.close(); srv.close();
