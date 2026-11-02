import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {missingDependencies} from '../scripts/check-dependencies.mjs';

test('launcher detects an incomplete dependency installation including missing Three.js ESM build',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'amayori-packages-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 await writeFile(path.join(dir,'package.json'),'{}');
 assert.deepEqual(missingDependencies(dir),['pg','three']);
 await mkdir(path.join(dir,'node_modules','pg'),{recursive:true});
 await writeFile(path.join(dir,'node_modules','pg','index.js'),'');
 assert.deepEqual(missingDependencies(dir),['three']);
 await mkdir(path.join(dir,'node_modules','three','build'),{recursive:true});
 await writeFile(path.join(dir,'node_modules','three','build','three.module.js'),'');
 assert.deepEqual(missingDependencies(dir),[]);
});
