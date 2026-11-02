import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {setTimeout as sleep} from 'node:timers/promises';
const port=57475;
test('local server responds to health and rejects unsafe requests',async()=>{
 const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:String(port)},stdio:'pipe'});
 try{
  let ready=false;
  for(let i=0;i<35;i++){if(child.exitCode!==null)break;try{const r=await fetch('http://127.0.0.1:'+port+'/api/health');if(r.ok){ready=true;break}}catch{}await sleep(200)}
  assert.ok(ready,'server must start');
  const base='http://127.0.0.1:'+port;
  const h=await fetch(base+'/api/health');assert.equal((await h.json()).ok,true);
  const js=await fetch(base+'/knowledge-map.js');assert.equal(js.status,200);
  const missing=await fetch(base+'/not-found');assert.equal(missing.status,404);
  const bad=await fetch(base+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:''})});assert.equal(bad.status,400);
  const blocked=await fetch(base+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json','Origin':'https://evil.example'},body:'{}'});assert.equal(blocked.status,403);
  const invalidType=await fetch(base+'/api/chat',{method:'POST',headers:{'Content-Type':'text/plain'},body:'{}'});assert.equal(invalidType.status,415);
  const settings=await fetch(base+'/api/settings');assert.equal(settings.status,200);assert.equal(Object.hasOwn(await settings.json(),'apiKey'),false);
 }finally{child.kill()}
});
