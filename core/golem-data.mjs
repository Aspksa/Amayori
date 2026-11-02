import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {cortexFromGraph,searchCortex} from './golem-cortex.mjs';
const folder=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../data/golem');
export async function getCortex(graph){try{const [raw,metadata]=await Promise.all([fs.readFile(path.join(folder,'golem_cortex.json'),'utf8'),fs.readFile(path.join(folder,'metadata.json'),'utf8')]);const nodes=JSON.parse(raw);const info=JSON.parse(metadata);if(!Array.isArray(nodes)||!nodes.every(n=>Array.isArray(n.pos)&&n.pos.length===3))throw Error('Invalid cortex');return {nodes,mode:'semantic',projection:info.projection,model:info.model}}catch(e){if(e.code!=='ENOENT')console.warn('Golem cortex fallback:',e.message);return {nodes:cortexFromGraph(graph),mode:'preview',projection:'deterministic-not-UMAP'}}}
export async function queryCortex(nodes,query){return {indices:searchCortex(nodes,query),mode:'keyword'}} 
