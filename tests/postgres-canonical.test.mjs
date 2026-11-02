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
 assert.match(server,/chatHistory\(12\)/);
 assert.equal(pkg.scripts['migrate:postgres'],'node scripts/migrate-postgres.mjs');
});
