import {cloudChat} from './cloud-client.mjs';

// Local inference is opt-in and loopback-only; Cloud.ru remains the default.
export function localEndpoint(raw=process.env.AMAYORI_LOCAL_ENDPOINT||'http://127.0.0.1:11434/v1/chat/completions'){
 const u=new URL(raw);
 if(u.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.username||u.password||u.search||u.hash||!u.pathname.endsWith('/v1/chat/completions'))
  throw Error('Локальная модель должна использовать адрес localhost и /v1/chat/completions');
 return u;
}
export function providerStatus(){
 return {active:process.env.AMAYORI_MODEL_PROVIDER==='local'?'local':'cloud',localConfigured:!!process.env.AMAYORI_LOCAL_MODEL,localEndpoint:localEndpoint().origin};
}
export async function brainChat(settings,messages,model){
 if(process.env.AMAYORI_MODEL_PROVIDER!=='local')return cloudChat(settings,messages,model);
 const selected=process.env.AMAYORI_LOCAL_MODEL;
 if(!selected)throw Error('Укажите AMAYORI_LOCAL_MODEL для локальной модели');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),120000);
 try{
  const response=await fetch(localEndpoint(),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:selected,messages,stream:false}),signal:controller.signal,redirect:'error'});
  if(!response.ok)throw Error('Локальная модель HTTP '+response.status);
  const data=await response.json();
  const answer=data.choices?.[0]?.message?.content;
  if(typeof answer!=='string'||!answer.trim())throw Error('Локальная модель вернула пустой ответ');
  return answer;
 }finally{clearTimeout(timer)}
}
