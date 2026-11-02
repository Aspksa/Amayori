import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {cortexFromGraph,searchCortex} from './golem-cortex.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const folder=path.join(root,'data','golem');
const python=process.env.AMAYORI_GOLEM_PYTHON || (process.platform==='win32'?'py':'python3');
export async function getCortex(graph){
 try{
  const [raw,metadata]=await Promise.all([fs.readFile(path.join(folder,'golem_cortex.json'),'utf8'),fs.readFile(path.join(folder,'metadata.json'),'utf8')]);
  const nodes=JSON.parse(raw),info=JSON.parse(metadata);
  if(!Array.isArray(nodes)||!nodes.every(n=>Array.isArray(n.pos)&&n.pos.length===3))throw Error('Invalid cortex');
  return {nodes,mode:'semantic',projection:info.projection,model:info.model};
 }catch(e){
  if(e.code!=='ENOENT')console.warn('Golem cortex fallback:',e.message);
  return {nodes:cortexFromGraph(graph),mode:'preview',projection:'deterministic-not-UMAP'};
 }
}
async function semanticSearch(query){
 return new Promise((resolve,reject)=>{
  const args=python==='py'?['-3',path.join(root,'integrations','golem','search.py')]:[path.join(root,'integrations','golem','search.py')];
  const child=spawn(python,args,{cwd:root,stdio:['pipe','pipe','pipe'],windowsHide:true});
  let stdout='',stderr='',settled=false;
  const timer=setTimeout(()=>{child.kill();finish(new Error('Semantic search timeout'))},45000);
  function finish(error,value){if(settled)return;settled=true;clearTimeout(timer);if(error)reject(error);else resolve(value)}
  child.on('error',finish);
  child.stdout.on('data',d=>{stdout+=d;if(stdout.length>100000){child.kill();finish(new Error('Search output too large'))}});
  child.stderr.on('data',d=>{stderr+=d;if(stderr.length>10000)stderr=stderr.slice(-10000)});
  child.on('close',code=>{if(code!==0)return finish(new Error(stderr.trim()||'Semantic search failed'));try{finish(null,JSON.parse(stdout))}catch(e){finish(e)}});
  child.stdin.on('error',()=>{});
  child.stdin.end(query);
 });
}
export async function queryCortex(nodes,query,mode='preview'){
 if(mode==='semantic'){
  try{
   const data=await semanticSearch(query);
   const indices=(data.indices||[]).filter(i=>Number.isInteger(i)&&i>=0&&i<nodes.length);
   return {indices,scores:(data.scores||[]).slice(0,indices.length),mode:'semantic'};
  }catch(e){console.warn('Golem semantic search unavailable:',e.message)}
 }
 return {indices:searchCortex(nodes,query),mode:'keyword'};
}
