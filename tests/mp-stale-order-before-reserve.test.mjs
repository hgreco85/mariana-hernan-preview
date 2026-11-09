import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync('Code.js','utf8');
const guardStart=source.indexOf('function unsettledPaymentOrder(');
const guardEnd=source.indexOf('function releaseExpiredReservations()', guardStart);
const reserveStart=source.indexOf('function reserveExperience(');
const reserveEnd=source.indexOf('function getOrderPublic(', reserveStart);
assert.ok(guardStart>=0 && guardEnd>guardStart && reserveStart>=0 && reserveEnd>reserveStart);
const isolated=source.slice(guardStart,guardEnd)+'\n'+source.slice(reserveStart,reserveEnd);
function runCase(state,mpId){
  const catalogRows=[['ID'],['V09-001','','','','','', '', '',32,49900,'','','Disponible']];
  const op=Array(13).fill('');op[1]='V09-001';op[2]=state;op[6]=mpId;
  let writes=0,appends=0;
  const context={
    LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
    releaseExpiredReservationsLocked(){},
    catalogSheet:()=>({getDataRange:()=>({getValues:()=>catalogRows}),getRange:()=>({setValue(){writes++},clearContent(){writes++}})}),
    opsSheet:()=>({getDataRange:()=>({getValues:()=>[['headers'],op]})}),
    getFxRate:()=>1560,
    appendOp(){appends++},
    PropertiesService:{getScriptProperties:()=>({getProperty:()=>null})}
  };
  vm.runInNewContext(isolated,context);
  let error=null;
  try{context.reserveExperience('V09-001')}catch(e){error=e}
  return {error,writes,appends};
}
test('legacy available card with unresolved MP Order is blocked before mutation',()=>{
  const r=runCase('Reservada','mp-test-order');
  assert.ok(r.error?.message.includes('pendiente de conciliación'));
  assert.equal(r.writes,0);
  assert.equal(r.appends,0);
});
test('pending external MP Order is blocked even if catalog is available',()=>{
  const r=runCase('Pendiente','mp-test-order');
  assert.ok(r.error);
  assert.equal(r.writes,0);
  assert.equal(r.appends,0);
});
test('internal-only expired reservation does not permanently block a fresh order',()=>{
  const r=runCase('Reservada','');
  assert.equal(r.error,null);
  assert.equal(r.appends,1);
});
