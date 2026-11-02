const avatar=document.createElement('button');
avatar.id='chat-avatar';avatar.type='button';avatar.setAttribute('aria-label','Открыть чат Amayori');avatar.title='Перетащите для перемещения · нажмите для чата';
avatar.innerHTML='<span aria-hidden="true">✦</span>';
const panel=document.createElement('section');panel.id='floating-chat';panel.hidden=true;
panel.innerHTML='<header><strong>✦ Amayori · Чат</strong><button type="button" id="chat-close" aria-label="Закрыть чат">×</button></header><div id="chat-history" role="log" aria-live="polite"><p class="chat-hint">Чат пока работает локально в браузере. Подключение модели будет добавлено отдельно.</p></div><form id="chat-form"><input id="chat-input" autocomplete="off" maxlength="4000" placeholder="Напишите сообщение…" aria-label="Сообщение" required><button type="submit">Отправить</button></form>';
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
document.getElementById('chat-form').addEventListener('submit',e=>{
 e.preventDefault();const input=document.getElementById('chat-input'),text=input.value.trim();if(!text)return;
 const history=document.getElementById('chat-history');
 const line=document.createElement('p');line.className='chat-user';line.textContent=text;history.append(line);
 const info=document.createElement('p');info.className='chat-hint';info.textContent='Модель ИИ пока не подключена. Сообщение не отправлено внешнему сервису.';history.append(info);
 input.value='';history.scrollTop=history.scrollHeight;
});
addEventListener('resize',clamp);
