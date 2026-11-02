import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
test('local API rejects invalid Origin and content type',async()=>{
 const port=57518;
 const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:String(port)},stdio:'ignore'});
 try{
  const url='http://127.0.0.1:'+port;
  let ready=false;
  for(let i=0;i<40;i++){try{if((await fetch(url+'/api/health')).ok){ready=true;break}}catch{}await delay(150)}
  assert.ok(ready);
  const badOrigin=await fetch(url+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://example.invalid'},body:'{}'});
  assert.equal(badOrigin.status,403);
  const badType=await fetch(url+'/api/chat',{method:'POST',headers:{'Content-Type':'text/plain'},body:'{}'});
  assert.equal(badType.status,415);
  const cortex=await fetch(url+'/api/golem/cortex');
  assert.equal(cortex.status,200);
  assert.ok(Array.isArray((await cortex.json()).nodes));
 }finally{child.kill()}
});
