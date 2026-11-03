import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
let pool;
/** Vector width of the pgvector schema. Changing it requires a schema migration. */
export const EMBEDDING_DIMENSIONS=384;
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
 embedding vector(${EMBEDDING_DIMENSIONS}),
 chat_message_id BIGINT UNIQUE
 )`);
 await db.query('ALTER TABLE amayori_memories ADD COLUMN IF NOT EXISTS chat_message_id BIGINT UNIQUE');
 await db.query('CREATE INDEX IF NOT EXISTS amayori_memories_created_idx ON amayori_memories(created_at DESC)');
 return {enabled:true};
}
export async function insertMemory(role,content,embedding=null){
 if(!['user','assistant'].includes(role)||typeof content!=='string')throw Error('Invalid memory');
 if(embedding!==null&&(!Array.isArray(embedding)||embedding.length!==EMBEDDING_DIMENSIONS||!embedding.every(Number.isFinite)))throw Error('Embedding must contain '+EMBEDDING_DIMENSIONS+' finite numbers');
 const db=await database();if(!db)return;
 await db.query('INSERT INTO amayori_memories(role,content,embedding) VALUES($1,$2,$3::vector)',[role,content,embedding===null?null:'['+embedding.join(',')+']']);
}
export async function searchMemory(embedding,limit=5){
 if(!Array.isArray(embedding)||embedding.length!==EMBEDDING_DIMENSIONS||!embedding.every(Number.isFinite))throw Error('Invalid embedding');
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
 await db.query(`CREATE TABLE IF NOT EXISTS amayori_conversations(
 id BIGSERIAL PRIMARY KEY,
 title TEXT NOT NULL DEFAULT 'Новый диалог',
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
 )`);
 await db.query('ALTER TABLE amayori_chat_log ADD COLUMN IF NOT EXISTS conversation_id BIGINT');
 await db.query('CREATE INDEX IF NOT EXISTS amayori_chat_log_conversation_idx ON amayori_chat_log(conversation_id,id)');
 // Everything written before conversations existed belongs to one of them.
 const orphans=await db.query('SELECT COUNT(*)::int AS n FROM amayori_chat_log WHERE conversation_id IS NULL');
 if(orphans.rows[0].n>0){
  const existing=await db.query('SELECT id FROM amayori_conversations ORDER BY id LIMIT 1');
  const target=existing.rows[0]?.id??(await db.query("INSERT INTO amayori_conversations(title) VALUES('Общий диалог') RETURNING id")).rows[0].id;
  await db.query('UPDATE amayori_chat_log SET conversation_id=$1 WHERE conversation_id IS NULL',[target]);
 }
 return db;
}
export async function listConversations(){
 const db=await ensureCanonicalTable();
 const r=await db.query(`SELECT c.id,c.title,c.created_at,c.updated_at,
  COUNT(m.id)::int AS messages,MAX(m.created_at) AS last_at
  FROM amayori_conversations c LEFT JOIN amayori_chat_log m ON m.conversation_id=c.id
  GROUP BY c.id ORDER BY COALESCE(MAX(m.created_at),c.created_at) DESC,c.id DESC`);
 return r.rows.map(row=>({id:String(row.id),title:row.title,messages:row.messages,
  createdAt:row.created_at.toISOString(),updatedAt:(row.last_at||row.updated_at).toISOString()}));
}
export async function createConversation(title){
 const db=await ensureCanonicalTable();
 const r=await db.query('INSERT INTO amayori_conversations(title) VALUES($1) RETURNING id,title,created_at',[title]);
 return {id:String(r.rows[0].id),title:r.rows[0].title,messages:0,
  createdAt:r.rows[0].created_at.toISOString(),updatedAt:r.rows[0].created_at.toISOString()};
}
export async function renameConversation(id,title){
 const db=await ensureCanonicalTable();
 const r=await db.query('UPDATE amayori_conversations SET title=$1,updated_at=now() WHERE id=$2 RETURNING id',[title,id]);
 return r.rowCount>0;
}
export async function deleteConversation(id){
 const db=await ensureCanonicalTable(),client=await db.connect();
 try{
  await client.query('BEGIN');
  const messages=await client.query('SELECT id FROM amayori_chat_log WHERE conversation_id=$1',[id]);
  const ids=messages.rows.map(r=>String(r.id));
  await client.query('DELETE FROM amayori_memories WHERE chat_message_id = ANY($1::bigint[])',[ids]);
  await client.query('DELETE FROM amayori_chat_log WHERE conversation_id=$1',[id]);
  const gone=await client.query('DELETE FROM amayori_conversations WHERE id=$1 RETURNING id',[id]);
  await client.query('COMMIT');
  return {removed:gone.rowCount>0,messageIds:ids};
 }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
}
export async function deleteCanonicalMessages(ids){
 if(!Array.isArray(ids)||!ids.length)return {messageIds:[]};
 const db=await ensureCanonicalTable(),client=await db.connect();
 try{
  await client.query('BEGIN');
  await client.query('DELETE FROM amayori_memories WHERE chat_message_id = ANY($1::bigint[])',[ids]);
  const gone=await client.query('DELETE FROM amayori_chat_log WHERE id = ANY($1::bigint[]) RETURNING id',[ids]);
  await client.query('COMMIT');
  return {messageIds:gone.rows.map(r=>String(r.id))};
 }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
}
export async function loadCanonicalChats(options=null){
 const {limit=null,offset=0,conversationId=null,query=''}=typeof options==='number'||options===null?{limit:options}:options;
 const db=await ensureCanonicalTable();
 const where=[],values=[];
 if(conversationId!=null){values.push(conversationId);where.push('conversation_id=$'+values.length)}
 if(query){values.push(String(query).slice(0,200).replace(/[\\%_]/g,'\\$&'));where.push("content ILIKE '%'||$"+values.length+"||'%' ESCAPE '\\'")}
 const filter=where.length?' WHERE '+where.join(' AND '):'';
 if(limit===null){
  const all=await db.query('SELECT id,role,content,created_at,conversation_id FROM amayori_chat_log'+filter+' ORDER BY id',values);
  return all.rows.map(chatRow);
 }
 const total=await db.query('SELECT COUNT(*)::int AS n FROM amayori_chat_log'+filter,values);
 const page=[...values,Math.max(1,Math.min(500,Number(limit)||100)),Math.max(0,Number(offset)||0)];
 const rows=await db.query('SELECT id,role,content,created_at,conversation_id FROM (SELECT id,role,content,created_at,conversation_id FROM amayori_chat_log'+filter
  +' ORDER BY id DESC LIMIT $'+(page.length-1)+' OFFSET $'+page.length+') t ORDER BY id',page);
 const list=rows.rows.map(chatRow);
 list.total=total.rows[0].n;
 return list;
}
const chatRow=r=>({id:String(r.id),role:r.role,content:r.content,at:r.created_at.toISOString(),
 conversation:r.conversation_id==null?null:String(r.conversation_id)});
export async function appendCanonicalExchange(user,assistant,conversationId=null){
 const db=await ensureCanonicalTable(),client=await db.connect();
 try{
  await client.query('BEGIN');
  let target=conversationId;
  if(target==null){
   const recent=await client.query('SELECT id FROM amayori_conversations ORDER BY updated_at DESC,id DESC LIMIT 1');
   target=recent.rows[0]?.id??(await client.query("INSERT INTO amayori_conversations(title) VALUES('Общий диалог') RETURNING id")).rows[0].id;
  }
  const userRow=await client.query('INSERT INTO amayori_chat_log(role,content,conversation_id) VALUES($1,$2,$3) RETURNING id',['user',user,target]);
  await client.query('INSERT INTO amayori_chat_log(role,content,conversation_id) VALUES($1,$2,$3)',['assistant',assistant,target]);
  await client.query('UPDATE amayori_conversations SET updated_at=now() WHERE id=$1',[target]);
  await client.query('COMMIT');return {messageId:Number(userRow.rows[0].id),conversationId:String(target)};
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
export async function ensureKnowledgeTables(providedDatabase=null){
 const db=providedDatabase||await database();if(!db)return null;
 await db.query(`CREATE TABLE IF NOT EXISTS amayori_facts(
 id BIGSERIAL PRIMARY KEY, subject TEXT NOT NULL, predicate TEXT NOT NULL,
 object TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'chat', source_message_id BIGINT,
 confidence REAL NOT NULL DEFAULT 1 CHECK(confidence BETWEEN 0 AND 1),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','superseded','rejected')),
 superseded_by BIGINT, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
 await db.query('ALTER TABLE amayori_facts ADD COLUMN IF NOT EXISTS source_message_id BIGINT');
 await db.query("ALTER TABLE amayori_facts ADD COLUMN IF NOT EXISTS knowledge_meta JSONB NOT NULL DEFAULT '{}'::jsonb");
 await db.query('CREATE INDEX IF NOT EXISTS amayori_facts_lookup_idx ON amayori_facts(subject,predicate,status)');
 await db.query(`CREATE TABLE IF NOT EXISTS amayori_feedback(
 id BIGSERIAL PRIMARY KEY, chat_excerpt TEXT NOT NULL,
 rating SMALLINT NOT NULL CHECK(rating IN (-1,1)),
 note TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
 return db;
}
export async function saveFact(input){
 const {knowledge}=await import('./knowledge-repository.mjs');
 return (await knowledge.save([input],{kind:input.source||'user-confirmed',messageId:input.sourceMessageId}))[0];
}
export async function findFacts(query='',limit=15){
 const {knowledge}=await import('./knowledge-repository.mjs');return knowledge.find(query,limit);
}
export async function knowledgeGraph(){
 const {knowledge}=await import('./knowledge-repository.mjs');return knowledge.graph({limit:100});
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
 const term=String(q).slice(0,150).replace(/[\\%_]/g,'\\$&');
 const filter="($1='' OR subject ILIKE '%'||$1||'%' ESCAPE '\\' OR predicate ILIKE '%'||$1||'%' ESCAPE '\\' OR object ILIKE '%'||$1||'%' ESCAPE '\\')";
 const count=await db.query("SELECT COUNT(*)::int AS n FROM amayori_facts WHERE status='active' AND "+filter,[term]);
 const result=await db.query("SELECT id,subject,predicate,object,source,confidence,created_at FROM amayori_facts WHERE status='active' AND "+filter+" ORDER BY id DESC LIMIT $2 OFFSET $3",[term,size,skip]);
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
 return {enabled:true,indexed:r.rows[0].n,dimensions:EMBEDDING_DIMENSIONS};
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
 if(!Array.isArray(embedding)||embedding.length!==EMBEDDING_DIMENSIONS||!embedding.every(Number.isFinite))throw Error('Invalid embedding');
 const db=await database();await db.query('INSERT INTO amayori_memories(chat_message_id,role,content,embedding) VALUES($1,$2,$3,$4::vector) ON CONFLICT (chat_message_id) DO NOTHING',[message.id,message.role,message.content,'['+embedding.join(',')+']']);
}
export async function embeddingProgress(){
 const db=await ensureCanonicalTable();await initDatabase();
 const r=await db.query('SELECT (SELECT COUNT(*)::int FROM amayori_chat_log) AS total,(SELECT COUNT(*)::int FROM amayori_memories WHERE chat_message_id IS NOT NULL AND embedding IS NOT NULL) AS indexed');
 return r.rows[0];
}

export async function recentUserMessageId(){
 const db=await ensureCanonicalTable();const r=await db.query("SELECT id FROM amayori_chat_log WHERE role='user' ORDER BY id DESC LIMIT 1");return r.rows[0]?Number(r.rows[0].id):null;
}
export async function knowledgeConflicts(limit=50){
 const db=await ensureKnowledgeTables();if(!db)return [];
 const r=await db.query("SELECT old.id,old.subject,old.predicate,old.object AS previous,new.object AS current,new.id AS replacement_id,old.source_message_id AS previous_message_id,new.source_message_id AS current_message_id FROM amayori_facts old JOIN amayori_facts new ON old.superseded_by=new.id WHERE old.status='superseded' ORDER BY new.id DESC LIMIT $1",[Math.max(1,Math.min(100,limit))]);
 return r.rows;
}
export async function relatedFacts(id){
 const db=await ensureKnowledgeTables();if(!db)return [];
 const selected=await db.query('SELECT subject,object FROM amayori_facts WHERE id=$1',[id]);if(!selected.rows.length)return [];
 const {subject,object}=selected.rows[0];
 const r=await db.query("SELECT id,subject,predicate,object,source_message_id FROM amayori_facts WHERE status='active' AND id<>$1 AND (subject=$2 OR object=$2 OR subject=$3 OR object=$3) ORDER BY id DESC LIMIT 30",[id,subject,object]);return r.rows;
}

export async function golemTraceStore(question, facts, answer){
 const db=await ensureKnowledgeTables();if(!db)return null;
 await db.query(`CREATE TABLE IF NOT EXISTS amayori_answer_traces(id BIGSERIAL PRIMARY KEY,question TEXT NOT NULL,answer_excerpt TEXT NOT NULL,fact_ids JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
 const ids=facts.map(f=>String(f.id)).filter(x=>/^[0-9]+$/.test(x));
 const r=await db.query('INSERT INTO amayori_answer_traces(question,answer_excerpt,fact_ids) VALUES($1,$2,$3::jsonb) RETURNING id',[question.slice(0,4000),answer.slice(0,600),JSON.stringify(ids)]);return String(r.rows[0].id);
}
export async function golemTraces(limit=20){
 const db=await ensureKnowledgeTables();if(!db)return [];
 await db.query(`CREATE TABLE IF NOT EXISTS amayori_answer_traces(id BIGSERIAL PRIMARY KEY,question TEXT NOT NULL,answer_excerpt TEXT NOT NULL,fact_ids JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
 const r=await db.query('SELECT id,question,answer_excerpt,fact_ids,created_at FROM amayori_answer_traces ORDER BY id DESC LIMIT $1',[Math.max(1,Math.min(50,limit))]);return r.rows;
}
export async function golemImmuneReport(){
 const db=await ensureKnowledgeTables();if(!db)return {duplicates:[],conflicts:[],unverified:[]};
 const [duplicates,conflicts,unverified]=await Promise.all([
 db.query("SELECT subject,predicate,object,COUNT(*)::int AS copies FROM amayori_facts WHERE status='active' GROUP BY subject,predicate,object HAVING COUNT(*)>1 LIMIT 30"),
 db.query("SELECT subject,predicate,COUNT(DISTINCT object)::int AS variants FROM amayori_facts WHERE status='active' GROUP BY subject,predicate HAVING COUNT(DISTINCT object)>1 LIMIT 30"),
 db.query("SELECT id,subject,predicate,object FROM amayori_facts WHERE status='active' AND source NOT IN ('user-confirmed') ORDER BY id DESC LIMIT 30")
 ]);return {duplicates:duplicates.rows,conflicts:conflicts.rows,unverified:unverified.rows};
}
export async function golemBridges(limit=20){
 const db=await ensureKnowledgeTables();if(!db)return [];
 const r=await db.query("SELECT a.id AS first_id,b.id AS second_id,a.subject AS first_subject,b.subject AS second_subject,a.object AS shared_entity FROM amayori_facts a JOIN amayori_facts b ON a.object=b.object AND a.id<b.id AND a.subject<>b.subject WHERE a.status='active' AND b.status='active' ORDER BY a.id DESC LIMIT $1",[Math.max(1,Math.min(50,limit))]);return r.rows;
}
