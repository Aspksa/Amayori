import test from 'node:test';
import assert from 'node:assert/strict';
import {createRenderState,normalizeGolemSettings} from '../public/golem-state.js';

test('GPU loss keeps fallback active until a successful frame, including recovery',()=>{
 let time=0;
 const transitions=[];
 const state=createRenderState({now:()=>time,onChange:(ready)=>transitions.push(ready)});
 assert.equal(state.check(),false);
 state.frame();assert.equal(state.check(),true);
 state.fail('context lost');assert.equal(state.check(),false);
 state.fail('context restored');assert.equal(state.check(),false);
 state.frame();assert.equal(state.check(),true);
 time=7000;assert.equal(state.check(),false);
 state.frame();assert.equal(state.check(),true);
 assert.deepEqual(transitions,[true,false,false,true,false,true]);
});
test('saved false rotation and valid sizes survive preference normalization',()=>{
 assert.deepEqual(normalizeGolemSettings({autoRotate:false,nodeSize:5}),{autoRotate:false,nodeSize:5});
 assert.deepEqual(normalizeGolemSettings({autoRotate:'false',nodeSize:100}),{autoRotate:true,nodeSize:2});
});
