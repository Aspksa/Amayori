import test from 'node:test';
import assert from 'node:assert/strict';
import {tokenize} from '../core/store.mjs';
import {cloudChat} from '../core/cloud.mjs';
test('extracts unique Russian and Latin words',()=>assert.deepEqual(tokenize('Память память Graphiti Graphiti'),['память','graphiti']));
test('Cloud.ru rejects missing credentials',async()=>await assert.rejects(()=>cloudChat({endpoint:'https://foundation-models.api.cloud.ru/v1/chat/completions'},[]),/ключ/));
test('Cloud.ru rejects foreign endpoint',async()=>await assert.rejects(()=>cloudChat({endpoint:'https://evil.example/api',apiKey:'x',model:'x'},[]),/Cloud.ru/));
