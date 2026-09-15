import test from 'node:test';
import assert from 'node:assert/strict';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import { respond } from "../src/view/server.ts";
async function request(url:string,cwd=process.cwd()) {
  let status=0,body='';
  const res={writeHead:(s:number)=>{status=s;},end:(b:string|Buffer)=>{body=String(b);}};
  await respond({url} as IncomingMessage,res as unknown as ServerResponse,cwd);
  return {status,body};
}
test('homepage is the demo, /sample is the baked review, and /review and saved root query URLs use only live APIs',async()=>{
  const home=await request('/');
  assert.equal(home.status,200);assert.match(home.body,/class="pr"/);
  const sample=await request('/sample');
  assert.equal(sample.status,200);assert.match(sample.body,/__SKRUB_DEMO__/);
  for (const url of ['/review','/?id=scan-saved']) {
    const live=await request(url);
    assert.equal(live.status,200);assert.doesNotMatch(live.body,/__SKRUB_DEMO__/);assert.match(live.body,/fetch\("\/api\/scans"\)/);
  }
  assert.equal((await request('/scan.json')).status,200);
  for (const icon of ['/favicon.svg','/favicon-32.png','/apple-touch-icon.png']) assert.equal((await request(icon)).status,200,icon);
  assert.equal((await request('/missing')).status,404);
});
test('no saved scans and unknown scans remain distinct from the sample',async()=>{
  const cwd=await mkdtemp(path.join(tmpdir(),'skrub-view-'));
  try {
    const scans=await request('/api/scans',cwd);
    assert.deepEqual(JSON.parse(scans.body),{latest:null,scans:[]});
    assert.equal((await request('/api/scan?id=missing',cwd)).status,400);
  } finally {await rm(cwd,{recursive:true,force:true});}
});
