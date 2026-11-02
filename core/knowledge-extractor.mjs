import {cloudChat} from './cloud-client.mjs';
const clean=x=>typeof x==='string'?x.trim().slice(0,500):'';
export async function extractKnowledge(settings,text){
 const prompt='Извлеки только явно сказанные пользователем проверяемые факты. Не додумывай. Ответь только JSON: {"facts":[{"subject":"...","predicate":"...","object":"..."}]}. Максимум 5 фактов. Если фактов нет, верни {"facts":[]}.';
 const raw=await cloudChat(settings,[{role:'system',content:prompt},{role:'user',content:text}]);
 let parsed;try{parsed=JSON.parse(raw.replace(/^\x60\x60\x60(?:json)?\s*|\s*\x60\x60\x60$/g,''))}catch{throw Error('Cloud.ru вернул некорректный JSON фактов')}
 if(!Array.isArray(parsed.facts))throw Error('Cloud.ru не вернул список фактов');
 return parsed.facts.slice(0,5).map(f=>({subject:clean(f.subject),predicate:clean(f.predicate),object:clean(f.object)})).filter(f=>f.subject&&f.predicate&&f.object);
}
