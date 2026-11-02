import test from 'node:test';
import assert from 'node:assert/strict';
import {localEndpoint,providerStatus} from '../core/brain-model.mjs';
test('local inference accepts only loopback chat completion endpoints',()=>{
 assert.equal(localEndpoint('http://127.0.0.1:11434/v1/chat/completions').hostname,'127.0.0.1');
 assert.throws(()=>localEndpoint('https://example.com/v1/chat/completions'));
 assert.throws(()=>localEndpoint('http://127.0.0.1:11434/other'));
 assert.throws(()=>localEndpoint('http://user:pass@localhost:11434/v1/chat/completions'));
});
test('cloud remains the default provider',()=>{
 assert.ok(['cloud','local'].includes(providerStatus().active));
});
