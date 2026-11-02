import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('Golem keeps original Three.js interface and uses Amayori chat data',async()=>{
 const html=await readFile('vendor/Project_Golem/app/index.html','utf8');
 const builder=await readFile('integrations/golem/build.py','utf8');
 assert.match(html,/THREE\.WebGLRenderer/);
 assert.match(html,/OrbitControls/);
 assert.match(builder,/DATA \/ "chats\.json"/);
 assert.match(builder,/SentenceTransformer/);
 assert.match(builder,/umap\.UMAP/);
 assert.match(builder,/"source": "chats\.json"/);
});
test('Golem preview and semantic search use same archive',async()=>{
 const code=await readFile('core/golem-data.mjs','utf8');
 assert.match(code,/chats\.json/);
 assert.match(code,/sourceStat\.mtimeMs>cortexStat\.mtimeMs/);
 assert.match(code,/startsWith\('chat-'\)/);
});
