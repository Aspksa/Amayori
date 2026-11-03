import {createHash,randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import {loadCanonicalChats,appendCanonicalExchange} from './postgres.mjs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const dir=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','data');
const file=name=>path.join(dir,name);
export const postgresCanonical=()=>Boolean(process.env.AMAYORI_DATABASE_URL);
export async function chatHistory(limit=null){if(postgresCanonical()){const rows=await loadCanonicalChats(limit);if(rows.length===0){const old=await read('chats.json',[]);if(old.length)throw Error('Existing local chats require migration: npm.cmd run migrate:postgres')}return rows}const data=(await read('chats.json',[])).map((m,i)=>({...m,id:m.id||'local-'+createHash('sha256').update(JSON.stringify([i,m.role,m.at,m.content])).digest('hex').slice(0,24)}));return limit===null?data:data.slice(-limit)}
export async function refreshGolemSnapshot(){if(!postgresCanonical())return;const chats=await loadCanonicalChats();await write('chats.json',chats);await rebuildChatGraph(chats)}
// chats.json and graph.json are derived from the canonical store, so a burst of
// messages costs one rebuild instead of one per message. Set
// AMAYORI_DERIVED_REFRESH_MS=0 to rebuild immediately, as tests do.
const derivedDelay=()=>Math.max(0,Number(process.env.AMAYORI_DERIVED_REFRESH_MS??5000)||0);
let derivedTimer=null;
async function refreshDerived(){if(postgresCanonical())return refreshGolemSnapshot();await rebuildChatGraph(await read('chats.json',[]))}
export async function scheduleDerivedRefresh(){
 const delay=derivedDelay();
 if(delay===0){try{await refreshDerived()}catch(e){console.warn('Derived memory refresh failed:',e.message)}return}
 if(derivedTimer)return;
 derivedTimer=setTimeout(()=>{derivedTimer=null;void refreshDerived().catch(e=>console.warn('Derived memory refresh failed:',e.message))},delay);
 derivedTimer.unref?.();
}
export async function read(name,fallback){try{return JSON.parse(await fs.readFile(file(name),'utf8'))}catch(e){if(e.code==='ENOENT')return fallback;throw e}}
export async function write(name,data){await fs.mkdir(dir,{recursive:true});const dest=file(name),temp=dest+'.tmp';await fs.writeFile(temp,JSON.stringify(data,null,2),'utf8');await fs.rename(temp,dest)}

function makeChatGraph(messages){const nodes=new Map(),edges=new Map();for(const m of messages.slice(-4000)){if(m.role!=='user')continue;const words=tokenize(m.content);for(const word of words){const n=nodes.get(word)||{id:word,label:word,count:0};n.count++;nodes.set(word,n)}for(let i=1;i<words.length;i++){const a=words[i-1],b=words[i],id=a+'|'+b;if(!edges.has(id))edges.set(id,{id,source:a,target:b})}}const kept=[...nodes.values()].sort((a,b)=>b.count-a.count).slice(0,1500),ids=new Set(kept.map(x=>x.id));return {nodes:kept,edges:[...edges.values()].filter(e=>ids.has(e.source)&&ids.has(e.target)).slice(-4000)}}
async function rebuildChatGraph(messages){await write('graph.json',makeChatGraph(messages))}
let queue=Promise.resolve();
export function serialized(fn){const next=queue.then(fn);queue=next.catch(()=>{});return next}
export function tokenize(s){return [...new Set(String(s).toLowerCase().match(/[\p{L}\p{N}]{4,}/gu)||[])].slice(0,40)}
export async function recall(text){const terms=tokenize(text);if(!terms.length)return [];const messages=await chatHistory(postgresCanonical()?1500:null);return messages.map((m,i)=>{if(m.role!=='user')return {m,i,score:0};const lower=m.content.toLowerCase();return {m,i,score:terms.reduce((n,t)=>n+(lower.includes(t)?1:0),0)}}).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||b.i-a.i).slice(0,4).sort((a,b)=>a.i-b.i).map(({m,i})=>m.content.slice(0,350)+(messages[i+1]?.role==='assistant'?' | Ответ: '+messages[i+1].content.slice(0,150):''))}
export async function record(user,assistant){return serialized(async()=>{
 if(postgresCanonical()){await chatHistory(1);const messageId=await appendCanonicalExchange(user,assistant);await scheduleDerivedRefresh();return {messageId}}
 const messages=await read('chats.json',[]),now=new Date().toISOString();
 const messageId=randomUUID();
 messages.push({id:messageId,role:'user',content:user,at:now},{id:randomUUID(),role:'assistant',content:assistant,at:now});
 await write('chats.json',messages);await scheduleDerivedRefresh();return {messageId};
})}
