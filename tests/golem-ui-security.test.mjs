import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('Golem renders memory titles as text, never injected HTML',async()=>{
 const html=await readFile('vendor/Project_Golem/app/index.html','utf8');
 assert.match(html,/log\.textContent\s*=/);
 assert.doesNotMatch(html,/log\.innerHTML\s*=/);
});
test('Golem handles search before cortex is ready and honors persisted preferences',async()=>{
 const html=await readFile('vendor/Project_Golem/app/index.html','utf8');
 assert.match(html,/if \(!geometry\?\.attributes\?\.activationTime\) return/);
 assert.match(html,/api\/golem\/settings/);
 assert.match(html,/controls\.autoRotate=cfg\.autoRotate/);
 assert.match(html,/uNodeScale/);
});
