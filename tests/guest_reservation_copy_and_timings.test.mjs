import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const files=['index.html','preview.html'].map(p=>readFileSync(path.join(root,p),'utf8'));

test('guest sees neutral reservation copy, not payment-in-progress claim',()=>{
  for (const html of files) {
    assert.match(html,/pending:'Alguien ya eligió esta experiencia ❤️'/);
    assert.match(html,/reserved:'Está reservada por unos minutos/);
    assert.match(html,/pending:'Alguém já escolheu esta experiência ❤️'/);
    assert.match(html,/reserved:'Ela está reservada por alguns minutos/);
    assert.doesNotMatch(html,/pending:'Pago pendiente de confirmación\. Estamos esperando la acreditación.'/);
    assert.match(html,/esc\(i18n\[lang\]\.pending\).*?esc\(i18n\[lang\]\.reserved\)/);
  }
});
test('buyer payment confirmation remains truthful and independent',()=>{
  assert.match(files[0],/payPending:'Tu pago está pendiente de acreditación/);
  assert.match(files[0],/api\.getOrderStatus\(order\)/);
});
test('checkout latency phases are persisted without sensitive data',()=>{
  assert.match(files[0],/sessionStorage\.setItem\('lastCheckoutTimings'/);
  assert.match(files[0],/reserveMs:window\.__checkoutMetrics\.reserveMs/);
  assert.match(files[0],/createOrderMs:window\.__checkoutMetrics\.createOrderMs/);
  assert.match(files[0],/totalMs:window\.__checkoutMetrics\.totalMs/);
});
