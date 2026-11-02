import test from 'node:test';
import assert from 'node:assert/strict';
import {bridgeStatus,graphitiIngest} from '../core/bridges.mjs';
test('the external bridge is optional by default',()=>{const s=bridgeStatus();assert.equal(typeof s.graphiti.configured,'boolean');assert.equal(Object.keys(s).length,1)});
test('unconfigured graph bridge does not block chat',async()=>{if(!process.env.AMAYORI_GRAPHITI_BRIDGE_URL)assert.deepEqual(await graphitiIngest('a','b'),{enabled:false})});
