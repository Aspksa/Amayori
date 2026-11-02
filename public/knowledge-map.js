const canvas=document.getElementById('knowledge-map');
const ctx=canvas?.getContext('2d');
let graph={nodes:[],edges:[]},points=[],drag=null,pan={x:0,y:0},zoom=1;
function render(){if(!ctx)return;const w=canvas.width=canvas.clientWidth*devicePixelRatio,h=canvas.height=canvas.clientHeight*devicePixelRatio;ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);const cw=canvas.clientWidth,ch=canvas.clientHeight;ctx.clearRect(0,0,cw,ch);ctx.save();ctx.translate(cw/2+pan.x,ch/2+pan.y);ctx.scale(zoom,zoom);const map=new Map(points.map(p=>[p.id,p]));ctx.strokeStyle='#dec8bb';ctx.lineWidth=1;for(const e of graph.edges){const a=map.get(e.source),b=map.get(e.target);if(!a||!b)continue;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke()}for(const p of points){ctx.beginPath();ctx.arc(p.x,p.y,Math.min(15,5+p.count),0,Math.PI*2);ctx.fillStyle='#a42b43';ctx.fill();ctx.fillStyle='#48373d';ctx.font='12px Segoe UI';ctx.fillText(p.label.slice(0,18),p.x+13,p.y+4)}ctx.restore()}
async function load(){try{const r=await fetch('/api/graph');if(!r.ok)return;graph=await r.json();const count=graph.nodes.length;points=graph.nodes.slice(0,250).map((n,i)=>{const a=i*2.3999632297,rad=24*Math.sqrt(i);return {...n,x:Math.cos(a)*rad,y:Math.sin(a)*rad}});render()}catch{}}
function coords(e){const r=canvas.getBoundingClientRect();return{x:(e.clientX-r.left-r.width/2-pan.x)/zoom,y:(e.clientY-r.top-r.height/2-pan.y)/zoom}}
canvas?.addEventListener('pointerdown',e=>{const p=coords(e);drag={x:e.clientX,y:e.clientY,panX:pan.x,panY:pan.y,node:points.find(n=>Math.hypot(n.x-p.x,n.y-p.y)<16)};canvas.setPointerCapture(e.pointerId)});
canvas?.addEventListener('pointermove',e=>{if(!drag)return;if(drag.node){const p=coords(e);drag.node.x=p.x;drag.node.y=p.y}else{pan.x=drag.panX+e.clientX-drag.x;pan.y=drag.panY+e.clientY-drag.y}render()});
canvas?.addEventListener('pointerup',()=>drag=null);canvas?.addEventListener('pointercancel',()=>drag=null);
canvas?.addEventListener('wheel',e=>{e.preventDefault();zoom=Math.max(.25,Math.min(3,zoom*(e.deltaY>0?.9:1.1)));render()},{passive:false});
document.getElementById('graph-reset')?.addEventListener('click',()=>{zoom=1;pan={x:0,y:0};load()});
addEventListener('resize',render);document.addEventListener('amayori-chat-updated',load);load();
