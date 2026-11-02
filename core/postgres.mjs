import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
let pool;
const enabled=()=>Boolean(process.env.AMAYORI_DATABASE_URL);
export async function database(){
 if(!enabled())return null;
 if(pool)return pool;
 const {Pool}=require('pg');
 const candidate=new Pool({connectionString:process.env.AMAYORI_DATABASE_URL,max:3,connectionTimeoutMillis:4000,idleTimeoutMillis:15000,ssl:process.env.AMAYORI_PG_SSL==='1'?{rejectUnauthorized:true}:undefined});
 try{await candidate.query('SELECT 1');pool=candidate;return pool}catch(error){await candidate.end();throw error}
}
export async function initDatabase(){
 const db=await database();if(!db)return {enabled:false};
 await db.query('CREATE EXTENSION IF NOT EXISTS vector');
 await db.query(`CREATE TABLE IF NOT EXISTS amayori_memories (
 id BIGSERIAL PRIMARY KEY,
 role TEXT NOT NULL CHECK(role IN ('user','assistant')),
 content TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 embedding vector(384),
 chat_message_id BIGINT UNIQUE
 )`);
 await db.query('ALTER TABLE amayori_memories ADD COLUMN IF NOT EXISTS chat_message_id BIGINT UNIQUE');
 await db.query('CREATE INDEX IF NOT EXISTS amayori_memories_created_idx ON amayori_memories(created_at DESC)');
 return {enabled:true};
}
export async function insertMemory(role,content,embedding=null){
 if(!['user','assistant'].includes(role)||typeof content!=='string')throw Error('Invalid memory');
 if(embedding!==null&&(!Array.isArray(embedding)||embedding.length!==384||!embedding.every(Number.isFinite)))throw Error('Embedding must contain 384 finite numbers');
 const db=await database();if(!db)return;
 await db.query('INSERT INTO amayori_memories(role,content,embedding) VALUES($1,$2,$3::vector)',[role,content,embedding===null?null:'['+embedding.join(',')+']']);
}
export async function searchMemory(embedding,limit=5){
 if(!Array.isArray(embedding)||embedding.length!==384||!embedding.every(Number.isFinite))throw Error('Invalid embedding');
 const db=await database();if(!db)return [];
 const vector='['+embedding.join(',')+']';
 const result=await db.query('SELECT id,role,content,created_at,embedding <=> $1::vector AS distance FROM amayori_memories WHERE embedding IS NOT NULL ORDER BY embedding <=> $1::vector LIMIT $2',[vector,Math.max(1,Math.min(20,limit))]);
 return result.rows;
}
export async function databaseStatus(){
 if(!enabled())return {enabled:false,connected:false};
 try{const db=await database();const r=await db.query("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='vector') AS vector_enabled");return {enabled:true,connected:true,vectorEnabled:r.rows[0].vector_enabled}}catch(e){return {enabled:true,connected:false,error:e.message}}
}

export async function ensureCanonicalTable(){
 const db=await database();if(!db)throw Error('PostgreSQL is required in canonical mode');
 await db.query(`CREATE TABLE IF NOT EXISTS amayori_chat_log(
 id BIGSERIAL PRIMARY KEY,
 role TEXT NOT NULL CHECK(role IN ('user','assistant')),
 content TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
 )`);
 return db;
}
export async function loadCanonicalChats(limit=null){
 const db=await ensureCanonicalTable();
 const result=limit===null
 ?await db.query('SELECT role,content,created_at FROM amayori_chat_log ORDER BY id')
 :await db.query('SELECT role,content,created_at FROM (SELECT id,role,content,created_at FROM amayori_chat_log ORDER BY id DESC LIMIT $1) t ORDER BY id',[limit]);
 return result.rows.map(r=>({role:r.role,content:r.content,at:r.created_at.toISOString()}));
}
export async function appendCanonicalExchange(user,assistant){
 const db=await ensureCanonicalTable(),client=await db.connect();
 try{
  await client.query('BEGIN');
  await client.query('INSERT INTO amayori_chat_log(role,content) VALUES($1,$2)', ['user',user]);
  await client.query('INSERT INTO amayori_chat_log(role,content) VALUES($1,$2)', ['assistant',assistant]);
  await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
}
export async function importCanonicalChats(messages){
 if(!Array.isArray(messages))throw Error('Invalid import archive');
 const db=await ensureCanonicalTable(),client=await db.connect();
 try{
  await client.query('BEGIN');
  const count=await client.query('SELECT COUNT(*)::int AS n FROM amayori_chat_log');
  if(count.rows[0].n!==0)throw Error('PostgreSQL archive is not empty; migration cancelled');
  for(const m of messages){
   if(!m||!['user','assistant'].includes(m.role)||typeof m.content!=='string')continue;
   const date=m.at&&Number.isFinite(Date.parse(m.at))?m.at:new Date().toISOString();
   await client.query('INSERT INTO amayori_chat_log(role,content,created_at) VALUES($1,$2,$3)',[m.role,m.content,date]);
  }
  await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
}

/** Structured facts are versioned; superseded claims are kept for audit. */
export async function ensureKnowledgeTables(){
 const db=await database();if(!db)return null;
 await db.query(`CREATE TABLE IF NOT EXISTS amayori_facts(
 id BIGSERIAL PRIMARY KEY, subject TEXT NOT NULL, predicate TEXT NOT NULL,
 object TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'chat', source_message_id BIGINT,
 confidence REAL NOT NULL DEFAULT 1 CHECK(confidence BETWEEN 0 AND 1),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','superseded','rejected')),
 superseded_by BIGINT, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
 await db.query('ALTER TABLE amayori_facts ADD COLUMN IF NOT EXISTS source_message_id BIGINT');
 await db.query('CREATE INDEX IF NOT EXISTS amayori_facts_lookup_idx ON amayori_facts(subject,predicate,status)');
 await db.query(`CREATE TABLE IF NOT EXISTS amayori_feedback(
 id BIGSERIAL PRIMARY KEY, chat_excerpt TEXT NOT NULL,
 rating SMALLINT NOT NULL CHECK(rating IN (-1,1)),
 note TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
 return db;
}
export async function saveFact({subject,predicate,object,source='user-confirmed',sourceMessageId=null}){
 if(sourceMessageId!==null&&(!Number.isSafeInteger(sourceMessageId)||sourceMessageId<1))throw Error('Invalid source message ID');
 for(const value of [subject,predicate,object,source])if(typeof value!=='string'||!value.trim()||value.length>500)throw Error('Invalid fact');
 const db=await ensureKnowledgeTables();if(!db)throw Error('PostgreSQL required for knowledge');
 const client=await db.connect();try{
 await client.query('BEGIN');
 const prior=await client.query('SELECT id,object FROM amayori_facts WHERE subject=$1 AND predicate=$2 AND status=$3 FOR UPDATE',[subject,predicate,'active']);
 const same=prior.rows.find(x=>x.object===object);
 if(same){await client.query('COMMIT');return {id:same.id,changed:false,conflicts:[]}}
 const inserted=await client.query('INSERT INTO amayori_facts(subject,predicate,object,source,source_message_id) VALUES($1,$2,$3,$4,$5) RETURNING id',[subject,predicate,object,source,sourceMessageId]);
 const id=inserted.rows[0].id;
 if(prior.rows.length)await client.query("UPDATE amayori_facts SET status='superseded',superseded_by=$1 WHERE id=ANY($2::bigint[])",[id,prior.rows.map(x=>x.id)]);
 await client.query('COMMIT');return {id,changed:true,conflicts:prior.rows.map(x=>({id:x.id,object:x.object}))};
 }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
}
export async function findFacts(query='',limit=15){
 const db=await ensureKnowledgeTables();if(!db)return [];
 const q=String(query).slice(0,200).replace(/[\\%_]/g,'\\$&');
 const r=await db.query("SELECT id,subject,predicate,object,source,confidence,created_at FROM amayori_facts WHERE status='active' AND ($1='' OR subject ILIKE '%'||$1||'%' ESCAPE '\\' OR predicate ILIKE '%'||$1||'%' ESCAPE '\\' OR object ILIKE '%'||$1||'%' ESCAPE '\\') ORDER BY id DESC LIMIT $2",[q,Math.max(1,Math.min(50,limit))]);
 return r.rows;
}
export async function knowledgeGraph(){
 const db=await ensureKnowledgeTables();if(!db)return {nodes:[],edges:[]};
 const r=await db.query("SELECT id,subject,predicate,object FROM amayori_facts WHERE status='active' ORDER BY id DESC LIMIT 500");
 const nodes=new Map(),edges=[];
 for(const f of r.rows){for(const name of [f.subject,f.object])if(!nodes.has(name))nodes.set(name,{id:name,label:name});edges.push({id:String(f.id),source:f.subject,target:f.object,label:f.predicate})}
 return {nodes:[...nodes.values()],edges};
}
export async function saveFeedback({chatExcerpt,rating,note=''}) {
 if(typeof chatExcerpt!=='string'||chatExcerpt.length>2000||!chatExcerpt.trim()||![-1,1].includes(rating)||typeof note!=='string'||note.length>1000)throw Error('Invalid feedback');
 const db=await ensureKnowledgeTables();if(!db)throw Error('PostgreSQL required for feedback');
 await db.query('INSERT INTO amayori_feedback(chat_excerpt,rating,note) VALUES($1,$2,$3)',[chatExcerpt,rating,note]);return {ok:true};
}
export async function feedbackStats(){
 const db=await ensureKnowledgeTables();if(!db)return {positive:0,negative:0};
 const r=await db.query('SELECT rating,COUNT(*)::int AS count FROM amayori_feedback GROUP BY rating');
 return {positive:r.rows.find(x=>x.rating===1)?.count||0,negative:r.rows.find(x=>x.rating===-1)?.count||0};
}

export async function golemKnowledgePage({q='',limit=150,offset=0}={}){
 const db=await ensureKnowledgeTables();if(!db)return {nodes:[],edges:[],total:0,source:'postgresql-unavailable'};
 const size=Math.max(1,Math.min(300,Number(limit)||150)),skip=Math.max(0,Math.min(1000000,Number(offset)||0));
 const term=String(q).slice(0,150);
 const count=await db.query("SELECT COUNT(*)::int AS n FROM amayori_facts WHERE status='active' AND ($1='' OR subject ILIKE '%'||$1||'%' OR predicate ILIKE '%'||$1||'%' OR object ILIKE '%'||$1||'%')",[term]);
 const result=await db.query("SELECT id,subject,predicate,object,source,confidence,created_at FROM amayori_facts WHERE status='active' AND ($1='' OR subject ILIKE '%'||$1||'%' OR predicate ILIKE '%'||$1||'%' OR object ILIKE '%'||$1||'%') ORDER BY id DESC LIMIT $2 OFFSET $3",[term,size,skip]);
 const nodes=new Map(),edges=[];
 for(const row of result.rows){
  for(const name of [row.subject,row.object])if(!nodes.has(name))nodes.set(name,{id:name,label:name,category:'fact'});
  edges.push({id:String(row.id),source:row.subject,target:row.object,label:row.predicate,sourceType:row.source,confidence:row.confidence,createdAt:row.created_at});
 }
 return {nodes:[...nodes.values()],edges,total:count.rows[0].n,offset:skip,limit:size,source:'postgresql'};
}
export async function golemVectorStatus(){
 const db=await database();if(!db)return {enabled:false,indexed:0};
 const r=await db.query('SELECT COUNT(*)::int AS n FROM amayori_memories WHERE embedding IS NOT NULL');
 return {enabled:true,indexed:r.rows[0].n,dimensions:384};
}

export async function golemFactSource(id){
 const db=await ensureKnowledgeTables();if(!db)return null;
 const r=await db.query('SELECT id,subject,predicate,object,source,source_message_id,confidence,status,created_at FROM amayori_facts WHERE id=$1',[id]);const fact=r.rows[0];if(!fact)return null;
 if(fact.source_message_id){const message=await db.query('SELECT id,role,content,created_at FROM amayori_chat_log WHERE id=$1',[fact.source_message_id]);fact.message=message.rows[0]||null;}
 return fact;
}
export async function golemSimilar(embedding,limit=8){
 return searchMemory(embedding,limit);
}

export async function pendingChatEmbeddings(limit=5){
 const db=await ensureCanonicalTable();
 await initDatabase();
 const r=await db.query("SELECT c.id,c.role,c.content FROM amayori_chat_log c WHERE NOT EXISTS(SELECT 1 FROM amayori_memories m WHERE m.chat_message_id=c.id) ORDER BY c.id LIMIT $1",[Math.max(1,Math.min(10,limit))]);
 return r.rows;
}
export async function storeChatEmbedding(message,embedding){
 if(!Array.isArray(embedding)||embedding.length!==384||!embedding.every(Number.isFinite))throw Error('Invalid embedding');
 const db=await database();await db.query('INSERT INTO amayori_memories(chat_message_id,role,content,embedding) VALUES($1,$2,$3,$4::vector) ON CONFLICT (chat_message_id) DO NOTHING',[message.id,message.role,message.content,'['+embedding.join(',')+']']);
}
export async function embeddingProgress(){
 const db=await ensureCanonicalTable();await initDatabase();
 const r=await db.query('SELECT (SELECT COUNT(*)::int FROM amayori_chat_log) AS total,(SELECT COUNT(*)::int FROM amayori_memories WHERE chat_message_id IS NOT NULL AND embedding IS NOT NULL) AS indexed');
 return r.rows[0];
}
