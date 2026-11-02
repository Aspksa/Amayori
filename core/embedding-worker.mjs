import {pendingChatEmbeddings,storeChatEmbedding,embeddingProgress} from './postgres.mjs';
import {cloudEmbedding} from './cloud-embedding.mjs';
let running=false, lastError=null, lastRun=null;
export const embeddingJobStatus=()=>({running,lastError,lastRun});
export async function runEmbeddingBatch(settings,model,{limit=3}={}){
 if(running)return {busy:true};
 if(!model||!settings?.apiKey)return {configured:false};
 running=true;lastError=null;
 let indexed=0;
 try{
  const pending=await pendingChatEmbeddings(limit);
  for(const item of pending){const vector=await cloudEmbedding(settings,item.content,model);await storeChatEmbedding(item,vector);indexed++}
  lastRun=new Date().toISOString();
  return {indexed,...await embeddingProgress()};
 }catch(e){lastError=e.message;throw e}finally{running=false}
}
