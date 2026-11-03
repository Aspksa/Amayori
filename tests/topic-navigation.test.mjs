import test from "node:test";
import assert from "node:assert/strict";
import "../public/topic-navigation.js";
import {groupConversations, listConversations} from "../core/conversations.mjs";
const N = globalThis.AmayoriTopicNavigation;

test("folder preferences recover from malformed input and keep one pin per canonical name", () => {
  for (const value of [null, [], 4, "bad", {pinned:"Amayori"}])
    assert.deepEqual(N.normalize(value), {version:1,pinned:[]});
  const initial = {pinned:[" Amayori ","AMAYORI",null,{},"", "bad\nname", "x".repeat(101), "Работа"]};
  const before = structuredClone(initial);
  const prefs = N.normalize(initial);
  assert.deepEqual(prefs.pinned,["Amayori","Работа"]);
  assert.deepEqual(initial,before,"normalization does not mutate saved data");
  assert.deepEqual(N.toggle(prefs,"amayori").pinned,["Работа"]);
  assert.deepEqual(prefs.pinned,["Amayori","Работа"]);
  assert.equal(N.normalize({pinned:Array.from({length:205},(_,i)=>"Тема "+i)}).pinned.length,200);
});

test("folder search includes child paths and combines with pins and actual attention without duplicates", () => {
  const overview = {roots:["Amayori","Личное","Работа"],folders:[
    {path:"Amayori",name:"Amayori",children:["Amayori / Дизайн","Amayori / Сервер"],attention:2},
    {path:"Amayori / Дизайн",name:"Дизайн",children:[],attention:1},
    {path:"Личное",name:"Личное",children:["Личное / Сон"],attention:0},
    {path:"Работа",name:"Работа",children:[],attention:1},
  ]};
  const prefs={pinned:["Работа","несуществующая тема"]};
  const all=N.select(overview,{prefs});
  assert.deepEqual(all.rows.map(r=>r.path),["Работа","Amayori","Личное"]);
  assert.deepEqual(all.counts,{all:3,pinned:1,attention:2});
  const search=N.select(overview,{query:"AMAYORI дизайн"});
  assert.deepEqual(search.rows.map(r=>r.path),["Amayori"]);
  assert.deepEqual(search.rows[0].matchedChildren,["Amayori / Дизайн"]);
  assert.deepEqual(N.select(overview,{query:"дизайн сервер"}).rows,[],"terms must match the same path");
  assert.deepEqual(N.select(overview,{prefs,filter:"attention"}).rows.map(r=>r.path),["Работа","Amayori"]);
  assert.deepEqual(N.select(overview,{prefs,filter:"pinned",query:"дизайн"}).rows,[]);
  assert.deepEqual(overview.roots,["Amayori","Личное","Работа"]);
});

test("conversation matches near the end of long messages and inside code remain visible in snippets", () => {
  for (const content of ["Вводный текст ".repeat(60)+"Искомое значение", "```js\n"+"let a = 1; ".repeat(40)+"const искомое = true;\n```"]){
    const groups=groupConversations([{id:"one",role:"user",content,at:"2026-01-01"}]);
    const result=listConversations(groups,{q:"искомое"});
    assert.equal(result.total,1);
    assert.equal(result.conversations[0].matchMessageId,"one");
    assert.match(result.conversations[0].snippet,/искомое/iu);
    assert.ok(result.conversations[0].snippet.length<=161);
  }
});
