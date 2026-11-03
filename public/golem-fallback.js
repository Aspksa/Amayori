import {createRenderState, normalizeGolemSettings} from '/golem-state.js';

const canvas = document.getElementById('fallback-brain');
const ctx = canvas.getContext('2d');
const notice = document.getElementById('notice');
const brain = document.getElementById('brain');
let graph = {nodes: [], edges: []};
let angle = 0, active = true, previous = 0;
let loading = false, lastUpdated = 0;
const status = document.createElement('span');
status.id = 'golem-data-status';
status.setAttribute('role', 'status');
status.style.cssText = 'position:fixed;bottom:12px;left:12px;z-index:20;color:#d9bf8d;background:rgba(5,6,10,.82);padding:7px 11px;border-radius:8px;font:12px system-ui;pointer-events:none';
document.getElementById('universe').append(status);
function showStatus(message) { status.textContent = message; }
showStatus('Загрузка памяти… · R — обновить');
let preferences = normalizeGolemSettings();
const state = createRenderState({onChange(ready, reason) {
  active = !ready;
  brain.classList.toggle('golem-ready', ready);
  canvas.hidden = ready;
  notice.textContent = ready ? '' : reason;
}});
brain.addEventListener('golem-rendered', () => state.frame());
brain.addEventListener('golem-render-error', event => state.fail(event.detail));
brain.addEventListener('webglcontextlost', event => {
  event.preventDefault();
  state.fail('3D восстанавливается — работает резервная карта');
});
// Restoration alone is insufficient: wait for a successfully rendered frame.
brain.addEventListener('webglcontextrestored', () => state.fail('Восстановление 3D…'));
function resize() {
  const d = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(innerWidth * d));
  canvas.height = Math.max(1, Math.round(innerHeight * d));
  ctx.setTransform(d, 0, 0, d, 0, 0);
}
function draw(now) {
  requestAnimationFrame(draw);
  const elapsed = Math.min(50, now - previous || 16);
  previous = now;
  if (!active || document.hidden) return;
  const w = innerWidth, h = innerHeight;
  ctx.clearRect(0, 0, w, h);
  const n = Math.min(1500, Math.max(graph.nodes.length, 180));
  const radius = Math.min(w * .38, h * .4, 280), positions = [];
  for (let i = 0; i < n; i++) {
    const a = i * 2.39996323 + angle, z = 1 - 2 * (i + .5) / n, r = Math.sqrt(1 - z * z);
    positions.push({x: w / 2 + Math.cos(a) * r * radius, y: h / 2 + Math.sin(a) * r * radius * .78, z});
  }
  const lookup = new Map(graph.nodes.map((value, i) => [String(value.id), i]));
  ctx.lineWidth = .7;
  for (const edge of graph.edges.slice(0, 1200)) {
    const a = positions[lookup.get(String(edge.source))], b = positions[lookup.get(String(edge.target))];
    if (!a || !b) continue;
    ctx.strokeStyle = 'rgba(212,170,96,.22)';
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  for (let i = 0; i < n; i++) {
    const p = positions[i], size = (1.3 + (p.z + 1) * 1.2) * preferences.nodeSize / 2;
    ctx.fillStyle = i < graph.nodes.length ? '#e6ba72' : 'rgba(158,144,116,.55)';
    ctx.beginPath(); ctx.arc(p.x, p.y, size, 0, Math.PI * 2); ctx.fill();
  }
  if (preferences.autoRotate && !matchMedia('(prefers-reduced-motion: reduce)').matches) angle += elapsed * .000084;
}
async function refresh() {
  if (loading) return;
  loading = true;
  try {
    const r = await fetch('/api/golem/knowledge?limit=300', {cache: 'no-store'});
    if (!r.ok) throw Error('HTTP ' + r.status);
    let data = await r.json();
    if (!data.nodes?.length) {
      const response = await fetch('/api/graph', {cache: 'no-store'});
      if (response.ok) { const local = await response.json(); if (local.nodes?.length) data = local; }
    }
    graph = {nodes: data.nodes || [], edges: data.edges || []};
    lastUpdated = Date.now();
    showStatus(`${graph.nodes.length} узлов · ${graph.edges.length} связей · R — обновить`);
  } catch (error) {
    if (active) notice.textContent = 'Данные недоступны: ' + error.message + (lastUpdated ? ' · сохранена последняя карта' : ' · показана демонстрационная сеть');
    showStatus('Ошибка обновления · R — повторить');
  } finally { loading = false; }
}
async function refreshSettings() {
  try {
    const response = await fetch('/api/golem/settings', {cache: 'no-store'});
    if (!response.ok) throw Error('HTTP ' + response.status);
    preferences = normalizeGolemSettings(await response.json());
    brain.dispatchEvent(new CustomEvent('golem-settings', {detail: preferences}));
  } catch (error) { console.warn('Golem settings:', error.message); }
}
resize();
requestAnimationFrame(draw);
void refresh();
await refreshSettings();
try { await import('/golem-immersive.js'); }
catch (error) { state.fail('3D не загрузился: ' + error.message + ' · работает резервная карта'); }
setInterval(() => { if (!document.hidden) state.check(); }, 1000);
setInterval(() => { if (!document.hidden) { void refresh(); void refreshSettings(); } }, 12000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { state.fail('Возобновление 3D…'); void refreshSettings(); }
});
addEventListener('resize', resize);

// Refresh the underlying graph without reloading the WebGL scene.
document.addEventListener('keydown', event => {
  if (event.key.toLowerCase() !== 'r' || event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
  const target = event.target;
  if (target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
  void refresh();
});

// The explorer remains available when 3D cannot initialize.
void import('/golem-network-explorer.js').catch(error => console.warn('Golem network explorer:', error));
