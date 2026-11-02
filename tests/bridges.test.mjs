import test from 'node:test';
import assert from 'node:assert/strict';
import {bridgeStatus,memosSearch,graphitiIngest} from '../core/bridges.mjs';
test('external bridges are optional by default',()=>{const s=bridgeStatus();assert.equal(typeof s.memos.configured,'boolean');assert.equal(typeof s.graphiti.configured,'boolean')});
test('unconfigured memory bridge does not block chat',async()=>{if(!process.env.AMAYORI_MEMOS_BRIDGE_URL)assert.deepEqual(await memosSearch('test'),{enabled:false})});
test('unconfigured graph bridge does not block chat',async()=>{if(!process.env.AMAYORI_GRAPHITI_BRIDGE_URL)assert.deepEqual(await graphitiIngest('a','b'),{enabled:false})});
