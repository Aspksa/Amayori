import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {setTimeout as sleep} from 'node:timers/promises';
import {subscribe,emit,listenerCount} from '../core/events.mjs';

const fake=()=>({written:[],write(chunk){this.written.push(chunk)}});

test('the activity channel delivers events and releases clients',()=>{
 const client=fake();
 const stop=subscribe(client);
 assert.equal(typeof stop,'function');
 emit('recall',{factIds:['7']});
 assert.equal(client.written.length,1);
 const [payload]=client.written;
 assert.ok(payload.startsWith('data: '));
 assert.ok(payload.endsWith('\n\n'));
 const parsed=JSON.parse(payload.slice(6).trim());
 assert.equal(parsed.type,'recall');
 assert.deepEqual(parsed.factIds,['7']);
 assert.equal(typeof parsed.at,'number');
 stop();
 emit('recall',{factIds:['8']});
 assert.equal(client.written.length,1,'a released client receives nothing more');
});

test('a broken client is dropped and the channel is bounded',()=>{
 const broken={write(){throw Error('socket closed')}};
 const healthy=fake();
 const release=[subscribe(broken),subscribe(healthy)];
 emit('token',{chars:3});
 assert.equal(healthy.written.length,1);
 emit('token',{chars:4});
 assert.equal(healthy.written.length,2,'the healthy client keeps receiving');
 const extra=[];
 for(let i=0;i<12;i++)extra.push(subscribe(fake()));
 assert.ok(extra.includes(null),'the channel refuses an unbounded number of windows');
 for(const stop of [...release,...extra])if(stop)stop();
 assert.equal(listenerCount(),0);
});

test('the Golem stream endpoint keeps an event-stream connection open',async()=>{
 const port=57476;
 const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:String(port),AMAYORI_GOLEM_AUTO_BUILD:'0'},stdio:'pipe'});
 try{
  let ready=false;
  for(let i=0;i<35;i++){if(child.exitCode!==null)break;try{const r=await fetch('http://127.0.0.1:'+port+'/api/health');if(r.ok){ready=true;break}}catch{}await sleep(200)}
  assert.ok(ready,'server must start');
  const controller=new AbortController();
  const response=await fetch('http://127.0.0.1:'+port+'/api/golem/stream',{signal:controller.signal});
  assert.equal(response.status,200);
  assert.match(response.headers.get('content-type'),/text\/event-stream/);
  assert.equal(response.headers.get('cache-control'),'no-store');
  const reader=response.body.getReader();
  const first=await reader.read();
  assert.match(new TextDecoder().decode(first.value),/retry: \d+/);
  controller.abort();
 }finally{child.kill()}
});
