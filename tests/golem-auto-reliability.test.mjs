import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('Golem background job exposes status and validates complete outputs',async()=>{
 const job=await readFile('core/golem-auto.mjs','utf8');
 assert.match(job,/getGolemBuildStatus/);
 assert.match(job,/golem_vectors\.npy/);
 assert.match(job,/metadata\.json/);
 assert.match(job,/running=true/);
 assert.match(job,/lastFailure=Date\.now/);
});
test('Golem stages complete artifacts and publishes metadata last',async()=>{
 const builder=await readFile('integrations/golem/auto_build.py','utf8');
 assert.match(builder,/tempfile\.mkdtemp/);
 assert.match(builder,/os\.replace/);
 assert.ok(builder.indexOf('"golem_vectors.npy", "golem_cortex.json", "metadata.json"')>0);
});
test('Golem settings show build state',async()=>{
 const server=await readFile('server.mjs','utf8');
 const ui=await readFile('public/index.html','utf8');
 assert.match(server,/\/api\/golem\/build-status/);
 assert.match(ui,/id="golem-build-status"/);
});
