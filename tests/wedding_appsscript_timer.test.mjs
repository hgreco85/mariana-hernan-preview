import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const source = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../WeddingReconciliationTimer.gs'),
  'utf8'
);

function createHarness({
  secret = 'TEST-SHARED-SECRET',
  http = 200,
  body = {ok:true,checked:1,reconciled:0,results:[{preserved:true,reason:'mp_payment_pending_or_approved'}]},
  fetchError = false,
  existingTriggers = 0
} = {}) {
  const storage = new Map(secret ? [['BACKEND_SHARED_SECRET',secret]] : []);
  const emitted = [];
  const invoked = [];
  const activeTriggers = Array.from({length:existingTriggers},(_,i)=>({id:i,getHandlerFunction:()=> 'weddingReconciliationTick'}));
  activeTriggers.push({id:'unrelated',getHandlerFunction:()=> 'unrelatedPaymentHeartbeat'});
  const properties = {
    getProperty:key=>storage.get(key)||null,
    setProperty:(key,value)=>storage.set(key,value)
  };
  const UrlFetchApp = { fetch: (url, options) => {
    invoked.push({url,options});
    if(fetchError) throw new Error('Do not leak test secret: '+secret);
    return {getResponseCode:()=>http, getContentText:()=>typeof body==='string'?body:JSON.stringify(body)};
  }};
  const ScriptApp = {
    getProjectTriggers:()=>activeTriggers.slice(),
    newTrigger:(handler)=>{
      assert.equal(handler,'weddingReconciliationTick');
      return {timeBased(){return this},everyMinutes(value){assert.equal(value,5);return this},create(){
        activeTriggers.push({id:'new',getHandlerFunction:()=>handler});return this;
      }};
    },
    deleteTrigger:(trigger)=>{let i=activeTriggers.indexOf(trigger);if(i<0)throw Error('not present');activeTriggers.splice(i,1);}
  };
  const context={PropertiesService:{getScriptProperties:()=>properties},UrlFetchApp,ScriptApp,
    console:{log:x=>emitted.push(x)},Date,JSON,Math,Number,Array,Error};
  vm.runInNewContext(source,context,{filename:'WeddingReconciliationTimer.gs'});
  return {context,invoked,emitted,storage,activeTriggers};
}

test('scheduled tick uses only the existing Worker protected endpoint and POST body',()=>{
  const h=createHarness();
  const res=h.context.weddingReconciliationTick();
  assert.equal(h.invoked.length,1);
  assert.equal(h.invoked[0].url,'https://mp-webhook-production.hgreco85.workers.dev/api/reconcile-expired');
  assert.equal(h.invoked[0].options.method,'post');
  assert.equal(JSON.parse(h.invoked[0].options.payload).secret,'TEST-SHARED-SECRET');
  assert.equal(h.invoked[0].options.muteHttpExceptions,true);
  assert.equal(res.checked,1);
  assert.equal(res.preserved,1);
  assert.equal(res.unresolved,0);
  assert.match(h.storage.get('WEDDING_RECONCILE_LAST_OK_AT'),/^\d{4}-\d{2}-\d{2}T/);
});

test('no secret exists: no network call and no heartbeat',()=>{
  const h=createHarness({secret:''});
  assert.throws(()=>h.context.weddingReconciliationTick(),/not configured/);
  assert.equal(h.invoked.length,0);
  assert.equal(h.storage.get('WEDDING_RECONCILE_LAST_OK_AT'),undefined);
});

test('transport failures do not log secrets or falsely set heartbeat',()=>{
  const h=createHarness({fetchError:true});
  assert.throws(()=>h.context.weddingReconciliationTick(),/transport failed/);
  assert.equal(h.storage.get('WEDDING_RECONCILE_LAST_OK_AT'),undefined);
  assert.equal(h.emitted.join(' ').includes('TEST-SHARED-SECRET'),false);
});

for(const http of [401,403,429,500,503]){
  test('HTTP '+http+' fails closed and does not record success',()=>{
    const h=createHarness({http});
    assert.throws(()=>h.context.weddingReconciliationTick(),new RegExp('HTTP '+http));
    assert.equal(h.storage.has('WEDDING_RECONCILE_LAST_OK_AT'),false);
  });
}

test('HTTP 200 is not sufficient: business-level ok:false fails closed',()=>{
  const h=createHarness({body:{ok:false,reason:'pending_payment'}});
  assert.throws(()=>h.context.weddingReconciliationTick(),/not accepted/);
  assert.equal(h.storage.has('WEDDING_RECONCILE_LAST_OK_AT'),false);
});

test('invalid JSON fails closed and never overwrites success timestamp',()=>{
  const h=createHarness({body:'{invalid'});
  assert.throws(()=>h.context.weddingReconciliationTick(),/invalid JSON/);
  assert.equal(h.storage.has('WEDDING_RECONCILE_LAST_OK_AT'),false);
});

test('partial worker outcome reports unresolved candidates, without exposing order IDs',()=>{
  const h=createHarness({body:{ok:true,checked:3,reconciled:1,results:[
    {orderId:'PRIVATE-ORDER-1',preserved:true,reason:'mp_http_503'},
    {orderId:'PRIVATE-ORDER-2',preserved:true,reason:'mp_payment_pending_or_approved'},
    {orderId:'PRIVATE-ORDER-3',preserved:false,released:true}
  ]}});
  const output=h.context.weddingReconciliationTick();
  assert.equal(output.checked,3);
  assert.equal(output.reconciled,1);
  assert.equal(output.preserved,2);
  assert.equal(output.unresolved,1);
  assert.equal(h.emitted.join(' ').includes('PRIVATE-ORDER'),false);
  assert.equal(h.emitted.join(' ').includes('TEST-SHARED-SECRET'),false);
});

test('one-time trigger installation is idempotent and preserves other triggers',()=>{
  const h=createHarness();
  const a=h.context.installWeddingReconciliationTrigger();
  const b=h.context.installWeddingReconciliationTrigger();
  assert.equal(a.installed,true);
  assert.equal(b.installed,false);
  assert.equal(h.activeTriggers.length,2);
  assert.equal(h.context.weddingReconciliationStatus().ownedTriggers,1);
});

test('duplicate existing triggers are not silently deleted',()=>{
  const h=createHarness({existingTriggers:2});
  assert.throws(()=>h.context.installWeddingReconciliationTrigger(),/Multiple reconciliation triggers/);
  assert.equal(h.activeTriggers.length,3);
});

test('installer refuses to create a trigger without existing auth',()=>{
  const h=createHarness({secret:''});
  assert.throws(()=>h.context.installWeddingReconciliationTrigger(),/authentication not configured/);
  assert.equal(h.activeTriggers.length,1);
});

test('rollback deletes only the wedding clock, never existing unrelated jobs',()=>{
  const h=createHarness({existingTriggers:1});
  const out=h.context.removeWeddingReconciliationTrigger();
  assert.equal(out.removed,1);
  assert.equal(h.activeTriggers.length,1);
  assert.equal(h.activeTriggers[0].getHandlerFunction(),'unrelatedPaymentHeartbeat');
  assert.equal(h.context.weddingReconciliationStatus().ownedTriggers,0);
});

test('no Apps Script lock can be held across the Worker round-trip',()=>{
  assert.equal(source.includes('LockService.getScriptLock()'),false);
  assert.equal(source.includes('ScriptApp.newTrigger(WEDDING_RECONCILE_HANDLER).timeBased().everyMinutes(5).create()'),true);
});
