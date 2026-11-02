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
import {constellationName, inventConstellationName, isKnownConstellation} from '../public/golem-state.js';

test('constellations never reuse a sky people already named',()=>{
 for(const known of ['Орион','орион','Лев','Большая Медведица','Orion','ursa major','Дракон','Кассиопея'])
  assert.ok(isKnownConstellation(known),known+' должно считаться известным');
 assert.equal(isKnownConstellation('Амаёри'),false);
 for(const known of ['Орион','Лев','Дракон','Cygnus','Большая Медведица']){
  const name=constellationName(known,['память','голем','факты'],3);
  assert.notEqual(name.toLocaleLowerCase('ru'),known.toLocaleLowerCase('ru'));
  assert.equal(isKnownConstellation(name),false,'придуманное имя '+name+' не должно быть земным созвездием');
 }
});

test('a name from the memory is kept, and invented names are stable',()=>{
 assert.equal(constellationName('Амаёри',['а','б'],1),'Амаёри');
 const long='Очень длинное название сущности памяти, которое не влезет';
 assert.ok(constellationName(long,['а'],1).length<=24);
 const words=['память','голем','факты'];
 assert.equal(inventConstellationName(words,7),inventConstellationName(words,7));
 assert.notEqual(inventConstellationName(words,7),inventConstellationName(words,8));
 for(let salt=0;salt<80;salt++)
  assert.equal(isKnownConstellation(inventConstellationName(['звезда'+salt,'узел'],salt)),false);
});
