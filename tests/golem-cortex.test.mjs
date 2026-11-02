import test from 'node:test';
import assert from 'node:assert/strict';
import {cortexFromGraph,searchCortex} from '../core/golem-cortex.mjs';
test('cortex is deterministic and retains source labels',()=>{const graph={nodes:[{id:'memory',label:'Память',count:3},{id:'chat',label:'Диалог',count:1}]};const a=cortexFromGraph(graph);assert.deepEqual(a,cortexFromGraph(graph));assert.equal(a[0].title,'Память');assert.equal(a[0].pos.length,3)});
test('query highlights matching node indexes',()=>{const nodes=cortexFromGraph({nodes:[{id:'x',label:'Память'},{id:'y',label:'Диалог'}]});assert.deepEqual(searchCortex(nodes,'память'),[0]);assert.deepEqual(searchCortex(nodes,'несуществующее'),[])});
