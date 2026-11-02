const fallback='https://foundation-models.api.cloud.ru/v1/chat/completions';
export function validateEndpoint(value){const u=new URL(value||fallback);if(u.protocol!=='https:'||!(u.hostname==='cloud.ru'||u.hostname.endsWith('.cloud.ru'))||u.username||u.password)throw Error('Разрешены только HTTPS адреса Cloud.ru');return u}
function auth(settings){if(!settings.apiKey)throw Error('Укажите API-ключ Cloud.ru');return {'Authorization':'Bearer '+settings.apiKey}}
export function modelsEndpoint(endpoint){const u=validateEndpoint(endpoint);if(!u.pathname.endsWith('/chat/completions'))throw Error('Endpoint должен оканчиваться на /chat/completions');u.pathname=u.pathname.replace(/\/chat\/completions$/,'/models');return u}
const ERRORS={400:'Некорректный запрос или модель',401:'Неверный API-ключ',403:'Нет доступа к модели или проекту',404:'Модель или endpoint не найдены',429:'Превышен лимит запросов',500:'Ошибка сервиса Cloud.ru',503:'Сервис Cloud.ru временно недоступен'};
function httpError(status){return Object.assign(Error('Cloud.ru HTTP '+status+': '+(ERRORS[status]||'Запрос отклонён')),{cloudStatus:status})}
// Streaming is used only to report progress. The caller still gets the whole
// answer, so the /api/chat contract is unchanged and one request is still billed.
export async function streamChat(url,settings,model,messages,onChunk){
 const response=await fetch(url,{method:'POST',headers:{...auth(settings),'Content-Type':'application/json',Accept:'text/event-stream'},body:JSON.stringify({model,messages,stream:true}),signal:AbortSignal.timeout(60000)});
 if(!response.ok)throw httpError(response.status);
 const kind=(response.headers.get('content-type')||'').toLowerCase();
 if(!kind.includes('event-stream')||!response.body){
  const data=await response.json().catch(()=>null);
  const whole=data?.choices?.[0]?.message?.content;
  return typeof whole==='string'&&whole.trim()?whole:null;
 }
 const decoder=new TextDecoder();let buffer='',answer='';
 for await(const part of response.body){
  buffer+=decoder.decode(part,{stream:true});
  let cut;
  while((cut=buffer.indexOf('\n'))!==-1){
   const line=buffer.slice(0,cut).trim();buffer=buffer.slice(cut+1);
   if(!line.startsWith('data:'))continue;
   const payload=line.slice(5).trim();
   if(payload==='[DONE]'){buffer='';break}
   let parsed;try{parsed=JSON.parse(payload)}catch{continue}
   const piece=parsed.choices?.[0]?.delta?.content;
   if(typeof piece==='string'&&piece){answer+=piece;try{onChunk(piece)}catch{}}
  }
  if(answer.length>200000)break;
 }
 return answer.trim()?answer:null;
}
async function request(url,settings,options={}){const headers={...auth(settings),...(options.headers||{})};let response;try{response=await fetch(url,{...options,headers,signal:AbortSignal.timeout(60000)})}catch(e){if(e.name==='TimeoutError')throw Error('Cloud.ru не ответил за 60 секунд');throw Error('Ошибка соединения с Cloud.ru: '+e.message)}if(!response.ok)throw httpError(response.status);return response.json()}
export async function cloudModels(settings){const data=await request(modelsEndpoint(settings.endpoint),settings);if(!Array.isArray(data.data))throw Error('Список моделей имеет неожиданный формат');return data.data.filter(m=>typeof m.id==='string').map(m=>({id:m.id,name:m.metadata?.name||m.name||m.id,type:m.metadata?.type||'unknown'})).slice(0,300)}
export async function cloudChat(settings,messages,model=settings.model,onChunk=null){
 if(!model)throw Error('Выберите модель Cloud.ru');
 const url=validateEndpoint(settings.endpoint);
 if(onChunk&&process.env.AMAYORI_CLOUD_STREAM!=='0'){
  try{const streamed=await streamChat(url,settings,model,messages,onChunk);if(streamed)return streamed}
  catch(error){if(error.cloudStatus)throw error;console.warn('Cloud.ru streaming unavailable:',error.message)}
 }
 const data=await request(url,settings,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model,messages,stream:false})});
 const answer=data.choices?.[0]?.message?.content;
 if(typeof answer!=='string'||!answer.trim())throw Error('Cloud.ru вернул пустой ответ');
 return answer;
}
