// Optional local bridge adapters. The external MemOS/Graphiti services must be
// configured and running separately; this module does not install either engine.
const allowedHosts=new Set(['127.0.0.1','localhost','::1']);
function endpoint(raw){if(!raw)return null;const u=new URL(raw);if(u.protocol!=='http:'||!allowedHosts.has(u.hostname)||u.username||u.password)throw Error('Bridge must use local HTTP address');return u}
async function invoke(raw,route,payload){const u=endpoint(raw);if(!u)return {enabled:false};const target=new URL(route,u);if(target.origin!==u.origin)throw Error('Bridge URL escapes local origin');const response=await fetch(target,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(8000)});if(!response.ok)throw Error('Bridge HTTP '+response.status);return {enabled:true,data:await response.json()}}
export const bridgeStatus=()=>({memos:{configured:!!process.env.AMAYORI_MEMOS_BRIDGE_URL,mode:'external'},graphiti:{configured:!!process.env.AMAYORI_GRAPHITI_BRIDGE_URL,mode:'external'}});
export const memosSearch=query=>invoke(process.env.AMAYORI_MEMOS_BRIDGE_URL,'search',{query});
export const memosStore=(user,assistant)=>invoke(process.env.AMAYORI_MEMOS_BRIDGE_URL,'store',{user,assistant});
export const graphitiIngest=(user,assistant)=>invoke(process.env.AMAYORI_GRAPHITI_BRIDGE_URL,'ingest',{user,assistant});
