import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

for (const path of ['Code.js','preview.html']) {
  test(path + ': visual copy and genuine-paid ordering', () => {
    const source = readFileSync(path,'utf8');
    assert.match(source,/Esta experiencia ya forma parte de nuestro viaje/);
    assert.match(source,/Esta experiência já faz parte da nossa viagem/);
    assert.match(source,/if\(m==='trip'&&a\.length>=4\)/);
    const snippet = "if(m==='trip'&&a.length>=4){const paidIndex=a.findIndex(isGifted);if(paidIndex>=0){const paid=a.splice(paidIndex,1)[0];a.splice(3,0,paid);}}";
    assert.ok(source.includes(snippet), 'only feature a server-reported gifted card');
    for (const paidAt of [-1,0,1,4,6]) {
      const items = Array.from({length:7},(_,i)=>({id:String(i), status:i===paidAt?'Regalada y cobrada':'Disponible'}));
      const ctx={a:items,m:'trip',isGifted:x=>x.status==='Regalada y cobrada'};
      vm.runInNewContext(snippet,ctx);
      assert.equal(ctx.a.length,7);
      if (paidAt>=0) assert.equal(ctx.a[3].id,String(paidAt));
      else assert.deepEqual(ctx.a.map(x=>x.id),['0','1','2','3','4','5','6']);
    }
    const manual={a:Array.from({length:7},(_,i)=>({id:String(i),status:i===6?'Regalada y cobrada':'Disponible'})),m:'priceAsc',isGifted:x=>x.status==='Regalada y cobrada'};
    vm.runInNewContext(snippet,manual);
    assert.equal(manual.a[6].id,'6','other sorting modes are not reordered');
  });
}
