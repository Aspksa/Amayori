import test from 'node:test';
import assert from 'node:assert/strict';
import {modelsEndpoint,validateEndpoint,cloudChat} from '../core/cloud-client.mjs';
test('model endpoint derives from chat endpoint',()=>assert.equal(modelsEndpoint('https://foundation-models.api.cloud.ru/v1/chat/completions').pathname,'/v1/models'));
test('Cloud.ru endpoint rejects foreign hosts',()=>assert.throws(()=>validateEndpoint('https://notcloud.ru/v1/chat/completions'),/Cloud.ru/));
test('Cloud.ru endpoint rejects insecure protocol',()=>assert.throws(()=>validateEndpoint('http://foundation-models.api.cloud.ru/v1/chat/completions'),/Cloud.ru/));
test('chat requires a selected model',async()=>assert.rejects(()=>cloudChat({apiKey:'test'},[]),/модель/));
test('a missing API key is reported as such, not as a connection failure',async()=>{
 const error=await cloudChat({apiKey:'',model:'test'},[]).then(()=>null,e=>e);
 assert.match(error.message,/Укажите API-ключ/);
 assert.doesNotMatch(error.message,/Ошибка соединения/);
});
