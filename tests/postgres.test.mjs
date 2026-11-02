import test from 'node:test';
import assert from 'node:assert/strict';
import {databaseStatus,searchMemory,insertMemory} from '../core/postgres.mjs';
test('PostgreSQL integration is optional without DATABASE_URL',async()=>{
 if(process.env.AMAYORI_DATABASE_URL)return;
 assert.deepEqual(await databaseStatus(),{enabled:false,connected:false});
 assert.deepEqual(await searchMemory(Array(384).fill(0)),[]);
 await insertMemory('user','offline test');
});
test('reject malformed vector without touching database',async()=>{
 await assert.rejects(()=>searchMemory([1,2,3]),/Invalid embedding/);
 await assert.rejects(()=>insertMemory('user','test',[Infinity]),/384 finite/);
});
