import * as THREE from '/three.module.js';
import {normalizeGolemSettings} from '/golem-state.js';

const canvas = document.getElementById('brain');
const detail = document.getElementById('detail');
const body = document.getElementById('detail-body');
const notice = document.getElementById('notice');
const legend = document.getElementById('legend');

let renderer;
try {
  renderer = new THREE.WebGLRenderer({canvas, antialias: true, powerPreference: 'high-performance'});
} catch (error) {
  notice.textContent = '3D недоступен: ' + error.message;
  throw error;
}
const BACKGROUND = 0x0c0d10;
renderer.setClearColor(BACKGROUND, 1);

let preferences = normalizeGolemSettings();
try {
  const response = await fetch('/api/golem/settings', {cache: 'no-store'});
  if (response.ok) preferences = normalizeGolemSettings(await response.json());
} catch (error) { console.warn('Golem settings:', error.message); }

const MAX_NODES = 1200, MAX_EDGES = 1500, MAX_PULSES = 24;
// Warm tones only: the Golem keeps the obsidian-and-gold palette of the app.
const CLUSTER_COLORS = [0xf2cd87, 0xf4e6c4, 0xc8873f, 0xcdb87e, 0x9d8f5e, 0x8c8794];
const TRACE_COLOR = 0xffd47c;
const EDGE_CONFIRMED = 0xc9a86a;
const EDGE_EXTRACTED = 0x7e7358;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(BACKGROUND, 200, 760);
const camera = new THREE.PerspectiveCamera(48, 1, .1, 3000);
const brain = new THREE.Group();
scene.add(brain);

// Without lights every node was a flat disc and the sphere read as a 2D ring.
scene.add(new THREE.AmbientLight(0x5c5341, 1.5));
const keyLight = new THREE.PointLight(0xffdfae, 1.75, 0, 0);
keyLight.position.set(260, 210, 330);
scene.add(keyLight);
const rimLight = new THREE.PointLight(0x8fb0da, 0.62, 0, 0);
rimLight.position.set(-300, -170, -260);
scene.add(rimLight);

// One instanced mesh and one line batch replace ~2700 separate scene objects.
const nodeMesh = new THREE.InstancedMesh(
  new THREE.SphereGeometry(1, 12, 10),
  new THREE.MeshPhongMaterial({shininess: 34, specular: 0x4b4030}),
  MAX_NODES,
);
nodeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
nodeMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_NODES * 3), 3);
nodeMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
nodeMesh.frustumCulled = false;
nodeMesh.count = 0;
brain.add(nodeMesh);

const edgeGeometry = new THREE.BufferGeometry();
const edgePositions = new Float32Array(MAX_EDGES * 6);
const edgeColors = new Float32Array(MAX_EDGES * 6);
edgeGeometry.setAttribute('position', new THREE.BufferAttribute(edgePositions, 3).setUsage(THREE.DynamicDrawUsage));
edgeGeometry.setAttribute('color', new THREE.BufferAttribute(edgeColors, 3).setUsage(THREE.DynamicDrawUsage));
const edgeMesh = new THREE.LineSegments(edgeGeometry, new THREE.LineBasicMaterial({
  vertexColors: true, transparent: true, opacity: 0.62, depthWrite: false,
}));
edgeMesh.frustumCulled = false;
brain.add(edgeMesh);

// Travelling dots along the edges the last answer actually used.
const pulseMesh = new THREE.InstancedMesh(
  new THREE.SphereGeometry(1, 8, 6),
  new THREE.MeshBasicMaterial({
    color: 0xffeec0, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }),
  MAX_PULSES,
);
pulseMesh.frustumCulled = false;
pulseMesh.count = 0;
brain.add(pulseMesh);

const positions = new Float32Array(MAX_NODES * 3);
const velocities = new Float32Array(MAX_NODES * 3);
const radii = new Float32Array(MAX_NODES);
const clusterOf = new Int32Array(MAX_NODES);
const degree = new Int32Array(MAX_NODES);
let items = [], edges = [], adjacency = [], clusters = [], maxDegree = 1;
let indexById = new Map();
let placeholderMode = false, layoutLeft = 0;
let pulses = [];
let activeFactIds = new Set(), highlightedNodes = new Set();
let selected = null, loading = false, lastFingerprint = '', contextLost = false;
let frameAverage = 16.7, lastHeartbeat = -Infinity, previousTraceId = null;

const matrix = new THREE.Matrix4();
const colorScratch = new THREE.Color();
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// The camera orbits a target instead of sitting on a fixed axis, so it can fly to a node.
const orbit = {theta: 0.7, phi: 1.2, dist: 440, target: new THREE.Vector3()};
const want = {theta: 0.7, phi: 1.2, dist: 440, target: new THREE.Vector3()};
let spin = 0, drag = null, userFramed = false;

const noise = (i, salt) => {
  const value = Math.sin((i + 1) * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
};
const shorten = (value) => {
  const text = String(value);
  return text.length > 24 ? text.slice(0, 23).trimEnd() + '…' : text;
};

function resize() {
  const w = Math.max(1, innerWidth), h = Math.max(1, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1,
    frameAverage > 34 ? 1 : frameAverage > 23 ? 1.25 : Math.min(w, h) < 650 ? 1.25 : 1.7));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function updateCamera() {
  const ring = Math.sin(orbit.phi);
  camera.position.set(
    orbit.target.x + orbit.dist * ring * Math.sin(orbit.theta),
    orbit.target.y + orbit.dist * Math.cos(orbit.phi),
    orbit.target.z + orbit.dist * ring * Math.cos(orbit.theta),
  );
  camera.lookAt(orbit.target);
  camera.updateMatrixWorld();
  scene.fog.near = Math.max(1, orbit.dist - 250);
  scene.fog.far = orbit.dist + 340;
}

function draw() {
  try {
    updateCamera();
    renderer.render(scene, camera);
    if (renderer.getContext().isContextLost()) return;
    const now = performance.now();
    if (now - lastHeartbeat > 1000) {
      lastHeartbeat = now;
      canvas.dispatchEvent(new Event('golem-rendered'));
    }
  } catch (error) {
    contextLost = true;
    canvas.dispatchEvent(new CustomEvent('golem-render-error', {
      detail: 'Ошибка 3D — работает резервная карта: ' + error.message,
    }));
  }
}

function nodeRadius(i) {
  const base = 2.4 * (preferences.nodeSize / 2);
  if (placeholderMode) return base * 0.62;
  return base * (0.55 + 0.85 * Math.sqrt(degree[i] / Math.max(1, maxDegree)));
}

function uploadNodes() {
  const count = Math.min(items.length, MAX_NODES);
  for (let i = 0; i < count; i++) {
    matrix.makeScale(radii[i], radii[i], radii[i]);
    matrix.setPosition(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
    nodeMesh.setMatrixAt(i, matrix);
  }
  nodeMesh.count = count;
  nodeMesh.instanceMatrix.needsUpdate = true;
  nodeMesh.computeBoundingSphere();
}

function uploadEdges() {
  const count = Math.min(edges.length, MAX_EDGES);
  for (let e = 0; e < count; e++) {
    const edge = edges[e], offset = e * 6, a = edge.a * 3, b = edge.b * 3;
    edgePositions[offset] = positions[a];
    edgePositions[offset + 1] = positions[a + 1];
    edgePositions[offset + 2] = positions[a + 2];
    edgePositions[offset + 3] = positions[b];
    edgePositions[offset + 4] = positions[b + 1];
    edgePositions[offset + 5] = positions[b + 2];
  }
  edgeGeometry.setDrawRange(0, count * 2);
  edgeGeometry.attributes.position.needsUpdate = true;
}

// Regions grow outward from the busiest nodes. Label propagation was tried first
// and collapsed to a single label: on a connected graph it merges everything.
function buildClusters(count) {
  const wanted = Math.max(1, Math.min(CLUSTER_COLORS.length, Math.round(Math.sqrt(count / 6))));
  const order = Array.from({length: count}, (_, i) => i)
    .sort((a, b) => degree[b] - degree[a] || a - b);
  const seeds = [], blocked = new Set();
  for (const candidate of order) {
    if (seeds.length >= wanted) break;
    if (blocked.has(candidate) || !degree[candidate]) continue;
    seeds.push(candidate);
    blocked.add(candidate);
    for (const neighbour of adjacency[candidate] || []) blocked.add(neighbour);
  }
  if (!seeds.length && count) seeds.push(order[0]);
  const owner = new Int32Array(count).fill(-1);
  let frontier = [];
  seeds.forEach((seed, index) => { owner[seed] = index; frontier.push(seed); });
  while (frontier.length) {
    const next = [];
    for (const node of frontier)
      for (const neighbour of adjacency[node] || [])
        if (owner[neighbour] === -1) { owner[neighbour] = owner[node]; next.push(neighbour); }
    frontier = next;
  }
  const loose = seeds.length;
  let hasLoose = false;
  for (let i = 0; i < count; i++) if (owner[i] === -1) { owner[i] = loose; hasLoose = true; }
  const groups = new Map();
  for (let i = 0; i < count; i++) {
    let group = groups.get(owner[i]);
    if (!group) groups.set(owner[i], group = []);
    group.push(i);
  }
  clusters = [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([key, members], index) => {
      let leader = members[0];
      for (const member of members) if (degree[member] > degree[leader]) leader = member;
      for (const member of members) clusterOf[member] = index;
      const item = items[leader];
      return {
        members,
        size: members.length,
        color: CLUSTER_COLORS[index % CLUSTER_COLORS.length],
        title: hasLoose && key === loose
          ? 'Отдельные знания'
          : shorten(item ? (item.label || item.id) : ''),
        centre: new THREE.Vector3(),
      };
    });
}

// Put the camera where the whole brain fits: relaxation changes its size, so a
// fixed distance left it either a speck or cropped.
function fitCamera(count) {
  if (userFramed || !count) return;
  let furthest = 1;
  for (let i = 0; i < count; i++)
    furthest = Math.max(furthest, Math.hypot(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]));
  const half = Math.tan((camera.fov / 2) * Math.PI / 180) * Math.min(1, camera.aspect);
  want.dist = Math.max(170, Math.min(950, furthest / Math.max(0.2, half) * 1.08));
}

// Keep the brain filling the frame: relaxation otherwise shrinks it to a speck.
function normalizeLayout(count) {
  if (!count) return;
  let furthest = 1;
  for (let i = 0; i < count; i++)
    furthest = Math.max(furthest, Math.hypot(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]));
  const target = Math.min(210, 115 + Math.sqrt(count) * 3.2);
  const scale = target / furthest;
  if (Math.abs(scale - 1) < 0.015) return;
  for (let i = 0; i < count * 3; i++) positions[i] *= scale;
}

function seedLayout(count) {
  const spread = Math.min(190, 96 + Math.sqrt(count) * 3.4);
  const total = Math.max(1, clusters.length);
  clusters.forEach((cluster, index) => {
    const angle = index * 2.399963229728653;
    const z = total === 1 ? 0 : 1 - 2 * (index + 0.5) / total;
    const ring = Math.sqrt(Math.max(0, 1 - z * z));
    cluster.centre.set(Math.cos(angle) * ring * spread, Math.sin(angle) * ring * spread, z * spread);
  });
  for (let i = 0; i < count; i++) {
    const cluster = clusters[clusterOf[i]];
    const cx = cluster ? cluster.centre.x : 0, cy = cluster ? cluster.centre.y : 0, cz = cluster ? cluster.centre.z : 0;
    const local = 16 + Math.sqrt(cluster ? cluster.size : 1) * 7;
    positions[i * 3] = cx + (noise(i, 1) - 0.5) * local;
    positions[i * 3 + 1] = cy + (noise(i, 2) - 0.5) * local;
    positions[i * 3 + 2] = cz + (noise(i, 3) - 0.5) * local;
    velocities[i * 3] = velocities[i * 3 + 1] = velocities[i * 3 + 2] = 0;
  }
}

// One relaxation step: cluster separation, edge springs, local repulsion.
function relax(count) {
  for (const cluster of clusters) {
    let x = 0, y = 0, z = 0;
    for (const member of cluster.members) {
      x += positions[member * 3];
      y += positions[member * 3 + 1];
      z += positions[member * 3 + 2];
    }
    const share = 1 / Math.max(1, cluster.members.length);
    cluster.centre.set(x * share, y * share, z * share);
  }
  for (let a = 0; a < clusters.length; a++)
    for (let b = a + 1; b < clusters.length; b++) {
      const first = clusters[a].centre, second = clusters[b].centre;
      const dx = first.x - second.x, dy = first.y - second.y, dz = first.z - second.z;
      const far = Math.max(28, Math.hypot(dx, dy, dz));
      const push = Math.min(2.4, 42000 / (far * far * far));
      for (const member of clusters[a].members) {
        velocities[member * 3] += dx / far * push;
        velocities[member * 3 + 1] += dy / far * push;
        velocities[member * 3 + 2] += dz / far * push;
      }
      for (const member of clusters[b].members) {
        velocities[member * 3] -= dx / far * push;
        velocities[member * 3 + 1] -= dy / far * push;
        velocities[member * 3 + 2] -= dz / far * push;
      }
    }
  for (const edge of edges) {
    const a = edge.a * 3, b = edge.b * 3;
    const dx = positions[b] - positions[a];
    const dy = positions[b + 1] - positions[a + 1];
    const dz = positions[b + 2] - positions[a + 2];
    const far = Math.max(1, Math.hypot(dx, dy, dz));
    const pull = (far - 34) * 0.0055;
    velocities[a] += dx / far * pull;
    velocities[a + 1] += dy / far * pull;
    velocities[a + 2] += dz / far * pull;
    velocities[b] -= dx / far * pull;
    velocities[b + 1] -= dy / far * pull;
    velocities[b + 2] -= dz / far * pull;
  }
  const cell = 30, buckets = new Map();
  for (let i = 0; i < count; i++) {
    const key = Math.round(positions[i * 3] / cell) + ',' +
      Math.round(positions[i * 3 + 1] / cell) + ',' + Math.round(positions[i * 3 + 2] / cell);
    let list = buckets.get(key);
    if (!list) buckets.set(key, list = []);
    if (list.length < 18) list.push(i);
  }
  for (const list of buckets.values())
    for (let a = 0; a < list.length; a++)
      for (let b = a + 1; b < list.length; b++) {
        const i = list[a] * 3, j = list[b] * 3;
        const dx = positions[i] - positions[j];
        const dy = positions[i + 1] - positions[j + 1];
        const dz = positions[i + 2] - positions[j + 2];
        const far = Math.max(4, Math.hypot(dx, dy, dz));
        const push = Math.min(3, 2600 / (far * far));
        velocities[i] += dx / far * push;
        velocities[i + 1] += dy / far * push;
        velocities[i + 2] += dz / far * push;
        velocities[j] -= dx / far * push;
        velocities[j + 1] -= dy / far * push;
        velocities[j + 2] -= dz / far * push;
      }
  for (let i = 0; i < count * 3; i++) {
    velocities[i] -= positions[i] * 0.0022;
    velocities[i] *= 0.82;
    positions[i] += Math.max(-9, Math.min(9, velocities[i]));
  }
}

function paintNodes() {
  const count = Math.min(items.length, MAX_NODES);
  for (let i = 0; i < count; i++) {
    const cluster = clusters[clusterOf[i]];
    colorScratch.setHex(highlightedNodes.has(i) ? TRACE_COLOR
      : cluster ? cluster.color : CLUSTER_COLORS[i % CLUSTER_COLORS.length]);
    if (placeholderMode) colorScratch.multiplyScalar(0.5);
    nodeMesh.setColorAt(i, colorScratch);
  }
  if (nodeMesh.instanceColor) nodeMesh.instanceColor.needsUpdate = true;
}

function paintEdges() {
  const count = Math.min(edges.length, MAX_EDGES);
  for (let e = 0; e < count; e++) {
    const edge = edges[e], offset = e * 6;
    // Gold marks a fact you confirmed; dim bronze marks one the model extracted.
    const active = activeFactIds.has(edge.factId);
    colorScratch.setHex(active ? TRACE_COLOR : edge.confirmed ? EDGE_CONFIRMED : EDGE_EXTRACTED);
    if (placeholderMode) colorScratch.multiplyScalar(0.45);
    edgeColors[offset] = edgeColors[offset + 3] = colorScratch.r;
    edgeColors[offset + 1] = edgeColors[offset + 4] = colorScratch.g;
    edgeColors[offset + 2] = edgeColors[offset + 5] = colorScratch.b;
  }
  edgeGeometry.attributes.color.needsUpdate = true;
}

function renderLegend() {
  legend.replaceChildren();
  if (placeholderMode || !clusters.length) { legend.hidden = true; return; }
  const title = document.createElement('p');
  title.className = 'legend-title';
  title.textContent = 'Области памяти';
  legend.append(title);
  for (const cluster of clusters.slice(0, 5)) {
    if (!cluster.title) continue;
    const row = document.createElement('p');
    row.className = 'legend-row';
    const swatch = document.createElement('span');
    swatch.className = 'legend-swatch';
    swatch.style.background = '#' + cluster.color.toString(16).padStart(6, '0');
    const text = document.createElement('span');
    text.textContent = cluster.title + ' · ' + cluster.size;
    row.append(swatch, text);
    legend.append(row);
  }
  const note = document.createElement('p');
  note.className = 'legend-note';
  note.textContent = 'Яркая связь — подтверждено вами, тусклая — извлечено ИИ. Бегущие огни показывают факты последнего ответа.';
  legend.append(note);
  legend.hidden = false;
}

function populate(data) {
  const incoming = data.nodes || [], links = data.edges || [];
  placeholderMode = incoming.length === 0;
  indexById = new Map();
  degree.fill(0);
  clusterOf.fill(0);
  highlightedNodes = new Set();
  if (placeholderMode) {
    items = Array.from({length: 190}, (_, i) => ({id: 'core-' + i, label: '', placeholder: true}));
    edges = [];
    clusters = [];
    maxDegree = 1;
    const count = items.length;
    for (let i = 0; i < count; i++) {
      const angle = i * 2.399963229728653, z = 1 - 2 * (i + 0.5) / count;
      const ring = Math.sqrt(Math.max(0, 1 - z * z)), radius = 118 + Math.sin(i * 13.7) * 10;
      positions[i * 3] = Math.cos(angle) * ring * radius;
      positions[i * 3 + 1] = Math.sin(angle) * ring * radius;
      positions[i * 3 + 2] = z * radius;
      radii[i] = nodeRadius(i);
    }
    for (let i = 0; i < count; i++) {
      const j = (i * 37 + 11) % count;
      if (i !== j) edges.push({a: i, b: j, factId: '', source: '', target: '', confirmed: false});
    }
    layoutLeft = 0;
    uploadNodes(); uploadEdges(); paintNodes(); paintEdges(); renderLegend();
    pulses = [];
    pulseMesh.count = 0;
    return;
  }
  items = incoming.slice(0, MAX_NODES);
  items.forEach((item, index) => indexById.set(String(item.id), index));
  edges = [];
  adjacency = items.map(() => []);
  for (const link of links) {
    if (edges.length >= MAX_EDGES) break;
    const a = indexById.get(String(link.source)), b = indexById.get(String(link.target));
    if (a === undefined || b === undefined || a === b) continue;
    edges.push({
      a, b,
      factId: String(link.id),
      source: String(link.source),
      target: String(link.target),
      confirmed: link.sourceType === 'user-confirmed',
    });
    adjacency[a].push(b);
    adjacency[b].push(a);
    degree[a]++;
    degree[b]++;
  }
  maxDegree = Math.max(1, ...items.map((_, i) => degree[i]));
  buildClusters(items.length);
  seedLayout(items.length);
  for (let i = 0; i < items.length; i++) radii[i] = nodeRadius(i);
  layoutLeft = reduced ? 0 : 110;
  if (reduced) { for (let step = 0; step < 110; step++) relax(items.length); normalizeLayout(items.length); }
  fitCamera(items.length);
  uploadNodes(); uploadEdges(); paintNodes(); paintEdges(); renderLegend();
  buildPulses();
}

function buildPulses() {
  pulses = [];
  if (placeholderMode) { pulseMesh.count = 0; return; }
  for (let e = 0; e < edges.length && pulses.length < MAX_PULSES; e++)
    if (activeFactIds.has(edges[e].factId)) pulses.push({edge: e, phase: noise(e, 7)});
  pulseMesh.count = pulses.length;
}

function updatePulses(delta) {
  if (!pulses.length) return;
  const speed = reduced ? 0 : delta * 0.00055;
  const size = 1.5 * (preferences.nodeSize / 2) + 1;
  for (let p = 0; p < pulses.length; p++) {
    const pulse = pulses[p];
    pulse.phase = (pulse.phase + speed) % 1;
    const edge = edges[pulse.edge];
    if (!edge) continue;
    const a = edge.a * 3, b = edge.b * 3, t = pulse.phase;
    matrix.makeScale(size, size, size);
    matrix.setPosition(
      positions[a] + (positions[b] - positions[a]) * t,
      positions[a + 1] + (positions[b + 1] - positions[a + 1]) * t,
      positions[a + 2] + (positions[b + 2] - positions[a + 2]) * t,
    );
    pulseMesh.setMatrixAt(p, matrix);
  }
  pulseMesh.instanceMatrix.needsUpdate = true;
}

function applyTrace() {
  highlightedNodes = new Set();
  for (const edge of edges)
    if (activeFactIds.has(edge.factId)) { highlightedNodes.add(edge.a); highlightedNodes.add(edge.b); }
  paintNodes();
  paintEdges();
  buildPulses();
}

function applyPreferences(value) {
  preferences = normalizeGolemSettings(value);
  const count = Math.min(items.length, MAX_NODES);
  for (let i = 0; i < count; i++) radii[i] = nodeRadius(i);
  uploadNodes();
}
canvas.addEventListener('golem-settings', (event) => applyPreferences(event.detail));

function inspect(index) {
  body.replaceChildren();
  const heading = document.createElement('h2');
  if (placeholderMode) {
    heading.textContent = 'Ядро Голема';
    const text = document.createElement('p');
    text.textContent = 'Это визуальная оболочка мозга. Реальные нейроны появятся после сохранения знаний или сообщений чата.';
    body.append(heading, text);
    selected = null;
    detail.hidden = false;
    return;
  }
  const item = items[index];
  selected = String(item.id);
  heading.textContent = String(item.label || item.id);
  body.append(heading);
  const cluster = clusters[clusterOf[index]];
  if (cluster && cluster.title) {
    const area = document.createElement('p');
    area.textContent = 'Область памяти: ' + cluster.title;
    body.append(area);
  }
  const links = document.createElement('p');
  links.textContent = 'Связей: ' + degree[index];
  body.append(links);
  const neighbours = [];
  for (const edge of edges) {
    if (neighbours.length >= 8) break;
    if (edge.a === index) neighbours.push(items[edge.b]);
    else if (edge.b === index) neighbours.push(items[edge.a]);
  }
  if (neighbours.length) {
    const title = document.createElement('p');
    title.textContent = 'Соседние узлы:';
    const list = document.createElement('ul');
    for (const neighbour of neighbours) {
      const row = document.createElement('li');
      row.textContent = String(neighbour.label || neighbour.id);
      list.append(row);
    }
    body.append(title, list);
  }
  // Fly to the node instead of leaving the camera where it was.
  userFramed = true;
  want.target.set(positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]);
  want.dist = Math.max(130, Math.min(want.dist, 260));
  detail.hidden = false;
}

function release() {
  detail.hidden = true;
  selected = null;
  want.target.set(0, 0, 0);
  userFramed = false;
  fitCamera(Math.min(items.length, MAX_NODES));
}

canvas.addEventListener('pointerdown', (event) => {
  drag = {x: event.clientX, y: event.clientY, moved: false};
  spin = 0;
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', (event) => {
  if (!drag) return;
  const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
  if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
  want.theta -= dx * 0.005;
  want.phi = Math.max(0.16, Math.min(Math.PI - 0.16, want.phi - dy * 0.005));
  spin = -dx * 0.005;
  drag.x = event.clientX;
  drag.y = event.clientY;
});
canvas.addEventListener('pointerup', (event) => {
  if (!drag) return;
  const moved = drag.moved;
  drag = null;
  if (moved) return;
  spin = 0;
  const rect = canvas.getBoundingClientRect();
  mouse.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
  updateCamera();
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObject(nodeMesh);
  if (hits.length && hits[0].instanceId !== undefined && hits[0].instanceId < items.length) inspect(hits[0].instanceId);
  else release();
});
canvas.addEventListener('pointercancel', () => { drag = null; });
canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  userFramed = true;
  want.dist = Math.max(130, Math.min(950, want.dist * (event.deltaY > 0 ? 1.12 : 0.89)));
}, {passive: false});
document.getElementById('close-detail').addEventListener('click', release);
addEventListener('keydown', (event) => { if (event.key === 'Escape') release(); });

async function refresh() {
  if (loading) return;
  loading = true;
  try {
    const response = await fetch('/api/golem/knowledge?limit=300');
    if (!response.ok) throw Error('HTTP ' + response.status);
    let data = await response.json();
    if (!data.nodes?.length) {
      const fallback = await fetch('/api/graph');
      if (fallback.ok) {
        const local = await fallback.json();
        if (local.nodes?.length) data = local;
      }
    }
    const fingerprint = JSON.stringify([data.nodes, data.edges]);
    if (fingerprint !== lastFingerprint) {
      lastFingerprint = fingerprint;
      populate(data);
      if (selected !== null && !indexById.has(String(selected))) release();
    }
    notice.textContent = '';
  } catch (error) {
    notice.textContent = 'Нет связи с памятью: ' + error.message;
  } finally {
    loading = false;
  }
}

async function refreshTraces() {
  try {
    const response = await fetch('/api/golem/live', {cache: 'no-store'});
    if (!response.ok) return;
    const data = await response.json();
    const latest = data.traces?.[0];
    if (!latest) return;
    const id = String(latest.id);
    if (id === previousTraceId) return;
    previousTraceId = id;
    activeFactIds = new Set((latest.fact_ids || []).map(String));
    applyTrace();
  } catch (error) { console.warn('Golem trace refresh:', error.message); }
}

canvas.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  contextLost = true;
  notice.textContent = 'Восстановление 3D-контекста…';
});
canvas.addEventListener('webglcontextrestored', () => {
  contextLost = false;
  lastHeartbeat = -Infinity;
  lastFingerprint = '';
  resize();
  refresh();
  refreshTraces();
  notice.textContent = '';
});
addEventListener('resize', resize);

resize();
populate({nodes: [], edges: []});
refresh();
refreshTraces();
setInterval(() => { if (!document.hidden) { refresh(); refreshTraces(); } }, 12000);

let previous = 0;
function animate(now) {
  requestAnimationFrame(animate);
  const delta = Math.min(50, (now - previous) || 16);
  if (previous) {
    const before = frameAverage;
    frameAverage = frameAverage * 0.96 + Math.min(100, now - previous) * 0.04;
    if ((before < 24 && frameAverage >= 24) || (before > 34 && frameAverage <= 34)) resize();
  }
  previous = now;
  if (document.hidden || contextLost) return;
  if (layoutLeft > 0) {
    const steps = Math.min(layoutLeft, frameAverage > 30 ? 1 : 3);
    for (let step = 0; step < steps; step++) relax(items.length);
    layoutLeft -= steps;
    normalizeLayout(items.length);
    fitCamera(items.length);
    uploadNodes();
    uploadEdges();
  }
  if (preferences.autoRotate && !reduced && !drag) want.theta += delta * 0.00008;
  if (!drag && Math.abs(spin) > 0.00002) { want.theta += spin; spin *= 0.94; }
  orbit.theta += (want.theta - orbit.theta) * 0.16;
  orbit.phi += (want.phi - orbit.phi) * 0.16;
  orbit.dist += (want.dist - orbit.dist) * 0.12;
  orbit.target.lerp(want.target, 0.1);
  updatePulses(delta);
  draw();
}
requestAnimationFrame(animate);
