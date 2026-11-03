import test from 'node:test';
import assert from 'node:assert/strict';
import {buildGolemNetwork} from '../core/golem-network.mjs';
test('links facts, entities, topics and source messages',()=>{
 const result=buildGolemNetwork([{id:7,subject:'Amayori',predicate:'использует',object:'PostgreSQL',topics:['Проект / Память'],status:'active',sources:[{messageId:'42',excerpt:'source'}]}]);
 assert.deepEqual(new Set(result.nodes.map(n=>n.type)),new Set(['fact','entity','topic','message']));
 assert.equal(result.edges.length,4);
 assert.equal(result.stats.alerts,0);
});
test('detects review candidates, superseded versions and missing provenance',()=>{
 const result=buildGolemNetwork([{id:1,status:'candidate'},{id:2,status:'superseded'},{id:3,status:'active',source:'cloudru-extracted'}]);
 assert.deepEqual(result.alerts.map(a=>a.type),['conflict','outdated','missing-source']);
});
test('deduplicates entities and limits input',()=>{
 const result=buildGolemNetwork([{id:1,subject:'A',object:'B'},{id:2,subject:'a',object:'C'}],{limit:1});
 assert.equal(result.stats.truncated,true);
 assert.equal(result.stats.facts,1);
});
