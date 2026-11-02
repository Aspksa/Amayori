import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
const port=58000+Math.floor(Math.random()*1000);
const base='http://127.0.0.1:'+port;
test('original Golem routes and settings work through Amayori',async t=>{
 const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:String(port)},stdio:'ignore'});
 t.after(()=>child.kill());
 let ready=false;
 for(let i=0;i<40;i++){try{const r=await fetch(base+'/api/health');if(r.ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}
 assert.equal(ready,true,'server must start');
 const html=await fetch(base+'/golem-original');assert.equal(html.status,200);assert.match(await html.text(),/three/);
 const cortex=await fetch(base+'/golem_cortex.json');assert.equal(cortex.status,200);assert.ok(Array.isArray(await cortex.json()));
 const query=await fetch(base+'/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:'память'})});assert.equal(query.status,200);assert.ok(Array.isArray((await query.json()).indices));
 const settings=await fetch(base+'/api/golem/settings');assert.equal(settings.status,200);assert.equal((await settings.json()).defaultView,'original');
 const invalid=await fetch(base+'/api/golem/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({defaultView:'evil',autoRotate:true,nodeSize:2})});assert.equal(invalid.status,400);
});
