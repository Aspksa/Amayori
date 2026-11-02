import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {collectModules} from '../scripts/check-syntax.mjs';

test('the syntax check discovers project modules and skips third-party code',async()=>{
 const files=(await collectModules()).map(file=>path.relative(process.cwd(),file).split(path.sep).join('/'));
 for(const expected of ['server.mjs','core/store.mjs','core/chat-memory.mjs','public/app.js','public/golem-immersive.js','scripts/check-syntax.mjs'])
  assert.ok(files.includes(expected),'expected '+expected+' to be checked');
 assert.ok(!files.some(file=>file.startsWith('node_modules/')||file.startsWith('vendor/')),'third-party code must be skipped');
 assert.ok(files.every(file=>/\.m?js$/.test(file)));
});
