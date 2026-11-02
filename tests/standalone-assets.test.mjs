import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {Script} from 'node:vm';
import {setTimeout as delay} from 'node:timers/promises';

test('home has no embedded Golem and every active page module is served',async t=>{
 const port=59000+Math.floor(Math.random()*500),base='http://127.0.0.1:'+port;
 const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:String(port),AMAYORI_GOLEM_AUTO_BUILD:'0'},stdio:'ignore'});
 t.after(()=>child.kill());
 let ready=false;
 for(let i=0;i<40;i++){try{if((await fetch(base+'/api/health')).ok){ready=true;break}}catch{}await delay(100)}
 assert.ok(ready);
 const home=await(await fetch(base+'/')).text();
 assert.match(home,/href="\/golem" target="_blank"/);
 assert.doesNotMatch(home,/golem-webgl|golem-immersive\.js|id="brain"|id="golem-view"/);
 const standalone=await(await fetch(base+'/golem')).text();
 assert.match(standalone,/id="brain"/);
 const classicSources=[];
 const urls=[...new Set([...home.matchAll(/<script[^>]*src="([^"]+)"/g),...standalone.matchAll(/<script[^>]*src="([^"]+)"/g)].map(m=>m[1]))];
 urls.push('/golem-state.js','/golem-immersive.js','/three.module.js');
 for(const url of urls){const response=await fetch(base+url);assert.equal(response.status,200,url);assert.match(response.headers.get('content-type'),/javascript/,url);if(home.includes('src="'+url+'"'))classicSources.push(await response.text())}
 assert.doesNotThrow(()=>new Script(classicSources.join('\n')),'home scripts must not redeclare global lexical bindings');
 const three=await(await fetch(base+'/three.module.js')).text();
 for(const match of three.matchAll(/from ['"]([.][^'"]+)['"]/g)){
  const url=new URL(match[1],base+'/three.module.js');
  assert.equal((await fetch(url)).status,200,url.href);
 }
});
