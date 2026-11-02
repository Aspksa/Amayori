import test from 'node:test';
import assert from 'node:assert/strict';
import {validateExample} from '../scripts/export-reviewed-dataset.mjs';
test('only explicitly approved examples are exported',()=>{
 assert.throws(()=>validateExample({instruction:'Hello',response:'Hi'}),/approved/);
 assert.deepEqual(validateExample({approved:true,instruction:' Hello ',response:' Hi '}).messages,[{role:'user',content:'Hello'},{role:'assistant',content:'Hi'}]);
});
test('detect common secrets and invalid input',()=>{
 assert.throws(()=>validateExample({approved:true,instruction:'password=verySecretPassword',response:'ok'}),/secret/);
 assert.throws(()=>validateExample({approved:true,instruction:' ',response:'ok'}),/required/);
});
