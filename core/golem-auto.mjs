import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=path.join(root,'data','chats.json');
const target=path.join(root,'data','golem','golem_cortex.json');
const python=process.env.AMAYORI_GOLEM_PYTHON || (process.platform==='win32'?'py':'python3');
let running=false;
let lastFailure=0;
export async function checkGolemBrain(){
 if(running||process.env.AMAYORI_GOLEM_AUTO_BUILD==='0'||Date.now()-lastFailure<300000)return;
 const src=await fs.stat(source).catch(()=>null);
 if(!src||src.size<5)return;
 const dst=await fs.stat(target).catch(()=>null);
 if(dst&&dst.mtimeMs>=src.mtimeMs)return;
 running=true;
 const args=python==='py'?['-3',path.join(root,'integrations','golem','auto_build.py')]:[path.join(root,'integrations','golem','auto_build.py')];
 const child=spawn(python,args,{cwd:root,windowsHide:true,stdio:['ignore','ignore','pipe']});
 let stderr='';
 const timeout=setTimeout(()=>child.kill(),1200000);
 child.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-3000)});
 child.on('error',err=>{lastFailure=Date.now();console.warn('Golem auto build unavailable:',err.message)});
 child.on('close',code=>{clearTimeout(timeout);running=false;if(code!==0){lastFailure=Date.now();console.warn('Golem auto build failed:',stderr||code)}else console.log('Golem semantic cortex up to date')});
}
export function startGolemBrainAutomation(){
 void checkGolemBrain().catch(err=>console.warn('Golem auto check:',err.message));
 const timer=setInterval(()=>void checkGolemBrain().catch(err=>console.warn('Golem auto check:',err.message)),60000);
 timer.unref();
}
