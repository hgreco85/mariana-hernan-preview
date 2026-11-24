import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const html = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../index.html'), 'utf8').replace(/\r\n/g, '\n');
const start = html.indexOf('function submitDedication(order){');
const end = html.indexOf('\n\nconst defaults=', start);
assert.ok(start >= 0 && end > start, 'dedication UI function exists');
const fnSource = html.slice(start, end);

function setup() {
  const fields = {
    dedName: { value: 'Invitado', disabled: false },
    dedText: { value: 'Un recuerdo hermoso', disabled: false },
    dedSendBtn: { disabled: false, textContent: 'Enviar dedicatoria' },
    dedMsg: { textContent: '' }
  };
  const calls = [];
  const sandbox = {
    document: { getElementById: id => fields[id] },
    lang: 'es',
    i18n: { es: { dedSend: 'Enviar dedicatoria', dedThanks: '¡Gracias por tu dedicatoria!' } },
    api: { saveDedication: (...args) => calls.push(args) }
  };
  vm.runInNewContext(fnSource + '\nthis.submitDedication = submitDedication;', sandbox);
  return { fields, calls, send: () => sandbox.submitDedication('ORDER-DEMO') };
}

test('the live form has accessible confirmation and a dedicated button id', () => {
  assert.match(html, /id="dedSendBtn" onclick="submitDedication/);
  assert.match(html, /id="dedMsg" role="status" aria-live="polite"/);
});

test('only one request is started even with rapid repeat clicks', () => {
  const x = setup();
  x.send();
  x.send();
  assert.equal(x.calls.length, 1);
  assert.equal(x.fields.dedSendBtn.disabled, true);
  assert.match(x.fields.dedMsg.textContent, /Guardando tu mensaje/);
  assert.equal(x.calls[0][0], 'ORDER-DEMO');
  assert.equal(x.calls[0][2], 'Un recuerdo hermoso');
});

test('server success visibly completes the dedication, without new payment', () => {
  const x = setup();
  x.send();
  x.calls[0][3]({ ok: true });
  assert.match(x.fields.dedSendBtn.textContent, /Mensaje recibido/);
  assert.equal(x.fields.dedSendBtn.disabled, true);
  assert.equal(x.fields.dedName.disabled, true);
  assert.equal(x.fields.dedText.disabled, true);
  assert.match(x.fields.dedMsg.textContent, /Tu pago ya está confirmado/);
  x.send();
  assert.equal(x.calls.length, 1);
});

test('server error re-enables sending only the message', () => {
  const x = setup();
  x.send();
  x.calls[0][4](new Error('Se demoró la confirmación del mensaje. Tu pago no se repite.'));
  assert.equal(x.fields.dedSendBtn.disabled, false);
  assert.equal(x.fields.dedSendBtn.textContent, 'Enviar dedicatoria');
  assert.match(x.fields.dedMsg.textContent, /Tu pago no se repite/);
  x.send();
  assert.equal(x.calls.length, 2);
});

test('HTTP 200 with ok:false must not show a false success', () => {
  const x = setup();
  x.send();
  x.calls[0][3]({ ok: false, error: 'unconfirmed' });
  assert.equal(x.fields.dedSendBtn.disabled, false);
  assert.match(x.fields.dedMsg.textContent, /No pudimos confirmar/);
});

test('transport handles JSON/HTTP errors and times out without retrying payment', () => {
  assert.match(html, /fetch\(WORKER_URL \+ '\/api\/dedication'/);
  assert.match(html, /const controller = new AbortController\(\)/);
  assert.match(html, /setTimeout\(\(\) => controller\.abort\(\), 18000\)/);
  assert.match(html, /!r\.ok \|\| !response \|\| response\.ok !== true/);
  assert.match(html, /Tu pago no se repite/);
});
