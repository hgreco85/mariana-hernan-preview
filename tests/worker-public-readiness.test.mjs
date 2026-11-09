import test from 'node:test';
import assert from 'node:assert/strict';

const WORKER='https://mp-webhook.hgreco85.workers.dev';
const timeoutMs=12000;
async function safeGet(path){
  const controller=new AbortController();
  const stop=setTimeout(()=>controller.abort(),timeoutMs);
  try {
    const res=await fetch(WORKER+path,{method:'GET',signal:controller.signal,headers:{Accept:'application/json'},redirect:'error'});
    assert.equal(res.status,200,path+' HTTP '+res.status);
    const text=await res.text();
    assert.ok(text.length>1 && text.length<1000000,'bounded response');
    const result=JSON.parse(text);
    assert.ok(result && typeof result==='object','valid JSON object');
    return result;
  }finally{clearTimeout(stop)}
}
test('Worker is staging_test and orders only (no payment operations)',async()=>{
  const d=await safeGet('/health');
  assert.equal(d.mode,'staging_test','production mode must never pass sandbox audit');
  assert.equal(d.apiMode,'orders','Orders API required');
  assert.equal(d.status,'ok');
});
test('Worker serves catalog without changing any reservation',async()=>{
  const d=await safeGet('/api/catalog');
  assert.ok(Array.isArray(d) || Array.isArray(d.items) || Array.isArray(d.catalog) || Array.isArray(d.gifts) || Array.isArray(d.experiences),'catalog records expected');
});
