import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=path.join(root,'data','chats.json');
const folder=path.join(root,'data','golem');
const files=['golem_cortex.json','golem_vectors.npy','metadata.json'];
const python=process.env.AMAYORI_GOLEM_PYTHON || (process.platform==='win32'?'py':'python3');
let running=false,lastFailure=0,failures=0;
const retryDelay=()=>Math.min(3600000,60000*2**Math.min(failures,6));
let status={state:'idle',nodes:0,updatedAt:null,error:null};
export function getGolemBuildStatus(){return {...status,running};}
export async function checkGolemBrain(){
 if(running||process.env.AMAYORI_GOLEM_AUTO_BUILD==='0'||Date.now()-lastFailure<retryDelay())return;
 const src=await fs.stat(source).catch(()=>null);
 if(!src||src.size<5)return;
 const stats=await Promise.all(files.map(n=>fs.stat(path.join(folder,n)).catch(()=>null)));
 let fresh=stats.every(x=>x&&x.mtimeMs>=src.mtimeMs);
 if(fresh){try{const meta=JSON.parse(await fs.readFile(path.join(folder,'metadata.json'),'utf8'));fresh=meta.source==='chats.json';if(fresh){status={state:'ready',nodes:meta.nodes||0,updatedAt:new Date(stats[0].mtimeMs).toISOString(),error:null};return;}}catch{fresh=false}}
 running=true;status={...status,state:'building',error:null};
 const script=path.join(root,'integrations','golem','auto_build.py');
 const args=python==='py'?['-3',script]:[script];
 const child=spawn(python,args,{cwd:root,windowsHide:true,stdio:['ignore','ignore','pipe']});
 let stderr='',finished=false;
 const timeout=setTimeout(()=>{child.kill();done('Build timed out after 20 minutes')},1200000);
 const done=(error)=>{
  if(finished)return;finished=true;clearTimeout(timeout);running=false;
  if(error){failures++;lastFailure=Date.now();status={...status,state:'error',error:String(error).slice(-500)};console.warn('Golem auto build:',error);}
  else{failures=0;lastFailure=0;status={...status,state:'ready',updatedAt:new Date().toISOString(),error:null};void fs.readFile(path.join(folder,'metadata.json'),'utf8').then(x=>{status.nodes=JSON.parse(x).nodes||0}).catch(()=>{});}
 };
 child.stderr.on('data',d=>{stderr=(stderr+d.toString()).slice(-3000)});
 child.on('error',e=>done(e.message));
 child.on('close',code=>done(code===0?null:(stderr||'Exit code '+code)));
}
export function startGolemBrainAutomation(){
 void checkGolemBrain().catch(e=>console.warn('Golem check:',e.message));
 const timer=setInterval(()=>void checkGolemBrain().catch(e=>console.warn('Golem check:',e.message)),60000);
 timer.unref();
}
