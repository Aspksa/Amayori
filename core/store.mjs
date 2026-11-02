import fs from 'node:fs/promises';
import {loadCanonicalChats,appendCanonicalExchange} from './postgres.mjs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const dir=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','data');
const file=name=>path.join(dir,name);
export const postgresCanonical=()=>Boolean(process.env.AMAYORI_DATABASE_URL);
export async function chatHistory(limit=null){if(postgresCanonical()){const rows=await loadCanonicalChats(limit);if(rows.length===0){const old=await read('chats.json',[]);if(old.length)throw Error('Existing local chats require migration: npm.cmd run migrate:postgres')}return rows}const data=await read('chats.json',[]);return limit===null?data:data.slice(-limit)}
export async function refreshGolemSnapshot(){if(!postgresCanonical())return;await write('chats.json',await loadCanonicalChats())}
export async function read(name,fallback){try{return JSON.parse(await fs.readFile(file(name),'utf8'))}catch(e){if(e.code==='ENOENT')return fallback;throw e}}
export async function write(name,data){await fs.mkdir(dir,{recursive:true});const dest=file(name),temp=dest+'.tmp';await fs.writeFile(temp,JSON.stringify(data,null,2),'utf8');await fs.rename(temp,dest)}
let queue=Promise.resolve();
export function serialized(fn){const next=queue.then(fn);queue=next.catch(()=>{});return next}
export function tokenize(s){return [...new Set(String(s).toLowerCase().match(/[\p{L}\p{N}]{4,}/gu)||[])].slice(0,40)}
export async function recall(text){const messages=await chatHistory();const terms=tokenize(text);return messages.filter(m=>m.role==='user'&&terms.some(t=>m.content.toLowerCase().includes(t))).slice(-4).map(m=>m.content.slice(0,500))}
export async function record(user,assistant){return serialized(async()=>{if(postgresCanonical()){await chatHistory(1);await appendCanonicalExchange(user,assistant);try{await refreshGolemSnapshot()}catch(e){console.warn('Golem snapshot refresh failed:',e.message)}return (await chatHistory()).length}const messages=await read('chats.json',[]);const now=new Date().toISOString();messages.push({role:'user',content:user,at:now},{role:'assistant',content:assistant,at:now});await write('chats.json',messages);const graph=await read('graph.json',{nodes:[],edges:[]});const words=tokenize(user);for(const word of words){let node=graph.nodes.find(n=>n.id===word);if(node)node.count++;else graph.nodes.push({id:word,label:word,count:1})}for(let i=1;i<words.length;i++){const a=words[i-1],b=words[i],id=a+'|'+b;if(!graph.edges.some(e=>e.id===id))graph.edges.push({id,source:a,target:b})}graph.nodes=graph.nodes.slice(-1500);const ids=new Set(graph.nodes.map(n=>n.id));graph.edges=graph.edges.filter(e=>ids.has(e.source)&&ids.has(e.target)).slice(-4000);await write('graph.json',graph);return messages.length})}
