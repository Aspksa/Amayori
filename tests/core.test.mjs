import test from 'node:test';
import assert from 'node:assert/strict';
import {tokenize} from '../core/store.mjs';
test('extracts unique Russian and Latin words',()=>assert.deepEqual(tokenize('Память память Graphiti Graphiti'),['память','graphiti']));
test('tokenize drops short words and bounds the term list',()=>{
 assert.deepEqual(tokenize('да нет чашка'),['чашка']);
 assert.equal(tokenize(Array.from({length:60},(_,i)=>'слово'+i).join(' ')).length,40);
});
