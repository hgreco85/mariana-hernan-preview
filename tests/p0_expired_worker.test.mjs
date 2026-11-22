import test from 'node:test';
import assert from 'node:assert/strict';
import worker, {reconcileExpiredReservations} from '../worker/src/index.js';

const ORDER='ORD-V09-076-1795180380105', MP='ORD01M7WHDQWGB7N07E0ZZBY9FF55';
const env={MP_ACCESS_TOKEN:'TEST-MOCK-ONLY', SHARED_SECRET:'MOCK-SECRET', APPS_SCRIPT_URL:'https://example.invalid'};
function fixture(opts={}){
  const calls=[], responses=[];
  let releases=0, canceled=false;
  const details=Object.assign({id:MP,external_reference:ORDER,status:opts.status||'created',transactions:{payments:opts.payments||[]}},opts.details||{});
  const mockFetch=async (url,init={})=>{
    calls.push({url,method:init.method||'GET',key:init.headers&&init.headers['X-Idempotency-Key']});
    if(opts.mpHttp)return new Response('{}',{status:opts.mpHttp});
    if(url.endsWith('/cancel')){
      if(opts.cancelHttp)return new Response(JSON.stringify({error:'cancel refused'}),{status:opts.cancelHttp});
      canceled=true;
      return Response.json({id:MP,status:opts.cancelStatus||'canceled'});
    }
    const copy=structuredClone(details);
    if(canceled)copy.status=opts.postCancelStatus||'canceled';
    return Response.json(copy);
  };
  const mockPost=async (_env,payload)=>{
    responses.push(payload);
    if(payload.type==='getExpiredOrders'){
      return {status:200,data:{ok:true,reservationMinutes:15,expired:opts.empty?[]:[{
        orderId:ORDER,experienceId:'V09-076',mpOrderId:opts.internal?'':MP
      }]}};
    }
    if(payload.type==='reconcileOrder'){
      if(opts.gasError)return {status:200,data:{ok:false,error:'another payment pending'}};
      releases++;
      return {status:200,data:{ok:true,released:releases===1,alreadyReleased:releases>1}};
    }
    throw Error('unknown mock action');
  };
  return {
    run:()=>reconcileExpiredReservations(env,{fetchImpl:mockFetch,postToAppsScriptImpl:mockPost}),
    calls,responses,get releases(){return releases}
  };
}
test('cron is present and calls reconciliation; no new scheduler needed',()=>{
 assert.match(worker.scheduled.toString(),/reconcileExpiredReservations\(env\)/);
});
test('no expired reservations means no payment API calls',async()=>{
 const f=fixture({empty:true}),r=await f.run();
 assert.equal(r.checked,0);assert.equal(f.calls.length,0);assert.equal(f.releases,0);
});
test('expired created order is canceled with idempotency and readback before release',async()=>{
 const f=fixture(),r=await f.run();
 assert.equal(r.reconciled,1);assert.equal(r.results[0].released,true);
 assert.deepEqual(f.calls.map(x=>x.method),['GET','POST','GET']);
 assert.match(f.calls[1].url,/\/cancel$/);
 assert.ok(f.calls[1].key);
 const proof=f.responses.find(x=>x.type==='reconcileOrder');
 assert.equal(proof.mpStatus,'canceled');assert.equal(proof.mpOrderId,MP);
 assert.equal(proof.externalReference,ORDER);
});
test('already canceled externally can be released after a verified read',async()=>{
 const f=fixture({status:'canceled'}),r=await f.run();
 assert.equal(r.reconciled,1);assert.equal(f.calls.length,1);assert.equal(f.releases,1);
});
test('rejected payment and terminal canceled order is safe',async()=>{
 const f=fixture({status:'canceled',payments:[{status:'rejected'}]}),r=await f.run();
 assert.equal(r.reconciled,1);assert.equal(f.releases,1);
});
for(const payment of ['approved','pending','in_process','authorized','processed','refunded','']){
 test('payment '+JSON.stringify(payment)+' is protected',async()=>{
   const f=fixture({status:'processing',payments:[{status:payment}]}),r=await f.run();
   assert.equal(r.reconciled,0);assert.equal(f.releases,0);
   assert.equal(r.results[0].preserved,true);
   assert.equal(f.calls.filter(x=>x.method==='POST').length,0);
 });
}
test('processed order cannot be released even if transaction list empty',async()=>{
 const f=fixture({status:'processed'}),r=await f.run();
 assert.equal(r.reconciled,0);assert.equal(f.calls.length,1);
});
for(const detail of ['waiting_capture','waiting_retry']){
 test('action_required with '+detail+' remains held',async()=>{
  const f=fixture({status:'action_required',details:{status_detail:detail}}),r=await f.run();
  assert.equal(r.reconciled,0);assert.equal(f.releases,0);assert.equal(f.calls.length,1);
 });
}
test('failed cancellation is never misinterpreted as success',async()=>{
 const f=fixture({cancelHttp:500}),r=await f.run();
 assert.equal(r.reconciled,0);assert.equal(f.releases,0);
 assert.equal(r.results[0].reason,'mp_cancel_http_500');
});
test('200 cancellation without canceled status is held',async()=>{
 const f=fixture({cancelStatus:'processing'}),r=await f.run();
 assert.equal(r.reconciled,0);assert.equal(f.releases,0);
});
test('external MP 404 or network errors fail closed',async()=>{
 const f=fixture({mpHttp:404}),r=await f.run();
 assert.equal(r.reconciled,0);assert.equal(f.releases,0);
});
test('mismatched external reference fails closed',async()=>{
 const f=fixture({details:{external_reference:'ORDER-OTHER'}}),r=await f.run();
 assert.equal(r.reconciled,0);assert.equal(f.releases,0);
});
test('if Apps Script refuses atomic reconciliation, result is not reported released',async()=>{
 const f=fixture({status:'canceled',gasError:true}),r=await f.run();
 assert.equal(r.reconciled,0);assert.equal(r.results[0].preserved,true);
});
test('internal-only abandoned reservation can be released but never cancels MP',async()=>{
 const f=fixture({internal:true}),r=await f.run();
 assert.equal(r.reconciled,1);assert.equal(f.calls.length,0);
 assert.equal(f.responses.at(-1).mpStatus,'no_mp_order');
});
test('a duplicate reconciliation is idempotent in Apps Script',async()=>{
 const f=fixture({status:'canceled'}),a=await f.run(),b=await f.run();
 assert.equal(a.reconciled,1);assert.equal(b.reconciled,0);
 assert.equal(b.results[0].alreadyReleased,true);
});
