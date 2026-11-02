// Retrieval of past dialogue with recency, lexical relevance and explicit uncertainty.
// Chat history is data, never privileged instructions.
import {chatHistory,tokenize} from './store.mjs';
const STOP=new Set(['этого','когда','потом','только','очень','который','какой','сейчас','будет','можно','пожалуйста','меня','тебя','просто','нужно']);
export function rankMemories(query,rows,{limit=5,now=Date.now()}={}){
 const terms=tokenize(query).filter(t=>!STOP.has(t));
 if(!terms.length)return [];
 const scored=[];
 for(let i=0;i<rows.length;i++){
  const m=rows[i];
  if(!m||m.role!=='user'||typeof m.content!=='string')continue;
  const tokens=new Set(tokenize(m.content));
  const hits=terms.filter(t=>tokens.has(t)).length;
  if(!hits)continue;
  const age=Date.parse(m.at||'');
  const days=Number.isFinite(age)?Math.max(0,(now-age)/86400000):365;
  const relevance=hits/Math.sqrt(Math.max(1,terms.length)*Math.max(1,tokens.size));
  const score=relevance+Math.min(.25,hits*.04)+.12/(1+days/30);
  scored.push({index:i,content:m.content.slice(0,500),at:Number.isFinite(age)?new Date(age).toISOString():null,score});
 }
 scored.sort((a,b)=>b.score-a.score||b.index-a.index);
 const unique=new Set();
 return scored.filter(x=>{const key=x.content.toLowerCase().trim();if(unique.has(key))return false;unique.add(key);return true}).slice(0,Math.max(0,Math.min(10,limit)));
}
export async function retrieveMemories(query,{limit=5,historyLimit=5000}={}){
 const rows=await chatHistory(historyLimit);
 return rankMemories(query,rows,{limit});
}
export function memoryContext(memories){
 if(!memories.length)return 'Подходящих воспоминаний не найдено.';
 return memories.map((m,i)=>'['+(i+1)+'] '+(m.at||'дата неизвестна')+' | '+m.content.replace(/[\r\n]+/g,' ').slice(0,500)).join('\n').slice(0,3000);
}
