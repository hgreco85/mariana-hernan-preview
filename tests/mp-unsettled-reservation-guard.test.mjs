import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../Code.js', import.meta.url),'utf8');
const begin=source.indexOf('function unsettledPaymentOrder(');
const end=source.indexOf('function releaseExpiredReservations()',begin);
assert.ok(begin>=0 && end>begin,'guard helper present');
assert.ok(source.includes('opData.some(r=>String(r[1])===expId && unsettledPaymentOrder(r))'),
  'expiration uses the external MP order guard');

const context={};
vm.runInNewContext(source.slice(begin,end),context);
const row=(state,mpId='')=>{const r=Array(13).fill('');r[2]=state;r[6]=mpId;return r;};
const cases=[
 ['Reservada','mp-order-123',true],
 ['Reservada','',false],
 ['Pago pendiente','',true],
 ['Pendiente','mp-order-123',true],
 ['pending','mp-order-123',true],
 ['Aprobado','mp-order-123',true],
 ['unknown','mp-order-123',true],
 ['Expirada (no abonada)','',false],
 ['Expirada (no abonada)','mp-order-123',false],
 ['Rechazado','mp-order-123',false],
 ['Cancelado','mp-order-123',false],
 ['Reembolsado','mp-order-123',false],
 ['Contracargo','mp-order-123',false]
];
for(const [state,id,expected] of cases) {
  test(`MP unresolved order guard: ${state} /${id?'MP':'internal'}`,()=>{
    assert.equal(context.unsettledPaymentOrder(row(state,id)),expected);
  });
}
