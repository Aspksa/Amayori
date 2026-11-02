import test from 'node:test';
import assert from 'node:assert/strict';
import {rankMemories,memoryContext} from '../core/memory-retrieval.mjs';
const now=Date.parse('2026-11-02T00:00:00Z');
test('matches user memories, not assistant responses, and ranks relevant items',()=>{
 const rows=[
 {role:'user',content:'У Subaru Impreza обломилась передняя шпилька колеса',at:'2026-10-30T00:00:00Z'},
 {role:'assistant',content:'Subaru Impreza обломилась передняя шпилька колеса',at:'2026-11-01T00:00:00Z'},
 {role:'user',content:'Обсуждали граф памяти и настройки',at:'2026-11-01T00:00:00Z'}];
 const result=rankMemories('Subaru Impreza шпилька',{...rows}.length?rows:[],{now});
 assert.equal(result.length,1);
 assert.match(result[0].content,/Subaru/);
});
test('deduplicates and rejects unrelated or empty queries',()=>{
 const rows=[{role:'user',content:'Ремонт колеса автомобиля',at:'2026-10-01T00:00:00Z'},{role:'user',content:'Ремонт колеса автомобиля',at:'2026-10-02T00:00:00Z'}];
 assert.equal(rankMemories('ремонт колеса',rows,{now}).length,1);
 assert.equal(rankMemories(' ',rows,{now}).length,0);
 assert.match(memoryContext([]),/не найдено/);
});
