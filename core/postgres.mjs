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
 embedding vector(384)
 )`);
 await db.query('CREATE INDEX IF NOT EXISTS amayori_memories_created_idx ON amayori_memories(created_at DESC)');
 return {enabled:true};
}
export async function insertMemory(role,content,embedding=null){
 const db=await database();if(!db)return;
 if(!['user','assistant'].includes(role)||typeof content!=='string')throw Error('Invalid memory');
 if(embedding!==null&&(!Array.isArray(embedding)||embedding.length!==384||!embedding.every(Number.isFinite)))throw Error('Embedding must contain 384 finite numbers');
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
