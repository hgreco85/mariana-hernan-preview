import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=fs.readFileSync(path.join(root,'Code.js'),'utf8');
const match=source.match(/function reserveExperience\(experienceId\)\{[\s\S]*?\r?\n\}\r?\n(?=\r?\nfunction getOrderPublic)/);
assert.ok(match,'reserveExperience function is present');

function run({status='Disponible',amount=5000,ops=[],releaseTarget=false}={}){
 const row=Array(20).fill('');
 row[0]='V09-082';row[4]='Gelato';row[8]=3;row[9]=amount;row[12]=status;row[19]=new Date(0);
 const catalog=[['id'],row];
 const operations=[['orderId'],...ops.map(x=>[x.id||'old','V09-082',x.state||'Reservada','','','',x.mpOrderId||''])];
 const reads={catalog:0,ops:0,rate:0,expirationScans:0,writes:0,lock:0};
 const inserted=[];
 const sheet={getDataRange(){return {getValues(){reads.catalog++;return catalog.map(x=>x.slice())}}},getRange(r,c){return {setValue(v){catalog[r-1][c-1]=v;reads.writes++},clearContent(){catalog[r-1][c-1]='';reads.writes++}}}};
 const opSheet={getDataRange(){return {getValues(){reads.ops++;return operations.map(x=>x.slice())}}}};
 const context={
  LockService:{getScriptLock(){return{waitLock(){reads.lock++},releaseLock(){reads.lock--}}}},
  catalogSheet:()=>sheet,
  opsSheet:()=>opSheet,
  PropertiesService:{getScriptProperties(){return{getProperty:()=>15}}},
  getFxRate(){reads.rate++;return 1560},
  appendOp(x){inserted.push(x)},
  unsettledPaymentOrder(x){return Boolean(x[6])&&!['Cancelado','Expirada (no abonada)'].includes(x[2])},
  releaseExpiredReservationsLocked(){reads.expirationScans++;if(releaseTarget){catalog[1][12]='Disponible';catalog[1][19]=''}}
 };
 vm.runInNewContext(match[0]+'; this.reserveExperience=reserveExperience;',context,{timeout:2000});
 let result=null,error=null;
 try{result=context.reserveExperience('V09-082')}catch(e){error=String(e.message)}
 return {result,error,reads,inserted,status:catalog[1][12]};
}
test('available fixed-ARS gift uses one catalog read, one operations read, no expiration sweep and no FX lookup',()=>{
 const r=run();
 assert.equal(r.error,null);
 assert.equal(r.result.amount,5000);
 assert.equal(r.inserted.length,1);
 assert.equal(r.status,'Reservada temporalmente');
 assert.equal(r.reads.catalog,1);
 assert.equal(r.reads.ops,1);
 assert.equal(r.reads.expirationScans,0);
 assert.equal(r.reads.rate,0);
 assert.equal(r.reads.lock,0);
});
test('gift already paid cannot be reserved',()=>{
 const r=run({status:'Regalada y cobrada'});
 assert.match(r.error,/no está disponible/);
 assert.equal(r.inserted.length,0);
 assert.equal(r.reads.lock,0);
});
test('external MP order with unsettled status remains protected even if catalog says available',()=>{
 const r=run({ops:[{mpOrderId:'ORDER-1'}]});
 assert.match(r.error,/pendiente de conciliación/);
 assert.equal(r.inserted.length,0);
 assert.equal(r.reads.lock,0);
});
test('expired reservation is still reconciled under lock before reuse',()=>{
 const r=run({status:'Reservada temporalmente',releaseTarget:true});
 assert.equal(r.error,null);
 assert.equal(r.reads.expirationScans,1);
 assert.equal(r.inserted.length,1);
 assert.equal(r.reads.lock,0);
});
test('active MP order cannot be released by an expired-reservation read',()=>{
 const r=run({status:'Reservada temporalmente',ops:[{mpOrderId:'ORDER-1'}]});
 assert.match(r.error,/pendiente de conciliación/);
 assert.equal(r.inserted.length,0);
 assert.equal(r.reads.lock,0);
});
test('fallback currency conversion still occurs when stored ARS amount is missing',()=>{
 const r=run({amount:0});
 assert.equal(r.result.amount,4680);
 assert.equal(r.reads.rate,1);
});
