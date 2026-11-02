import test from 'node:test';
import assert from 'node:assert/strict';
import {collectChatMemory} from '../core/chat-memory.mjs';

const options = {text:'Любимое место отдыха',config:{apiKey:'test'},databaseEnabled:true,embeddingModel:'configured-model'};
const defaults = {recall:async()=>['Ранее обсуждали ремонт'],findFacts:async()=>[],memosSearch:async()=>({enabled:false})};
test('semantic recall supplies matches without shared words and deduplicates lexical matches',async()=>{
 const vector=Array(384).fill(.1);
 const result=await collectChatMemory(options,{
  ...defaults,recall:async()=>['Сиреневый парк'],
  cloudEmbedding:async(config,text,model)=>{assert.equal(text,options.text);assert.equal(model,'configured-model');return vector},
  searchMemory:async(value)=>{assert.equal(value,vector);return [{content:'Сиреневый парк',distance:.12},{content:'irrelevant',distance:.9}]},
 });
 assert.equal(result.context,'Сиреневый парк');
 assert.deepEqual(result.sources,{lexical:0,semantic:1,bridge:0});
});
test('an unavailable vector provider retains lexical recall and facts',async()=>{
 const fact={id:3,subject:'Место',predicate:'название',object:'Сиреневый парк'};
 const result=await collectChatMemory(options,{...defaults,findFacts:async()=>[fact],cloudEmbedding:async()=>{throw Error('unavailable')}});
 assert.match(result.context,/ремонт/);
 assert.deepEqual(result.facts,[fact]);
 assert.deepEqual(result.warnings,['pgvector']);
});
test('a configured memory bridge adds excerpts and an unavailable one only warns',async()=>{
 const result=await collectChatMemory(options,{...defaults,recall:async()=>[],
  cloudEmbedding:async()=>{throw Error('off')},
  memosSearch:async(query)=>{assert.equal(query,options.text);return {enabled:true,data:{memories:['Мост помнит про парк','',7]}}},
 });
 assert.equal(result.context,'Мост помнит про парк');
 assert.equal(result.sources.bridge,1);
 const failed=await collectChatMemory({...options,databaseEnabled:false},{...defaults,memosSearch:async()=>{throw Error('bridge down')}});
 assert.match(failed.context,/ремонт/);
 assert.deepEqual(failed.warnings,['memos-bridge']);
});
test('local mode and missing embedding model do not call the vector provider',async()=>{
 let calls=0;
 const deps={...defaults,cloudEmbedding:async()=>{calls++;throw Error('must not run')}};
 for(const override of [{databaseEnabled:false},{embeddingModel:undefined}]){
  const result=await collectChatMemory({...options,...override},deps);
  assert.match(result.context,/ремонт/);
 }
 assert.equal(calls,0);
});
test('memory context is bounded and rejects malformed vector results',async()=>{
 const result=await collectChatMemory(options,{
  ...defaults,recall:async()=>Array.from({length:30},(_,i)=>String(i)+'я'.repeat(1000)),
  cloudEmbedding:async()=>[],searchMemory:async()=>[{content:'bad distance',distance:null},{content:'invalid distance',distance:'bad'}],
 });
 assert.ok(result.context.length<=3000);
 assert.equal(result.sources.semantic,0);
 assert.doesNotMatch(result.context,/bad distance|invalid distance/);
});
