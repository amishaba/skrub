import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const page = readFileSync(new URL('../src/view/review.html',import.meta.url),'utf8');
const code = page.split('<script>')[1]!.split('$("filters").addEventListener')[0]!;
function review(ok = true) {
  const els:Record<string,any> = {};
  const ctx = vm.createContext({document:{getElementById:(id:string)=>els[id] ??= {innerHTML:'',textContent:'',hidden:true}},fetch:async()=>({ok})});
  vm.runInContext(code,ctx);
  const scan = JSON.parse(readFileSync(new URL('../web/scan.json',import.meta.url),'utf8'));
  vm.runInContext(`hunks=${JSON.stringify(scan.hunks)}; render();`,ctx);
  return {ctx,els,scan};
}
test('all records and code remain accessible, but naming notes never count as deletions',()=>{
  const r=review();
  assert.equal((r.els.main.innerHTML.match(/<article/g)||[]).length,r.scan.hunks.length);
  assert.equal((r.els.main.innerHTML.match(/<details>/g)||[]).length,r.scan.hunks.length);
  const note=r.scan.hunks.find((h:any)=>h.action==='comment');
  vm.runInContext(`decisions[${JSON.stringify(note.id)}]='accept';filter='reuse';render()`,r.ctx);
  assert.match(r.els.main.innerHTML,/<b>7<\/b> suggested deletion lines/);
  assert.match(r.els.main.innerHTML,/<b>0<\/b> to delete/);
  assert.equal((r.els.main.innerHTML.match(/data-act="accept"/g)||[]).length,1);
});
test('failed save does not claim a successful review decision',async()=>{
  const r=review(false);
  await assert.rejects(vm.runInContext(`decide(${JSON.stringify(r.scan.hunks[0].id)},'accept')`,r.ctx),/could not save choice/);
  assert.equal(vm.runInContext('Object.keys(decisions).length',r.ctx),0);
});
