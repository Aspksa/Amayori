import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const host='127.0.0.1',port=Number(process.env.PORT||57474);
const routes={'/':'index.html','/index.html':'index.html','/style.css':'style.css'};
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8'};
http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  if(req.method!=='GET'){res.writeHead(405);return res.end('Method not allowed')}
  if(url.pathname==='/api/health'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});return res.end(JSON.stringify({ok:true,name:'Amayori'}))}
  const name=routes[url.pathname];
  if(!name){res.writeHead(404);return res.end('Not found')}
  const body=await fs.readFile(path.join(root,'public',name));
  res.writeHead(200,{'Content-Type':types[path.extname(name)],'X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; frame-ancestors 'none'"});
  res.end(body);
 }catch(e){console.error(e);res.writeHead(500);res.end('Internal error')}
}).listen(port,host,()=>console.log('Amayori ready: http://'+host+':'+port+'/'));
