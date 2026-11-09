import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Executes ONLY the isolated Apps Script payment transition functions in a fake
// spreadsheet environment. No MP tokens, network, Cloudflare, or real Sheets.
const source = fs.readFileSync('Code.js','utf8');
const start = source.indexOf('function confirmPayment(');
const end = source.indexOf('function getAppUrl(', start);
assert.ok(start > 0 && end > start, 'payment transition functions exist');
const isolated = source.slice(start,end);

function sheet(data) {
  return {
    data,
    writes: [],
    getDataRange() {return {getValues:()=>this.data.map(r=>[...r])}},
    getRange(r,c) {
      return {
        setValue: value => {this.data[r-1][c-1]=value;this.writes.push({r,c,value});},
        clearContent:()=>{this.data[r-1][c-1]='';this.writes.push({r,c,value:''});}
      };
    }
  };
}
const opsHeaders=Array.from({length:13},(_,i)=>'field'+i);
const catHeaders=Array.from({length:20},(_,i)=>'field'+i);
function harness({initial='Reservada',catStatus='Disponible',withOrder=true}={}) {
  const operation=['ORD-X', 'X', initial, new Date(0), 'ARS', 10000, '', '', '', '', '', '', ''];
  const catalog=Array.from({length:20},()=> '');
  catalog[0]='X'; catalog[12]=catStatus;
  const ops=sheet([opsHeaders,...(withOrder?[operation]:[])]);
  const cat=sheet([catHeaders,catalog]);
  let locks=0, unlocks=0;
  const context = {
    LockService:{getScriptLock:()=>({waitLock:()=>{locks++},releaseLock:()=>{unlocks++}})},
    opsSheet:()=>ops,catalogSheet:()=>cat,
    findOpRow:(rows,oid)=>rows.findIndex((r,i)=>i>0 && r[0]===oid),
    mapMpStatus:s=>({approved:'Aprobado',pending:'Pendiente',rejected:'Rechazado',cancelled:'Cancelado',refunded:'Reembolsado',charged_back:'Contracargo',authorized:'Pendiente',in_process:'Pendiente'})[String(s).toLowerCase()]||s,
    Date,
  };
  vm.createContext(context);
  vm.runInContext(isolated,context,{timeout:1000});
  return {context,ops,cat,get locks(){return locks},get unlocks(){return unlocks}};
}
test('approved 10k ARS is recorded and marks experience gifted only after confirmation',()=>{
  const h=harness();
  assert.equal(h.ops.data[1][5],10000);
  assert.equal(h.cat.data[1][12],'Disponible');
  h.context.confirmPayment('ORD-X','approved','PAY-TEST');
  assert.equal(h.ops.data[1][2],'Aprobado');
  assert.equal(h.ops.data[1][7],'PAY-TEST');
  assert.ok(h.ops.data[1][10] instanceof Date);
  assert.equal(h.cat.data[1][12],'Regalada y cobrada');
  assert.equal(h.locks,1);assert.equal(h.unlocks,1);
});
test('duplicate approved webhook is idempotent and retains confirmation timestamp',()=>{
  const h=harness();h.context.confirmPayment('ORD-X','approved','PAY-TEST');
  const at=h.ops.data[1][10], previousWrites=h.cat.writes.length;
  h.context.confirmPayment('ORD-X','approved','PAY-TEST');
  assert.equal(h.ops.data[1][10],at);
  assert.equal(h.cat.writes.length,previousWrites);
});
test('late pending cannot downgrade an approved payment or gifted catalog',()=>{
  const h=harness();h.context.confirmPayment('ORD-X','approved','PAY-TEST');
  h.context.confirmPayment('ORD-X','pending','PAY-TEST');
  assert.equal(h.ops.data[1][2],'Aprobado');
  assert.equal(h.cat.data[1][12],'Regalada y cobrada');
});
test('pending then rejected releases the experience',()=>{
  const h=harness();
  h.context.confirmPayment('ORD-X','pending','');
  assert.equal(h.cat.data[1][12],'Pago pendiente');
  h.context.confirmPayment('ORD-X','rejected','');
  assert.equal(h.ops.data[1][2],'Rechazado');
  assert.equal(h.cat.data[1][12],'Disponible');
});
test('refund after approval flags catalog for review, does not retain gifted state',()=>{
  const h=harness();h.context.confirmPayment('ORD-X','approved','PAY-TEST');
  h.context.confirmPayment('ORD-X','refunded','PAY-TEST');
  assert.equal(h.ops.data[1][2],'Reembolsado');
  assert.equal(h.cat.data[1][12],'Reembolsada o en revisión');
});
test('unknown order cannot mark catalog gifted',()=>{
  const h=harness({withOrder:false});
  h.context.confirmPayment('FAKE','approved','PAY-TEST');
  assert.equal(h.cat.data[1][12],'Disponible');
  assert.equal(h.cat.writes.length,0);
});
test('previously paid experience stays attributed, conflict recorded',()=>{
  const h=harness({catStatus:'Regalada y cobrada'});
  h.context.confirmPayment('ORD-X','approved','PAY-TEST');
  assert.equal(h.cat.data[1][12],'Regalada y cobrada');
  assert.match(h.ops.data[1][12],/Conflicto/);
});
