// A backup that quietly saves nothing is worse than none, so the failure path
// is checked as carefully as the happy one.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const run = promisify(execFile);
const home = await fs.mkdtemp(path.join(os.tmpdir(), 'amayori-backup-'));
const data = path.join(home, 'data'), vault = path.join(home, 'backups');
process.env.AMAYORI_DATA_DIR = data;
process.env.AMAYORI_BACKUP_DIR = vault;
const {backup, list, restore} = await import('../scripts/backup.mjs');

test.after(async () => { await fs.rm(home, {recursive: true, force: true}); });

test('a backup without a database says so instead of implying success',async()=>{
 await fs.mkdir(data,{recursive:true});
 await fs.writeFile(path.join(data,'chats.json'),'[{"role":"user","content":"привет"}]','utf8');
 const made=await backup({url:'',now:new Date('2026-11-03T10:20:30.400Z')});
 assert.equal(made.data,'saved');
 assert.equal(made.database,'not-configured','без базы это должно быть видно в описи');
 assert.match(made.name,/^\d{8}-\d{6}-\d{3}$/);
 const copy=await fs.readFile(path.join(vault,made.name,'data','chats.json'),'utf8');
 assert.match(copy,/привет/);
 const saved=await list();
 assert.ok(saved.some(entry=>entry.name===made.name&&entry.database==='not-configured'));
});

test('an unreachable database is reported as a failure, not skipped',async()=>{
 const made=await backup({url:'postgresql://nobody:nobody@127.0.0.1:1/absent',now:new Date()});
 assert.equal(made.database,'failed','недоступная база обязана попасть в опись как отказ');
 assert.ok(made.reason.length>0,'должна быть причина отказа');
 const {stdout,stderr,code}=await run(process.execPath,['scripts/backup.mjs'],
  {env:{...process.env,AMAYORI_DATABASE_URL:'postgresql://nobody:nobody@127.0.0.1:1/absent'}})
  .then(r=>({...r,code:0}),e=>({stdout:e.stdout||'',stderr:e.stderr||'',code:e.code}));
 assert.notEqual(code,0,'команда должна завершаться ошибкой, если база не сохранена');
 assert.match(stdout+stderr,/База НЕ сохранена/);
});

test('restore brings the archive back and keeps a safety copy',async()=>{
 await fs.writeFile(path.join(data,'chats.json'),'[{"role":"user","content":"эталон"}]','utf8');
 const made=await backup({url:'',now:new Date()});
 await fs.writeFile(path.join(data,'chats.json'),'[{"role":"user","content":"испорчено"}]','utf8');
 const result=await restore(made.name,{url:''});
 assert.equal(result.data,'restored');
 assert.match(await fs.readFile(path.join(data,'chats.json'),'utf8'),/эталон/);
 assert.match(await fs.readFile(path.join(result.safety,'data','chats.json'),'utf8'),/испорчено/,
  'предыдущее состояние сохраняется на случай ошибки');
 await assert.rejects(()=>restore('не-копия',{url:''}),/Неверное имя/);
});
