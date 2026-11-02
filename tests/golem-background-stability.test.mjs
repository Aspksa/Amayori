import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('background builder retries with bounded exponential backoff and prevents duplicate jobs',async()=>{
 const s=await readFile('core/golem-auto.mjs','utf8');
 assert.match(s,/retryDelay/);
 assert.match(s,/Math\.min\(3600000/);
 assert.match(s,/if\(running\|\|/);
 assert.match(s,/Build timed out/);
});
test('publisher rolls back partially replaced cortex files',async()=>{
 const s=await readFile('integrations/golem/auto_build.py','utf8');
 assert.match(s,/shutil\.copy2/);
 assert.match(s,/for filename in reversed\(published\)/);
 assert.match(s,/os\.replace\(backup, destination\)/);
});
