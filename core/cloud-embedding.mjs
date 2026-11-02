import {validateEndpoint} from './cloud-client.mjs';
export async function cloudEmbedding(settings,text,model){
 if(!settings.apiKey||!model)throw Error('Настройте Cloud.ru API-ключ и модель эмбеддингов');
 const u=validateEndpoint(settings.endpoint);u.pathname=u.pathname.replace(/\/chat\/completions$/,'/embeddings');
 if(!u.pathname.endsWith('/embeddings'))throw Error('Некорректный endpoint Cloud.ru');
 const response=await fetch(u,{method:'POST',headers:{Authorization:'Bearer '+settings.apiKey,'Content-Type':'application/json'},body:JSON.stringify({model,input:text}),signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw Error('Cloud.ru embeddings HTTP '+response.status);
 const embedding=(await response.json()).data?.[0]?.embedding;
 if(!Array.isArray(embedding)||embedding.length!==384||!embedding.every(Number.isFinite))throw Error('Модель должна выдавать вектор размерности 384 для текущей схемы pgvector');
 return embedding;
}
