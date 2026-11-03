// Conversations, paging, search and forgetting all touch the archive, so these
// run against a throwaway data directory instead of the real one.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const home = await fs.mkdtemp(path.join(os.tmpdir(), 'amayori-store-'));
process.env.AMAYORI_DATA_DIR = home;
process.env.AMAYORI_DERIVED_REFRESH_MS = '0';
delete process.env.AMAYORI_DATABASE_URL;

const store = await import('../core/store.mjs');
const {knowledge} = await import('../core/knowledge-repository.mjs');

test.after(async () => { await fs.rm(home, {recursive: true, force: true}); });

test('an exchange lands in a conversation and the archive pages and searches',async()=>{
 const first=await store.record('помню про сад','Записал про сад');
 assert.ok(first.conversationId,'диалог должен появиться сам');
 const list=await store.conversations();
 assert.equal(list.length,1);
 assert.equal(list[0].messages,2);

 const other=await store.createConversation('Работа');
 assert.equal(other.title,'Работа');
 await store.record('вопрос про сервер','Ответ про сервер',other.id);
 assert.equal((await store.conversations()).length,2);

 const inOther=await store.chatHistory({limit:50,conversationId:other.id});
 assert.equal(inOther.length,2,'история фильтруется по диалогу');
 assert.ok(inOther.every(m=>String(m.conversation)===String(other.id)));

 const found=await store.chatHistory({limit:50,query:'сад'});
 assert.equal(found.length,2,'поиск идёт по всему архиву и охватывает обе роли');
 assert.ok(found.every(m=>/сад/.test(m.content)));
 assert.equal((await store.chatHistory({limit:50,query:'сервер'})).length,2);
 assert.equal((await store.chatHistory({limit:50,query:'такого нет'})).length,0);

 for(let i=0;i<6;i++)await store.record('сообщение '+i,'ответ '+i,other.id);
 const page=await store.chatHistory({limit:4,offset:0,conversationId:other.id});
 assert.equal(page.length,4);
 assert.equal(page.total,14,'страница знает общее число');
 const older=await store.chatHistory({limit:4,offset:4,conversationId:other.id});
 assert.equal(older.length,4);
 assert.notDeepEqual(older.map(m=>m.id),page.map(m=>m.id),'смещение отдаёт другие сообщения');
});

test('deleting a message keeps other ids and takes its knowledge with it',async()=>{
 const added=await store.record('кот живёт дома','Понял');
 await knowledge.save([{subject:'кот',predicate:'живёт',object:'дома'}],
  {kind:'cloudru-extracted',messageId:String(added.messageId),excerpt:'кот живёт дома'});
 const before=await knowledge.list({});
 assert.ok(before.facts.some(f=>String(f.source_message_id)===String(added.messageId)));

 const others=(await store.chatHistory({limit:100})).filter(m=>m.id!==added.messageId).map(m=>m.id);
 const removed=await store.removeMessages([added.messageId]);
 assert.deepEqual(removed.messageIds,[added.messageId]);
 const after=await store.chatHistory({limit:100});
 assert.ok(!after.some(m=>m.id===added.messageId),'сообщение удалено');
 for(const id of others)assert.ok(after.some(m=>m.id===id),'остальные идентификаторы не поехали: '+id);

 const forgotten=await knowledge.forget({messages:[String(added.messageId)]});
 assert.equal(forgotten.removed.length,1,'знание, извлечённое только из него, удаляется');
 const left=await knowledge.list({});
 assert.ok(!left.facts.some(f=>String(f.source_message_id)===String(added.messageId)));
});

test('deleting a conversation removes exactly its messages',async()=>{
 const doomed=await store.createConversation('На удаление');
 await store.record('секрет','ответ',doomed.id);
 await store.record('ещё секрет','ответ',doomed.id);
 const totalBefore=(await store.chatHistory({limit:500})).total;
 const result=await store.removeConversation(doomed.id);
 assert.equal(result.messageIds.length,4);
 const totalAfter=(await store.chatHistory({limit:500})).total;
 assert.equal(totalAfter,totalBefore-4);
 assert.ok(!(await store.conversations()).some(c=>c.id===doomed.id));
 assert.equal((await store.chatHistory({limit:50,conversationId:doomed.id})).length,0);
});
