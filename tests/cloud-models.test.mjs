import test from 'node:test';
import assert from 'node:assert/strict';
import {cloudModels} from '../core/cloud-client.mjs';
test('Cloud.ru model list uses metadata.name and works with bearer key',async t=>{
 const previous=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{
  assert.equal(String(url),'https://foundation-models.api.cloud.ru/v1/models');
  assert.equal(options.headers.Authorization,'Bearer local-test');
  return {ok:true,json:async()=>({data:[{id:'ai-sage/example',metadata:{name:'Пример модели'}}]})};
 };
 t.after(()=>{globalThis.fetch=previous});
 assert.deepEqual(await cloudModels({apiKey:'local-test'}),[{id:'ai-sage/example',name:'Пример модели',type:'unknown'}]);
});
