import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('PostgreSQL canonical mode and migration are explicit',async()=>{
 const store=await readFile('core/store.mjs','utf8');
 const server=await readFile('server.mjs','utf8');
 const pkg=JSON.parse(await readFile('package.json','utf8'));
 assert.match(store,/loadCanonicalChats/);
 assert.match(store,/appendCanonicalExchange/);
 assert.match(store,/require migration/);
 assert.match(server,/chatHistory\(\{limit:12/,'контекст ответа остаётся ограниченным 12 сообщениями');
 assert.equal(pkg.scripts['migrate:postgres'],'node scripts/migrate-postgres.mjs');
});
test('a recorded exchange does not re-read the whole archive',async()=>{
 const store=await readFile('core/store.mjs','utf8');
 assert.match(store,/scheduleDerivedRefresh/);
 assert.doesNotMatch(store,/count:\(await chatHistory\(\)\)\.length/,'the unused count forced a second full-table read');
 assert.doesNotMatch(store,/await rebuildChatGraph\(messages\)/,'graph rebuilds are coalesced, not run per message');
});
