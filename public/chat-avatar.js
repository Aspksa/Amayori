const avatar=document.createElement('button');
avatar.id='chat-avatar';avatar.type='button';avatar.setAttribute('aria-label','Открыть чат Amayori');avatar.title='Перетащите для перемещения · нажмите для чата';
avatar.innerHTML='<span aria-hidden="true">✦</span>';
const panel=document.createElement('section');panel.id='floating-chat';panel.hidden=true;
panel.innerHTML='<header><strong>✦ Amayori · Чат</strong><select id="chat-model" aria-label="Модель чата"><option value="">Модель по умолчанию</option></select><button type="button" id="chat-expand" aria-label="Развернуть чат" title="На весь экран">⛶</button><button type="button" id="chat-close" aria-label="Закрыть чат">×</button></header><div class="chat-tools"><input id="chat-search" type="search" placeholder="Поиск по истории…" aria-label="Поиск по истории"><button id="chat-export" type="button">Экспорт</button><button id="chat-clear-view" type="button">Очистить экран</button></div><div id="chat-history" role="log" aria-live="polite"><p class="chat-hint">Подключите Cloud.ru в разделе «Настройки», чтобы начать переписку.</p></div><form id="chat-form"><input id="chat-input" autocomplete="off" maxlength="4000" placeholder="Напишите сообщение…" aria-label="Сообщение" required><button type="submit">Отправить</button></form>';
document.body.append(avatar,panel);
let pos={x:innerWidth-100,y:innerHeight-120};
try{const saved=JSON.parse(localStorage.getItem('amayori-avatar-position'));if(Number.isFinite(saved.x)&&Number.isFinite(saved.y))pos=saved}catch{}
const clamp=()=>{pos.x=Math.max(8,Math.min(innerWidth-76,pos.x));pos.y=Math.max(8,Math.min(innerHeight-76,pos.y));avatar.style.left=pos.x+'px';avatar.style.top=pos.y+'px'};
clamp();
let start=null,dragged=false;
avatar.addEventListener('pointerdown',e=>{if(e.button!==0)return;start={x:e.clientX,y:e.clientY,px:pos.x,py:pos.y};dragged=false;avatar.setPointerCapture(e.pointerId)});
avatar.addEventListener('pointermove',e=>{if(!start)return;const dx=e.clientX-start.x,dy=e.clientY-start.y;if(Math.hypot(dx,dy)>6)dragged=true;if(dragged){pos.x=start.px+dx;pos.y=start.py+dy;clamp()}});
avatar.addEventListener('pointerup',()=>{if(!start)return;start=null;if(dragged){localStorage.setItem('amayori-avatar-position',JSON.stringify(pos));return}panel.hidden=!panel.hidden;if(!panel.hidden)document.getElementById('chat-input').focus()});
avatar.addEventListener('pointercancel',()=>{start=null});
avatar.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();panel.hidden=!panel.hidden}});
document.getElementById('chat-close').addEventListener('click',()=>{panel.hidden=true;avatar.focus()});
document.getElementById('chat-form').addEventListener('submit',async e=>{
 e.preventDefault();const input=document.getElementById('chat-input'),text=input.value.trim();if(!text)return;
 const history=document.getElementById('chat-history');
 const line=document.createElement('p');line.className='chat-user';line.textContent=text;history.append(line);
 input.value='';const info=document.createElement('p');info.className='chat-hint';info.textContent='Amayori думает…';history.append(info);history.scrollTop=history.scrollHeight;
 const submit=document.querySelector('#chat-form button');submit.disabled=true;
 try{const r=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:text,model:document.getElementById('chat-model').value})});const data=await r.json();if(!r.ok)throw Error(data.error||'Ошибка сервера');info.className='chat-reply';info.textContent=data.answer;document.dispatchEvent(new Event('amayori-chat-updated'))}catch(err){info.textContent='Ошибка: '+err.message}finally{submit.disabled=false;history.scrollTop=history.scrollHeight}
});
addEventListener('resize',clamp);

document.addEventListener('amayori-models',e=>{const select=document.getElementById('chat-model'),selected=select.value;select.replaceChildren();const fallback=document.createElement('option');fallback.value='';fallback.textContent='Модель по умолчанию';select.append(fallback);for(const model of e.detail){const option=document.createElement('option');option.value=model.id;option.textContent=model.name;select.append(option)}select.value=[...select.options].some(o=>o.value===selected)?selected:''});
fetch('/api/chats').then(r=>r.json()).then(data=>{const history=document.getElementById('chat-history');if(!Array.isArray(data.messages)||!data.messages.length)return;history.replaceChildren();for(const m of data.messages){const p=document.createElement('p');p.className=m.role==='user'?'chat-user':'chat-reply';p.textContent=m.content;history.append(p)}history.scrollTop=history.scrollHeight}).catch(()=>{});

const chatPanel=document.getElementById('floating-chat');
document.getElementById('chat-expand').addEventListener('click',()=>{chatPanel.classList.toggle('expanded');document.getElementById('chat-expand').setAttribute('aria-label',chatPanel.classList.contains('expanded')?'Свернуть чат':'Развернуть чат')});
document.getElementById('chat-search').addEventListener('input',e=>{const q=e.target.value.trim().toLocaleLowerCase('ru');for(const item of document.querySelectorAll('#chat-history .chat-user,#chat-history .chat-reply'))item.hidden=!!q&&!item.textContent.toLocaleLowerCase('ru').includes(q)});
document.getElementById('chat-clear-view').addEventListener('click',()=>{document.getElementById('chat-history').replaceChildren();document.getElementById('chat-search').value=''});
document.getElementById('chat-export').addEventListener('click',async()=>{try{const response=await fetch('/api/chats');if(!response.ok)throw Error('Не удалось прочитать архив');const data=await response.json();const lines=(data.messages||[]).map(m=>'['+(m.at||'')+'] '+(m.role==='user'?'Вы':'Amayori')+': '+m.content).join('\n\n');const blob=new Blob([lines],{type:'text/plain;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='amayori-chat-'+new Date().toISOString().slice(0,10)+'.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}catch(e){alert(e.message)}});
