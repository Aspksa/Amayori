// Read-only explorer for the real knowledge graph; independent of WebGL availability.
const root = document.getElementById('universe');
const button = document.createElement('button');
button.type = 'button';
button.textContent = 'Связи и иммунитет';
button.setAttribute('aria-expanded','false');
button.style.cssText = 'position:fixed;top:14px;right:14px;z-index:50;background:#181b25;color:#f3d49c;border:1px solid #8c6d39;border-radius:10px;padding:10px 14px;cursor:pointer';
const panel = document.createElement('section');
panel.hidden = true;
panel.setAttribute('aria-label','Связи памяти и иммунитет знаний');
panel.style.cssText = 'position:fixed;top:60px;right:14px;bottom:16px;width:min(410px,calc(100vw - 28px));overflow:auto;z-index:50;background:#111722;color:#e8dfd0;border:1px solid #8c6d39;border-radius:12px;padding:14px;font:14px system-ui;box-sizing:border-box';
const heading = document.createElement('h2'); heading.textContent = 'Живая сеть памяти';
const summary = document.createElement('p');
const search = document.createElement('input');search.type='search';search.placeholder='Найти факт, тему или источник';search.setAttribute('aria-label','Поиск по сети памяти');
search.style.cssText='box-sizing:border-box;width:100%;padding:10px;border-radius:8px;background:#222b39;color:white;border:1px solid #596270';
const filter = document.createElement('select');
filter.setAttribute('aria-label','Фильтр узлов');
filter.style.cssText=search.style.cssText+';margin-top:8px';
for(const [value,label] of [['all','Все узлы'],['fact','Факты'],['topic','Темы'],['entity','Сущности'],['message','Сообщения'],['alert','Требует внимания']]){
 const option=document.createElement('option');option.value=value;option.textContent=label;filter.append(option);
}
const list=document.createElement('div');
panel.append(heading,summary,search,filter,list);root.append(button,panel);
let network=null, lastSignature='', refreshing=false;
const safe = value => String(value ?? '');
function entry(node) {
 const item=document.createElement('details');item.style.cssText='padding:9px 0;border-bottom:1px solid #333c4b';
 const title=document.createElement('summary');title.style.cursor='pointer';title.textContent=node.label+' · '+node.type;item.append(title);
 const relations=(network.edges||[]).filter(e=>e.source===node.id||e.target===node.id).slice(0,30);
 const meta=document.createElement('p');meta.textContent=relations.length+' связей'+(node.status?' · '+node.status:'');item.append(meta);
 const alert=(network.alerts||[]).find(a=>'fact:'+a.factId===node.id);
 if(alert){const warning=document.createElement('p');warning.textContent='Внимание: '+alert.label;warning.style.color='#f0ba75';item.append(warning);}
 for(const edge of relations){
  const other=network.byId.get(edge.source===node.id?edge.target:edge.source);
  const link=document.createElement('button');link.type='button';link.textContent=(edge.type||'связь')+' → '+(other?.label||'неизвестный узел');
  link.style.cssText='display:block;text-align:left;background:transparent;color:#e7c47e;border:0;padding:5px;cursor:pointer';
  link.addEventListener('click',()=>{search.value=other?.label||'';filter.value='all';render();});item.append(link);
 }
 if(node.type==='fact'){
  const open=document.createElement('button');open.type='button';open.textContent='Показать источник';open.style.cssText='background:#293244;color:#f1d6a6;border:1px solid #67563a;border-radius:6px;padding:6px;cursor:pointer';
  open.addEventListener('click',async()=>{
   const id=node.id.slice(5);
   if(!/^[1-9][0-9]{0,15}$/.test(id))return;
   open.disabled=true;
   try{const response=await fetch('/api/golem/source?id='+encodeURIComponent(id),{cache:'no-store'});if(!response.ok)throw Error('HTTP '+response.status);
    const source=await response.json();const p=document.createElement('p');p.textContent=safe(source.message?.content||'Источник без доступного текста');item.append(p);
   }catch(error){const p=document.createElement('p');p.textContent='Источник недоступен: '+error.message;item.append(p);}
   finally{open.disabled=false;}
  });item.append(open);
 }
 return item;
}
function render(){
 if(!network)return;
 const q=search.value.trim().toLocaleLowerCase('ru'),type=filter.value;
 const nodes=network.nodes.filter(n=>(type==='all'||(type==='alert'?network.alertIds.has(n.id):n.type===type))&&(!q||n.label.toLocaleLowerCase('ru').includes(q)));
 list.replaceChildren();
 for(const node of nodes.slice(0,100))list.append(entry(node));
 const count=document.createElement('p');count.textContent='Показано '+Math.min(100,nodes.length)+' из '+nodes.length+' совпадений';list.prepend(count);
}
async function refresh(){
 if(refreshing||panel.hidden||document.hidden)return;
 refreshing=true;
 try{
  const response=await fetch('/api/golem/network?limit=10000',{cache:'no-store'});
  if(!response.ok)throw Error('HTTP '+response.status);
  const data=await response.json();
  if(!Array.isArray(data.nodes)||!Array.isArray(data.edges))throw Error('Неверный формат графа');
  const signature=JSON.stringify(data.stats)+'|'+data.nodes.map(n=>n.id+':'+n.status).join(',');
  if(signature!==lastSignature){
   lastSignature=signature;network=data;network.byId=new Map(data.nodes.map(n=>[n.id,n]));network.alertIds=new Set((data.alerts||[]).map(a=>'fact:'+a.factId));render();
  }
  summary.textContent=data.stats.nodes+' узлов · '+data.stats.edges+' связей · '+data.stats.alerts+' предупреждений'+(data.stats.truncated?' · показана часть фактов':'');
 }catch(error){summary.textContent='Не удалось загрузить сеть: '+error.message;}
 finally{refreshing=false;}
}
button.addEventListener('click',()=>{panel.hidden=!panel.hidden;button.setAttribute('aria-expanded',String(!panel.hidden));if(!panel.hidden)void refresh();});
search.addEventListener('input',render);filter.addEventListener('change',render);
setInterval(()=>{void refresh();},12000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh();});
