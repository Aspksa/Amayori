import {createHash,randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import {loadCanonicalChats,appendCanonicalExchange,listConversations as pgConversations,createConversation as pgCreateConversation,renameConversation as pgRenameConversation,deleteConversation as pgDeleteConversation,deleteCanonicalMessages} from './postgres.mjs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
// The folder was hard-coded, so nothing that touches storage could be tested
// without writing into the real archive. AMAYORI_DATA_DIR also lets a person
// keep their memory on another disk.
const dir=process.env.AMAYORI_DATA_DIR
 ?path.resolve(process.env.AMAYORI_DATA_DIR)
 :path.join(path.dirname(fileURLToPath(import.meta.url)),'..','data');
const file=name=>path.join(dir,name);
export const postgresCanonical=()=>Boolean(process.env.AMAYORI_DATABASE_URL);
const localId=(m,i)=>m.id||'local-'+createHash('sha256').update(JSON.stringify([i,m.role,m.at,m.content])).digest('hex').slice(0,24);
// Index-derived ids shift when a message is removed, so they are written down
// before anything can be deleted.
async function localMessages(){
 const raw=await read('chats.json',[]);
 let changed=false;
 const data=raw.map((m,i)=>{const id=localId(m,i);if(!m.id)changed=true;return {...m,id}});
 if(changed)await write('chats.json',data);
 return data;
}
const options=(value)=>typeof value==='number'||value===null||value===undefined?{limit:value??null}:value;
export async function chatHistory(request=null){
 const {limit=null,offset=0,conversationId=null,query=''}=options(request);
 if(postgresCanonical()){
  const rows=await loadCanonicalChats({limit,offset,conversationId,query});
  if(rows.length===0&&limit===null&&!conversationId&&!query){const old=await read('chats.json',[]);if(old.length)throw Error('Existing local chats require migration: npm.cmd run migrate:postgres')}
  return rows;
 }
 let data=await localMessages();
 if(conversationId!=null)data=data.filter(m=>String(m.conversation??'')===String(conversationId));
 if(query){const needle=String(query).toLocaleLowerCase('ru');data=data.filter(m=>m.content.toLocaleLowerCase('ru').includes(needle))}
 if(limit===null)return data;
 const total=data.length;
 const size=Math.max(1,Math.min(500,Number(limit)||100)),skip=Math.max(0,Number(offset)||0);
 const end=Math.max(0,total-skip);
 const page=data.slice(Math.max(0,end-size),end);
 page.total=total;
 return page;
}
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
export async function record(user,assistant,conversationId=null){return serialized(async()=>{
 if(postgresCanonical()){await chatHistory(1);const added=await appendCanonicalExchange(user,assistant,conversationId);await scheduleDerivedRefresh();return added}
 const messages=await localMessages(),now=new Date().toISOString();
 const conversations=await read('conversations.json',[]);
 let target=conversationId==null?null:String(conversationId);
 if(target==null){
  const recent=[...conversations].sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')))[0];
  target=recent?String(recent.id):null;
 }
 if(target==null||!conversations.some(c=>String(c.id)===target)){
  target=target||randomUUID();
  conversations.push({id:target,title:'Общий диалог',createdAt:now,updatedAt:now});
 }
 for(const conversation of conversations)if(String(conversation.id)===target)conversation.updatedAt=now;
 const messageId=randomUUID();
 messages.push({id:messageId,role:'user',content:user,at:now,conversation:target},
  {id:randomUUID(),role:'assistant',content:assistant,at:now,conversation:target});
 await write('chats.json',messages);
 await write('conversations.json',conversations);
 await scheduleDerivedRefresh();
 return {messageId,conversationId:target};
})}

// Conversations: one continuous journal made work and personal talk inseparable.
export async function conversations(){
 if(postgresCanonical())return pgConversations();
 const messages=await localMessages();
 const stored=await read('conversations.json',[]);
 const counts=new Map();
 for(const message of messages){const key=String(message.conversation??'');counts.set(key,(counts.get(key)||0)+1)}
 const list=stored.map(c=>({id:String(c.id),title:c.title||'Диалог',messages:counts.get(String(c.id))||0,
  createdAt:c.createdAt||'',updatedAt:c.updatedAt||c.createdAt||''}));
 const loose=counts.get('')||0;
 if(loose)list.push({id:'',title:'Без диалога',messages:loose,createdAt:'',updatedAt:''});
 return list.sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
}
export async function createConversation(title){
 const clean=String(title||'Новый диалог').trim().slice(0,120)||'Новый диалог';
 if(postgresCanonical())return pgCreateConversation(clean);
 return serialized(async()=>{
  const stored=await read('conversations.json',[]),now=new Date().toISOString();
  const entry={id:randomUUID(),title:clean,createdAt:now,updatedAt:now};
  stored.push(entry);
  await write('conversations.json',stored);
  return {...entry,messages:0};
 });
}
export async function renameConversation(id,title){
 const clean=String(title||'').trim().slice(0,120);
 if(!clean)throw Error('Укажите название диалога');
 if(postgresCanonical())return pgRenameConversation(id,clean);
 return serialized(async()=>{
  const stored=await read('conversations.json',[]);
  let found=false;
  for(const conversation of stored)if(String(conversation.id)===String(id)){conversation.title=clean;found=true}
  if(found)await write('conversations.json',stored);
  return found;
 });
}
export async function removeConversation(id){
 if(postgresCanonical()){const result=await pgDeleteConversation(id);await scheduleDerivedRefresh();return result}
 return serialized(async()=>{
  const messages=await localMessages();
  const messageIds=messages.filter(m=>String(m.conversation??'')===String(id)).map(m=>m.id);
  const kept=messages.filter(m=>String(m.conversation??'')!==String(id));
  const stored=(await read('conversations.json',[])).filter(c=>String(c.id)!==String(id));
  await write('chats.json',kept);
  await write('conversations.json',stored);
  await scheduleDerivedRefresh();
  return {removed:messageIds.length>0||true,messageIds};
 });
}
export async function removeMessages(ids){
 const wanted=new Set((Array.isArray(ids)?ids:[ids]).map(String).filter(Boolean));
 if(!wanted.size)return {messageIds:[]};
 if(postgresCanonical()){
  const numeric=[...wanted].filter(id=>/^[1-9][0-9]*$/.test(id));
  const result=await deleteCanonicalMessages(numeric);
  await scheduleDerivedRefresh();
  return result;
 }
 return serialized(async()=>{
  const messages=await localMessages();
  const kept=messages.filter(m=>!wanted.has(String(m.id)));
  const removed=messages.filter(m=>wanted.has(String(m.id))).map(m=>m.id);
  if(removed.length){await write('chats.json',kept);await scheduleDerivedRefresh()}
  return {messageIds:removed};
 });
}
