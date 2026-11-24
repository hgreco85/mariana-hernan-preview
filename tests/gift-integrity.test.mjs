import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const worker=fs.readFileSync(new URL('../worker/src/index.js',import.meta.url),'utf8');
const code=fs.readFileSync(new URL('../Code.js',import.meta.url),'utf8');
function fn(source,name){const start=source.indexOf('function '+name+'(');assert.ok(start>=0);const end=source.indexOf('\n}',start);assert.ok(end>=0);return source.slice(start,end+2)}
const ctx=vm.createContext({});
vm.runInContext(fn(worker,'verifiedPayerName')+'\n'+fn(worker,'resolveOrderStatus'),ctx);
test('payer name recovered without substituting email',()=>{assert.equal(ctx.verifiedPayerName({payer:{first_name:'Ana',last_name:'Perez'}}),'Ana Perez');assert.equal(ctx.verifiedPayerName({payer:{email:'x@example.invalid'}}),'');assert.equal(ctx.verifiedPayerName(null),'')});
test('only accredited order payment approves',()=>{assert.equal(ctx.resolveOrderStatus({status:'processed'}).status,'pending');assert.equal(ctx.resolveOrderStatus({transactions:{payments:[{id:'p',status:'processed',status_detail:'accredited'}]}}).status,'approved')});
function fixture(status='Aprobado',guest='',dedication='',origin='',payment='p'){
 const row=['order','gift',status,'','ARS',1,'mp',payment,guest,dedication,'original','','',origin];
 let locks=0;
 const sheet={getDataRange:()=>({getValues:()=>[['header'],row.slice()]}),getRange:(r,c)=>({setValue:v=>{row[c-1]=v},setNote:()=>{},clearContent:()=>{row[c-1]=''}})};
 const context=vm.createContext({opsSheet:()=>sheet,catalogSheet:()=>({getDataRange:()=>({getValues:()=>[]})}),LockService:{getScriptLock:()=>({waitLock:()=>{locks++},releaseLock:()=>{locks--}})},findOpRow:(data,id)=>id==='order'?1:-1,mapMpStatus:s=>s==='approved'?'Aprobado':s});
 vm.runInContext(['safeGiftText','confirmPayment','applyPaymentTransitionLocked','saveDedication'].map(n=>fn(code,n)).join('\n'),context);
 return {row,context,locks:()=>locks};
}
test('repeated approved event fills missing fields, keeps date and dedication',()=>{let f=fixture('Aprobado','','original note');f.context.confirmPayment('order','approved','p','Ana Perez','LIVE');assert.equal(f.row[8],'Ana Perez');assert.equal(f.row[9],'original note');assert.equal(f.row[10],'original');assert.equal(f.row[13],'LIVE');assert.equal(f.locks(),0)});
test('explicit guest name is not replaced by payer',()=>{let f=fixture('Aprobado','Family','message','LIVE');f.context.confirmPayment('order','approved','p','Ana','LIVE');assert.equal(f.row[8],'Family');assert.equal(f.row[9],'message');f.context.saveDedication('order','','');assert.equal(f.row[9],'message')});
test('pending payment ID may transition, approved conflict rejected',()=>{let f=fixture('Pendiente','','','','old');f.context.confirmPayment('order','approved','new','Ana','LIVE');assert.equal(f.row[7],'new');assert.equal(f.row[2],'Aprobado');assert.throws(()=>f.context.confirmPayment('order','approved','other','Bob','LIVE'));assert.equal(f.row[8],'Ana');assert.equal(f.locks(),0)});
test('origin conflict and missing order fail without overwriting metadata',()=>{let f=fixture('Aprobado','Family','message','LIVE');assert.throws(()=>f.context.confirmPayment('order','approved','p','Bob','SANDBOX'));assert.throws(()=>f.context.confirmPayment('missing','approved','p','Bob','LIVE'));assert.equal(f.row[8],'Family');assert.equal(f.locks(),0)});
test('late pending cannot downgrade, dedication uses lock',()=>{let f=fixture('Aprobado','Family','message','LIVE');f.context.confirmPayment('order','pending','p','','LIVE');assert.equal(f.row[2],'Aprobado');f.context.saveDedication('order','New name','=formula');assert.equal(f.row[8],'New name');assert.equal(f.row[9],"'=formula");assert.equal(f.locks(),0)});
test('webhook checks persisted acknowledgement',()=>{assert.match(worker,/confirmation\.data\?\.ok !== true/);assert.match(worker,/confirmation persistence failed/)});
