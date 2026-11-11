import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const html=readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../index.html'),'utf8');
test('Redirect as soon as Checkout URL is received, with no artificial 300ms wait',()=>{
  assert.match(html,/window\.location\.assign\(wr\.checkoutUrl\)/);
  assert.doesNotMatch(html,/setTimeout\(function\(\)\{\s*window\.location\.href=wr\.checkoutUrl;/);
});
test('Client-side reservation and idempotency safety still intact',()=>{
  assert.match(html,/if\(isCheckingOut\) return/);
  assert.match(html,/sessionStorage\.setItem\('pendingOrder_'\+id/);
  assert.match(html,/sessionStorage\.setItem\('lastCheckoutTimings'/);
  assert.match(html,/clearTimeout\(timer\);\s*if\(btn\) btn\.textContent=i18n\[lang\]\.step3/);
});
test('Backend preconnects are safe and separate from payment endpoints',()=>{
  assert.match(html,/<link rel="preconnect" href="https:\/\/script\.google\.com" crossorigin>/);
  assert.match(html,/<link rel="preconnect" href="https:\/\/mp-webhook-production\.hgreco85\.workers\.dev" crossorigin>/);
});

test('15s slow backend is not incorrectly treated as a failed checkout',()=>{
  assert.match(html,/const timer=setTimeout\(function\(\)\{[\s\S]*?btn\.disabled=true/);
  assert.match(html,/No vuelvas a intentar pagar; seguimos esperando la respuesta/);
  assert.doesNotMatch(html,/timedOut=true/);
  assert.doesNotMatch(html,/if\(timedOut\) return/);
});
