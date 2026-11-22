import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const source=fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../Code.js'),'utf8');
const scanStart=source.indexOf("    if(type === 'getExpiredOrders'){");
const scanEnd=source.indexOf("\n\n    return ContentService.createTextOutput(JSON.stringify({ error: 'unknown type' })",scanStart);
const saveStart=source.indexOf("function reconcileSingleOrder(");
const saveEnd=source.indexOf("\nfunction getAdminStats(",saveStart);
const unsettledStart=source.indexOf("function unsettledPaymentOrder(");
const unsettledEnd=source.indexOf("\nfunction releaseExpiredReservations(",unsettledStart);
assert.ok(scanStart>0 && scanEnd>scanStart && saveStart>0 && saveEnd>saveStart);
const scannerBody=source.slice(scanStart,scanEnd);
const reconcileBody=source.slice(saveStart,saveEnd);
const unsettledBody=source.slice(unsettledStart,unsettledEnd);
const unsettled=(new Function(unsettledBody+';return unsettledPaymentOrder'))();

function fixtures({opState='created',ageMinutes=35,ttlMinutes=15,expiryOffsetMinutes=-20,hasMp=true,hasPayment=false,other=null,badDate=false,oldNotes=''}={}){
  const op=['ORD-TEST','V09-076',opState,new Date(Date.now()-ageMinutes*60e3),'ARS',118600,hasMp?'MP-TEST':'',hasPayment?'PAY-TEST':'','','','','',oldNotes];
  const c=Array(20).fill('');c[0]='V09-076';c[12]='Reservada temporalmente';
  c[19]=badDate?'22/11/2026':new Date(Date.now()+expiryOffsetMinutes*60e3);
  const ops=[Array(13).fill(''),op],cat=[Array(20).fill(''),c];
  if(other){const row=Array(13).fill('');row[0]='ORD-OTHER';row[1]='V09-076';row[2]=other;row[6]='MP-OTHER';ops.push(row);}
  const sheetFor=arr=>({
    getDataRange(){return {getValues(){return arr.map(x=>x.slice())}}},
    getRange(row,col){return {
      setValue(value){arr[row-1][col-1]=value;return this},
      clearContent(){arr[row-1][col-1]='';return this}
    }}
  });
  const locked={count:0,released:0,held:false};
  const LockService={getScriptLock(){return {
    waitLock(){assert.equal(locked.held,false);locked.held=true;locked.count++},
    releaseLock(){locked.held=false;locked.released++}
  }}};
  const PropertiesService={getScriptProperties(){return {getProperty:()=>String(ttlMinutes)}}};
  const ContentService={MimeType:{JSON:'json'},createTextOutput(text){return {data:JSON.parse(text),setMimeType(){return this}}}};
  const opsSheet=()=>sheetFor(ops),catalogSheet=()=>sheetFor(cat);
  const scan=new Function('opsSheet','catalogSheet','PropertiesService','ContentService','unsettledPaymentOrder',
    "const type='getExpiredOrders';"+scannerBody+";return {data:{ok:false}};");
  const reconcileFactory=new Function('LockService','opsSheet','catalogSheet','findOpRow','unsettledPaymentOrder','PropertiesService',
    reconcileBody+';return reconcileSingleOrder;');
  const reconcile=reconcileFactory(LockService,opsSheet,catalogSheet,(rows,id)=>rows.findIndex((r,i)=>i>0&&r[0]===id),unsettled,PropertiesService);
  return {
    scan:()=>scan(opsSheet,catalogSheet,PropertiesService,ContentService,unsettled).data,
    reconcile:(proof)=>reconcile('ORD-TEST','Expirada (no abonada)','unit-test',proof),
    ops,cat,locked,orderId:'ORD-TEST'
  };
}
test('within 15 minutes is never in the expiry candidate list',()=>{
 const x=fixtures({ageMinutes:10,expiryOffsetMinutes:5});assert.equal(x.scan().expired.length,0);
});
test('created external MP order is included only after both time checks expire',()=>{
 const x=fixtures();assert.equal(x.scan().expired.length,1);
 assert.equal(x.scan().expired[0].mpOrderId,'MP-TEST');
 assert.equal(x.ops[1][2],'created');assert.equal(x.cat[1][12],'Reservada temporalmente');
});
test('created with no MP order and expired TTL can be safely released',()=>{
 const x=fixtures({hasMp:false,opState:'Reservada'});
 assert.equal(x.scan().expired.length,1);
 const r=x.reconcile({mpOrderId:'',mpStatus:'no_mp_order'});
 assert.equal(r.ok,true);assert.equal(r.released,true);
 assert.equal(x.ops[1][2],'Expirada (no abonada)');
 assert.equal(x.cat[1][12],'Disponible');assert.equal(x.cat[1][19],'');
 assert.equal(x.locked.held,false);assert.equal(x.locked.count,1);
});
test('created operation without external ID is held because MP acknowledgment may be lost',()=>{
 const x=fixtures({hasMp:false,opState:'created'});
 assert.equal(x.scan().expired.length,0);
 assert.equal(x.reconcile({mpOrderId:'',mpStatus:'no_mp_order'}).ok,false);
});
test('external order requires exact MP terminal proof and matching external ref',()=>{
 const x=fixtures();
 const old=x.reconcile({mpOrderId:'MP-TEST',mpStatus:'created',externalReference:'ORD-TEST'});
 assert.equal(old.ok,false);assert.equal(x.cat[1][12],'Reservada temporalmente');
 const mismatch=x.reconcile({mpOrderId:'MP-OTHER',mpStatus:'canceled',externalReference:'ORD-TEST'});
 assert.equal(mismatch.ok,false);
 const r=x.reconcile({mpOrderId:'MP-TEST',mpStatus:'canceled',externalReference:'ORD-TEST'});
 assert.equal(r.ok,true);assert.equal(r.released,true);assert.equal(x.cat[1][12],'Disponible');
});
test('approved before expiry and near expiry cannot be unlocked by replay',()=>{
 for(const age of [5,16,180]){
 const x=fixtures({opState:'Aprobado',ageMinutes:age});
 assert.equal(x.scan().expired.length,0);
 assert.equal(x.reconcile({mpOrderId:'MP-TEST',mpStatus:'canceled',externalReference:'ORD-TEST'}).ok,false);
 assert.equal(x.cat[1][12],'Reservada temporalmente');
 }
});
test('unconfirmed pending payment id is protected regardless of old date',()=>{
 const x=fixtures({opState:'Pendiente',hasPayment:true});
 assert.equal(x.scan().expired.length,0);
 assert.equal(x.reconcile({mpOrderId:'MP-TEST',mpStatus:'canceled',externalReference:'ORD-TEST'}).ok,false);
});
test('pending external order is candidate, but must be verified at MP before release',()=>{
 const x=fixtures({opState:'Pendiente'});
 assert.equal(x.scan().expired.length,1);
 assert.equal(x.reconcile({mpOrderId:'MP-TEST',mpStatus:'pending',externalReference:'ORD-TEST'}).ok,false);
});
test('a late approved webhook between scan and reconciliation blocks release',()=>{
 const x=fixtures();assert.equal(x.scan().expired.length,1);
 x.ops[1][2]='Aprobado';x.ops[1][7]='PAY-LATE';
 assert.equal(x.reconcile({mpOrderId:'MP-TEST',mpStatus:'canceled',externalReference:'ORD-TEST'}).ok,false);
 assert.equal(x.cat[1][12],'Reservada temporalmente');
});
test('competing active order prevents release, including near-simultaneous checkout',()=>{
 const x=fixtures({other:'created'});
 assert.equal(x.scan().expired.length,0);
 assert.equal(x.reconcile({mpOrderId:'MP-TEST',mpStatus:'canceled',externalReference:'ORD-TEST'}).ok,false);
});
test('invalid ambiguous T text fails closed, not interpreted as local midnight',()=>{
 const x=fixtures({badDate:true});
 assert.equal(x.scan().expired.length,0);
 assert.equal(x.reconcile({mpOrderId:'MP-TEST',mpStatus:'canceled',externalReference:'ORD-TEST'}).ok,false);
});
test('date objects represent the same instant across timezone offsets',()=>{
 const x=fixtures();
 x.cat[1][19]=new Date('2026-11-20T13:28:00Z');
 const y=Date.parse('2026-11-20T10:28:00-03:00');
 assert.equal(x.cat[1][19].getTime(),y);
 assert.equal(x.scan().expired.length,1);
});
test('missing T falls back to valid created-at + configured 15m',()=>{
 const x=fixtures({expiryOffsetMinutes:-20});x.cat[1][19]='';
 assert.equal(x.scan().expired.length,1);
});
test('idempotent repeated cleanup and historical notes preserved on already released gift',()=>{
 const x=fixtures({oldNotes:'prior audit line'});
 const p={mpOrderId:'MP-TEST',mpStatus:'canceled',externalReference:'ORD-TEST'};
 const first=x.reconcile(p);assert.equal(first.released,true);
 assert.match(x.ops[1][12],/P0 2026/);
 const second=x.reconcile(p);assert.equal(second.ok,true);
 assert.equal(second.alreadyReleased,true);
 assert.equal(x.cat[1][12],'Disponible');
});
test('no approved gift can be released even if its catalog state is inconsistent',()=>{
 const x=fixtures({opState:'Aprobado'});x.cat[1][12]='Regalada y cobrada';
 const r=x.reconcile({mpOrderId:'MP-TEST',mpStatus:'canceled',externalReference:'ORD-TEST'});
 assert.equal(r.ok,false);assert.equal(x.cat[1][12],'Regalada y cobrada');
});
test('duplicate and delayed payment webhooks keep approved status protected',()=>{
 assert.match(source,/if\(currentStatus==='Aprobado' && low==='approved'\)/);
 assert.match(source,/if\(currentStatus==='Aprobado' && \(low==='pending'/);
 assert.match(source,/LockService\.getScriptLock\(\)/);
});
