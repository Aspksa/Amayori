import * as THREE from '/three.module.js';
import {normalizeGolemSettings, constellationName, inventConstellationName} from '/golem-state.js';

const canvas = document.getElementById('brain');
const detail = document.getElementById('detail');
const body = document.getElementById('detail-body');
const notice = document.getElementById('notice');
const legend = document.getElementById('legend');
const labelLayer = document.getElementById('sky-labels');
const searchBar = document.getElementById('sky-search');
const searchInput = document.getElementById('sky-query');
const searchCount = document.getElementById('sky-count');

let renderer;
try {
  renderer = new THREE.WebGLRenderer({canvas, antialias: true, powerPreference: 'high-performance'});
} catch (error) {
  notice.textContent = '3D недоступен: ' + error.message;
  throw error;
}
const SPACE = 0x05060a;
renderer.setClearColor(SPACE, 1);

let preferences = normalizeGolemSettings();
try {
  const response = await fetch('/api/golem/settings', {cache: 'no-store'});
  if (response.ok) preferences = normalizeGolemSettings(await response.json());
} catch (error) { console.warn('Golem settings:', error.message); }

const MAX_STARS = 1200, MAX_PLANETS = 1500, MAX_LINKS = 700, MAX_SIGNALS = 40, GAS = 5200;
const STAR_TONES = [0xfff4dc, 0xf2cd87, 0xe8b96a, 0xd7c49a, 0xc89a55, 0xbfae84];
const FLARE = 0xfff0c4;
const DIM = 0x6b4a33;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 9000);
const galaxy = new THREE.Group();
scene.add(galaxy);
scene.add(new THREE.AmbientLight(0x4e4636, 1.25));
const coreLight = new THREE.PointLight(0xffdca8, 2.1, 0, 0);
scene.add(coreLight);

function sprite(stops) {
  const size = 128, surface = document.createElement('canvas');
  surface.width = surface.height = size;
  const paint = surface.getContext('2d');
  const gradient = paint.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [at, tone] of stops) gradient.addColorStop(at, tone);
  paint.fillStyle = gradient;
  paint.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(surface);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
const glare = sprite([[0, 'rgba(255,255,255,1)'], [0.16, 'rgba(255,241,208,.8)'], [0.5, 'rgba(255,206,136,.18)'], [1, 'rgba(255,190,110,0)']]);
const haze = sprite([[0, 'rgba(255,214,150,.16)'], [0.55, 'rgba(188,150,112,.05)'], [1, 'rgba(120,110,120,0)']]);

const pointShader = () => new THREE.ShaderMaterial({
  uniforms: {map: {value: glare}, uScale: {value: 1}},
  vertexShader: 'attribute float size; attribute vec3 tone; varying vec3 vTone; uniform float uScale;' +
    'void main(){ vTone = tone; vec4 mv = modelViewMatrix * vec4(position,1.0);' +
    'gl_PointSize = size * uScale * (330.0 / -mv.z); gl_Position = projectionMatrix * mv; }',
  fragmentShader: 'uniform sampler2D map; varying vec3 vTone;' +
    'void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vTone,1.0) * t; }',
  transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
});

// Stars are solid so they can be picked and shaded; the glow layer is the flare.
const starMesh = new THREE.InstancedMesh(
  new THREE.SphereGeometry(1, 8, 6),
  new THREE.MeshBasicMaterial({}),
  MAX_STARS,
);
starMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_STARS * 3), 3);
starMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
starMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
starMesh.frustumCulled = false;
starMesh.count = 0;
galaxy.add(starMesh);

const glowGeometry = new THREE.BufferGeometry();
const glowPos = new Float32Array(MAX_STARS * 3);
const glowSize = new Float32Array(MAX_STARS);
const glowTone = new Float32Array(MAX_STARS * 3);
glowGeometry.setAttribute('position', new THREE.BufferAttribute(glowPos, 3).setUsage(THREE.DynamicDrawUsage));
glowGeometry.setAttribute('size', new THREE.BufferAttribute(glowSize, 1).setUsage(THREE.DynamicDrawUsage));
glowGeometry.setAttribute('tone', new THREE.BufferAttribute(glowTone, 3).setUsage(THREE.DynamicDrawUsage));
const glowMaterial = pointShader();
const glowPoints = new THREE.Points(glowGeometry, glowMaterial);
glowPoints.frustumCulled = false;
galaxy.add(glowPoints);

// Planets: every fact orbits the entity it describes.
const planetMesh = new THREE.InstancedMesh(
  new THREE.SphereGeometry(1, 6, 5),
  new THREE.MeshPhongMaterial({shininess: 18, specular: 0x3a3226}),
  MAX_PLANETS,
);
planetMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PLANETS * 3), 3);
planetMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
planetMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
planetMesh.frustumCulled = false;
planetMesh.count = 0;
galaxy.add(planetMesh);

// Constellation figures: drawn only inside one region, never across the sky.
const linkGeometry = new THREE.BufferGeometry();
const linkPos = new Float32Array(MAX_LINKS * 6);
const linkTone = new Float32Array(MAX_LINKS * 6);
linkGeometry.setAttribute('position', new THREE.BufferAttribute(linkPos, 3).setUsage(THREE.DynamicDrawUsage));
linkGeometry.setAttribute('color', new THREE.BufferAttribute(linkTone, 3).setUsage(THREE.DynamicDrawUsage));
const linkLines = new THREE.LineSegments(linkGeometry, new THREE.LineBasicMaterial({
  vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false,
}));
linkLines.frustumCulled = false;
galaxy.add(linkLines);

// The archive that has not condensed into knowledge yet.
const gasGeometry = new THREE.BufferGeometry();
const gasPos = new Float32Array(GAS * 3);
const gasSize = new Float32Array(GAS);
const gasTone = new Float32Array(GAS * 3);
gasGeometry.setAttribute('position', new THREE.BufferAttribute(gasPos, 3));
gasGeometry.setAttribute('size', new THREE.BufferAttribute(gasSize, 1));
gasGeometry.setAttribute('tone', new THREE.BufferAttribute(gasTone, 3));
const gasPoints = new THREE.Points(gasGeometry, pointShader());
gasPoints.frustumCulled = false;
galaxy.add(gasPoints);

const nebulaMaterial = new THREE.SpriteMaterial({map: haze, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false});
const nebulae = [];
for (let i = 0; i < 14; i++) {
  const cloud = new THREE.Sprite(nebulaMaterial.clone());
  cloud.visible = false;
  galaxy.add(cloud);
  nebulae.push(cloud);
}
const bulge = new THREE.Sprite(nebulaMaterial.clone());
galaxy.add(bulge);

const signalMesh = new THREE.InstancedMesh(
  new THREE.SphereGeometry(1, 6, 5),
  new THREE.MeshBasicMaterial({color: 0xffffff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false}),
  MAX_SIGNALS,
);
signalMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_SIGNALS * 3), 3);
signalMesh.frustumCulled = false;
signalMesh.count = 0;
galaxy.add(signalMesh);

const starPos = new Float32Array(MAX_STARS * 3);
const starRadius = new Float32Array(MAX_STARS);
const starUses = new Float32Array(MAX_STARS);
const regionOf = new Int32Array(MAX_STARS);
const degree = new Int32Array(MAX_STARS);
const planetOf = new Int32Array(MAX_PLANETS);
const planetOrbit = new Float32Array(MAX_PLANETS);
const planetPhase = new Float32Array(MAX_PLANETS);
const planetTilt = new Float32Array(MAX_PLANETS);
const planetSize = new Float32Array(MAX_PLANETS);
const planetDead = new Uint8Array(MAX_PLANETS);

let stars = [], planets = [], adjacency = [], regions = [], links = [];
let indexById = new Map();
let empty = true, spread = 220;
let activeFactIds = new Set(), flaring = new Set();
let selected = null, loading = false, lastFingerprint = '', contextLost = false;
let frameAverage = 16.7, lastHeartbeat = -Infinity, previousTraceId = null;
let activity = 0, lastSignal = 0, signals = [];
// The sky had no controls at all: a star could only be found by chance.
let matches = [], cursor = -1, isolated = -1, labelDue = 0;
const labelNodes = [];
const projected = new THREE.Vector3();

const matrix = new THREE.Matrix4();
const tint = new THREE.Color();
const vector = new THREE.Vector3();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

const orbit = {theta: 0.6, phi: 1.05, dist: 700, target: new THREE.Vector3()};
const want = {theta: 0.6, phi: 1.05, dist: 700, target: new THREE.Vector3()};
let spin = 0, drag = null, userFramed = false;

const hash = (text, salt = 0) => {
  let value = 2166136261 ^ salt;
  for (let i = 0; i < text.length; i++) { value ^= text.charCodeAt(i); value = Math.imul(value, 16777619); }
  return (value >>> 0) / 4294967296;
};
const shorten = (value) => {
  const text = String(value);
  return text.length > 24 ? text.slice(0, 23).trimEnd() + '…' : text;
};

// Regions grow outward from the busiest entities; each becomes a constellation.
function buildRegions(count) {
  const wanted = Math.max(1, Math.min(6, Math.round(Math.sqrt(count / 6))));
  const order = Array.from({length: count}, (_, i) => i).sort((a, b) => degree[b] - degree[a] || a - b);
  const seeds = [], blocked = new Set();
  for (const candidate of order) {
    if (seeds.length >= wanted) break;
    if (blocked.has(candidate) || !degree[candidate]) continue;
    seeds.push(candidate);
    blocked.add(candidate);
    for (const near of adjacency[candidate] || []) blocked.add(near);
  }
  if (!seeds.length && count) seeds.push(order[0]);
  const owner = new Int32Array(count).fill(-1);
  let frontier = [];
  seeds.forEach((seed, index) => { owner[seed] = index; frontier.push(seed); });
  while (frontier.length) {
    const next = [];
    for (const node of frontier)
      for (const near of adjacency[node] || [])
        if (owner[near] === -1) { owner[near] = owner[node]; next.push(near); }
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
  regions = [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([key, members], index) => {
      let leader = members[0];
      for (const member of members) if (degree[member] > degree[leader]) leader = member;
      for (const member of members) regionOf[member] = index;
      return {
        members, leader,
        size: members.length,
        tone: STAR_TONES[index % STAR_TONES.length],
        name: hasLoose && key === loose
          ? inventConstellationName(members.map((i) => String(stars[i]?.label || '')), 991)
          : constellationName(stars[leader]?.label, members.map((i) => String(stars[i]?.label || '')), index * 37 + 5),
      };
    });
}

function stage(count) {
  if (!count) return 'Протооблако';
  if (count < 60) return 'Протооблако';
  if (count < 400) return 'Ядро и первые рукава';
  return 'Спиральная память';
}

// Age becomes distance from the core, so the shape is the history of the memory:
// the oldest knowledge sits in the bulge, the newest is born at the arm tips.
function placeStars(count) {
  const structure = Math.min(1, Math.pow(count / 700, 0.75));
  const arms = count > 500 ? 2 : 1;
  spread = 90 + 190 * Math.min(1, Math.pow(count / 1400, 0.45));
  for (let i = 0; i < count; i++) {
    const star = stars[i];
    const age = count === 1 ? 0 : star.rank / (count - 1);
    const jitterA = hash(star.id, 1), jitterB = hash(star.id, 2), jitterC = hash(star.id, 3);
    const inBulge = age < 0.18 * structure;
    const spiralR = inBulge ? spread * 0.12 * Math.pow(jitterA, 0.45) : 18 + spread * Math.pow(age, 0.62);
    const looseR = spread * (0.2 + 0.8 * Math.pow(jitterA, 0.5));
    const radius = spiralR * structure + looseR * (1 - structure);
    const arm = star.rank % arms;
    const wobble = (jitterB - 0.5) * (0.5 + 1.7 * (1 - structure));
    const theta = arm * (Math.PI * 2 / arms) + radius * 0.02 + wobble + (1 - structure) * jitterC * 6.283;
    const flat = inBulge ? spread * 0.06 : 22 * Math.exp(-radius / 95) + 4;
    starPos[i * 3] = Math.cos(theta) * radius + (jitterC - 0.5) * 12;
    starPos[i * 3 + 1] = (jitterB - 0.5) * 2 * flat;
    starPos[i * 3 + 2] = Math.sin(theta) * radius + (jitterA - 0.5) * 12;
    const heat = Math.min(1, starUses[i] / 10);
    starRadius[i] = (1.5 + Math.sqrt(degree[i]) * 0.9 + heat * 2.2) * (preferences.nodeSize / 2);
  }
}

function placeGas(count) {
  const structure = Math.min(1, Math.pow(Math.max(count, 1) / 700, 0.75));
  for (let i = 0; i < GAS; i++) {
    const inDisc = i % 4 !== 0;
    const a = hash('gas' + i, 4), b = hash('gas' + i, 5), c = hash('gas' + i, 6);
    const radius = inDisc ? spread * (0.08 + 1.2 * Math.pow(a, 0.55)) : spread * (1.5 + b * 2.4);
    const theta = c * 6.283 + radius * 0.02 * structure;
    const flat = inDisc ? 15 * Math.exp(-radius / 115) + 5 : radius * 0.45;
    gasPos[i * 3] = Math.cos(theta) * radius + (b - 0.5) * 30;
    gasPos[i * 3 + 1] = (a - 0.5) * 2 * flat;
    gasPos[i * 3 + 2] = Math.sin(theta) * radius + (c - 0.5) * 30;
    gasSize[i] = (2.4 + b * 3.2) * (inDisc ? 1 : 0.55);
    const warm = inDisc ? 0.8 : 0.5;
    gasTone[i * 3] = 0.5 * warm; gasTone[i * 3 + 1] = 0.43 * warm; gasTone[i * 3 + 2] = 0.34 * warm;
  }
  gasGeometry.attributes.position.needsUpdate = true;
  gasGeometry.attributes.size.needsUpdate = true;
  gasGeometry.attributes.tone.needsUpdate = true;
  for (let i = 0; i < nebulae.length; i++) {
    const cloud = nebulae[i];
    const a = hash('neb' + i, 7), b = hash('neb' + i, 8), c = hash('neb' + i, 9);
    const radius = spread * (0.1 + Math.pow(a, 0.7) * 1.05);
    const theta = c * 6.283 + radius * 0.02 * structure;
    cloud.position.set(Math.cos(theta) * radius, (b - 0.5) * 26, Math.sin(theta) * radius);
    const scale = spread * (0.3 + b * 0.55);
    cloud.scale.set(scale, scale, 1);
    cloud.material.opacity = 0.08 + a * 0.12;
    cloud.visible = true;
  }
  bulge.scale.setScalar(spread * (0.3 + structure * 0.25));
  bulge.material.opacity = 0.3 + structure * 0.4;
}

// Figures connect bright stars inside one region, so a constellation never
// sprawls across the whole sky.
function buildFigures() {
  links = [];
  regions.forEach((region, index) => {
    const bright = [...region.members].sort((a, b) => degree[b] - degree[a] || a - b).slice(0, 10);
    if (bright.length < 2) return;
    // Walk from star to nearest star: a figure should be a compact shape, not a
    // bundle of chords thrown across the whole disc.
    const left = new Set(bright);
    let current = bright[0];
    left.delete(current);
    while (left.size && links.length < MAX_LINKS) {
      let best = null, bestDistance = Infinity;
      for (const candidate of left) {
        const dx = starPos[current * 3] - starPos[candidate * 3];
        const dy = starPos[current * 3 + 1] - starPos[candidate * 3 + 1];
        const dz = starPos[current * 3 + 2] - starPos[candidate * 3 + 2];
        const distance = dx * dx + dy * dy + dz * dz;
        if (distance < bestDistance) { bestDistance = distance; best = candidate; }
      }
      if (best === null) break;
      // A figure stays inside its own neighbourhood.
      if (Math.sqrt(bestDistance) < spread * 0.75) links.push({a: current, b: best, region: index});
      left.delete(best);
      current = best;
    }
  });
}

function uploadStars() {
  const count = stars.length;
  for (let i = 0; i < count; i++) {
    matrix.makeScale(starRadius[i], starRadius[i], starRadius[i]);
    matrix.setPosition(starPos[i * 3], starPos[i * 3 + 1], starPos[i * 3 + 2]);
    starMesh.setMatrixAt(i, matrix);
    glowPos[i * 3] = starPos[i * 3];
    glowPos[i * 3 + 1] = starPos[i * 3 + 1];
    glowPos[i * 3 + 2] = starPos[i * 3 + 2];
    glowSize[i] = starRadius[i] * 3.5;
  }
  starMesh.count = count;
  starMesh.instanceMatrix.needsUpdate = true;
  starMesh.computeBoundingSphere();
  glowGeometry.setDrawRange(0, count);
  glowGeometry.attributes.position.needsUpdate = true;
  glowGeometry.attributes.size.needsUpdate = true;
}

function paintStars() {
  const count = stars.length;
  for (let i = 0; i < count; i++) {
    const region = regions[regionOf[i]];
    const heat = Math.min(1, starUses[i] / 10);
    if (stars[i].dead) tint.setHex(DIM).multiplyScalar(0.6);
    else {
      tint.setHex(region ? region.tone : STAR_TONES[0]);
      tint.lerp(new THREE.Color(0xfffdf4), heat * 0.8).multiplyScalar(0.5 + heat * 0.7);
    }
    if (flaring.has(i)) tint.setHex(FLARE);
    if (i === cursor) tint.setHex(0xffffff);
    tint.multiplyScalar(brightness(i));
    starMesh.setColorAt(i, tint);
    glowTone[i * 3] = tint.r; glowTone[i * 3 + 1] = tint.g; glowTone[i * 3 + 2] = tint.b;
  }
  if (starMesh.instanceColor) starMesh.instanceColor.needsUpdate = true;
  glowGeometry.attributes.tone.needsUpdate = true;
  for (let e = 0; e < links.length; e++) {
    const link = links[e], offset = e * 6;
    const region = regions[link.region];
    const lit = flaring.has(link.a) && flaring.has(link.b);
    tint.setHex(lit ? FLARE : region ? region.tone : STAR_TONES[0])
      .multiplyScalar((lit ? 1 : 0.3) * Math.min(brightness(link.a), brightness(link.b)));
    for (let v = 0; v < 2; v++) {
      linkTone[offset + v * 3] = tint.r;
      linkTone[offset + v * 3 + 1] = tint.g;
      linkTone[offset + v * 3 + 2] = tint.b;
    }
  }
  linkGeometry.attributes.color.needsUpdate = true;
}

function uploadFigures() {
  for (let e = 0; e < links.length; e++) {
    const link = links[e], offset = e * 6, a = link.a * 3, b = link.b * 3;
    linkPos[offset] = starPos[a]; linkPos[offset + 1] = starPos[a + 1]; linkPos[offset + 2] = starPos[a + 2];
    linkPos[offset + 3] = starPos[b]; linkPos[offset + 4] = starPos[b + 1]; linkPos[offset + 5] = starPos[b + 2];
  }
  linkGeometry.setDrawRange(0, links.length * 2);
  linkGeometry.attributes.position.needsUpdate = true;
}

function renderLegend(count) {
  legend.replaceChildren();
  if (empty) { legend.hidden = true; return; }
  const title = document.createElement('p');
  title.className = 'legend-title';
  title.textContent = 'Созвездия · ' + stage(count);
  legend.append(title);
  for (const region of regions.slice(0, 5)) {
    const row = document.createElement('p');
    row.className = 'legend-row';
    const place = regions.indexOf(region);
    row.dataset.region = String(place);
    row.setAttribute('role', 'button');
    row.tabIndex = 0;
    row.title = 'Показать только это созвездие';
    row.addEventListener('click', () => isolate(place));
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); isolate(place); }
    });
    const swatch = document.createElement('span');
    swatch.className = 'legend-swatch';
    swatch.style.background = '#' + region.tone.toString(16).padStart(6, '0');
    const text = document.createElement('span');
    text.textContent = region.name + ' · ' + region.size;
    row.append(swatch, text);
    legend.append(row);
  }
  const note = document.createElement('p');
  note.className = 'legend-note';
  note.textContent = 'Звезда — сущность памяти, планеты вокруг — факты о ней. Чем ближе к центру, тем старше знание. '
    + 'Яркость — как часто оно попадает в ответы. Тусклые красные — замещённые факты. '
    + 'Созвездия названы по самой памяти и не повторяют земные.';
  legend.append(note);
  legend.hidden = false;
}

function populate(data) {
  const incoming = (data.nodes || []).slice(0, MAX_STARS);
  const facts = data.edges || [];
  empty = incoming.length === 0;
  indexById = new Map();
  degree.fill(0);
  regionOf.fill(0);
  starUses.fill(0);
  flaring = new Set();
  signals = [];
  signalMesh.count = 0;

  // Birth order: an entity is as old as the first fact that mentioned it.
  const born = new Map();
  for (const fact of facts) {
    const at = Date.parse(fact.createdAt || '') || 0;
    for (const side of [fact.source, fact.target]) {
      const key = String(side);
      if (!born.has(key) || at < born.get(key)) born.set(key, at);
    }
  }
  stars = incoming.map((item, index) => ({
    id: String(item.id),
    label: String(item.label || item.id),
    born: born.get(String(item.id)) ?? 0,
    dead: false,
    index,
  }));
  stars.forEach((star, index) => indexById.set(star.id, index));
  const byAge = [...stars].sort((a, b) => (a.born || 0) - (b.born || 0) || a.id.localeCompare(b.id));
  byAge.forEach((star, rank) => { star.rank = rank; });

  adjacency = stars.map(() => []);
  planets = [];
  for (const fact of facts) {
    const a = indexById.get(String(fact.source)), b = indexById.get(String(fact.target));
    if (a === undefined || b === undefined) continue;
    if (a !== b) { adjacency[a].push(b); adjacency[b].push(a); degree[a]++; degree[b]++; }
    if (planets.length < MAX_PLANETS)
      planets.push({
        id: String(fact.id),
        star: a,
        other: b,
        label: String(fact.label || ''),
        confirmed: fact.sourceType === 'user-confirmed',
        confidence: Number(fact.confidence ?? 1),
      });
  }
  buildRegions(stars.length);
  placeStars(stars.length);
  placeGas(stars.length);
  buildFigures();

  planetMesh.count = planets.length;
  planets.forEach((planet, slot) => {
    const spin = hash(planet.id, 11), tilt = hash(planet.id, 12), size = hash(planet.id, 13);
    planetOf[slot] = planet.star;
    planetOrbit[slot] = starRadius[planet.star] * (2.6 + spin * 3.4) + 2;
    planetPhase[slot] = spin * 6.283;
    planetTilt[slot] = (tilt - 0.5) * 1.5;
    planetSize[slot] = (0.5 + size * 0.7) * Math.max(0.5, planet.confidence) * (preferences.nodeSize / 2);
    planetDead[slot] = 0;
    tint.setHex(planet.confirmed ? 0xe8c98c : 0x8d7a5e);
    planetMesh.setColorAt(slot, tint);
  });
  if (planetMesh.instanceColor) planetMesh.instanceColor.needsUpdate = true;

  if (isolated >= regions.length) isolated = -1;
  cursor = -1;
  uploadStars();
  uploadFigures();
  applySearch(searchInput.value);
  renderLegend(stars.length);
  fitCamera();
}

function resize() {
  const w = Math.max(1, innerWidth), h = Math.max(1, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1,
    frameAverage > 34 ? 1 : frameAverage > 23 ? 1.25 : Math.min(w, h) < 650 ? 1.25 : 1.7));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function fitCamera() {
  if (userFramed) return;
  let furthest = 60;
  for (let i = 0; i < stars.length; i++)
    furthest = Math.max(furthest, Math.hypot(starPos[i * 3], starPos[i * 3 + 1], starPos[i * 3 + 2]));
  if (empty) furthest = spread;
  const half = Math.tan((camera.fov / 2) * Math.PI / 180) * Math.min(1, camera.aspect);
  want.dist = Math.max(180, Math.min(2600, furthest / Math.max(0.2, half) * 1.2));
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
}

function brightness(index) {
  if (isolated >= 0 && regionOf[index] !== isolated) return 0.16;
  if (matches.length && !matches.includes(index)) return 0.26;
  return 1;
}

// Names are drawn as plain DOM over the canvas: crisp text, no glyph atlas, and
// it inherits the interface font.
function updateLabels(now) {
  if (now - labelDue < 90) return;
  labelDue = now;
  if (empty || !stars.length) {
    for (const node of labelNodes) node.style.display = 'none';
    return;
  }
  const wanted = new Set();
  if (matches.length) for (const index of matches.slice(0, 12)) wanted.add(index);
  if (cursor >= 0) wanted.add(cursor);
  for (const index of flaring) wanted.add(index);
  if (wanted.size < 14) {
    const ranked = Array.from({length: stars.length}, (_, i) => i)
      .filter((i) => isolated < 0 || regionOf[i] === isolated)
      .sort((a, b) => degree[b] - degree[a] || a - b);
    for (const index of ranked) {
      if (wanted.size >= 14) break;
      wanted.add(index);
    }
  }
  const half = innerWidth / 2, middle = innerHeight / 2;
  const shown = [...wanted];
  for (let slot = 0; slot < Math.max(labelNodes.length, shown.length); slot++) {
    let node = labelNodes[slot];
    if (!node && slot < shown.length) {
      node = document.createElement('span');
      node.className = 'sky-label';
      labelLayer.append(node);
      labelNodes.push(node);
    }
    if (!node) continue;
    const index = shown[slot];
    if (index === undefined) { node.style.display = 'none'; continue; }
    projected.set(starPos[index * 3], starPos[index * 3 + 1], starPos[index * 3 + 2]);
    galaxy.localToWorld(projected);
    projected.project(camera);
    if (projected.z > 1 || projected.z < -1) { node.style.display = 'none'; continue; }
    const depth = Math.max(0, Math.min(1, 1 - (projected.z + 1) / 2));
    node.textContent = stars[index].label;
    node.classList.toggle('lit', flaring.has(index) || index === cursor);
    node.style.display = '';
    node.style.left = (projected.x * half + half) + 'px';
    node.style.top = (-projected.y * middle + middle) + 'px';
    node.style.opacity = String(0.3 + depth * 0.6);
  }
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

function applyPreferences(value) {
  preferences = normalizeGolemSettings(value);
  if (!stars.length) return;
  placeStars(stars.length);
  for (let slot = 0; slot < planets.length; slot++) {
    const planet = planets[slot];
    planetOrbit[slot] = starRadius[planet.star] * (2.6 + hash(planet.id, 11) * 3.4) + 2;
    planetSize[slot] = (0.5 + hash(planet.id, 13) * 0.7) * Math.max(0.5, planet.confidence) * (preferences.nodeSize / 2);
  }
  uploadStars();
  uploadFigures();
}
canvas.addEventListener('golem-settings', (event) => applyPreferences(event.detail));

function inspect(index) {
  body.replaceChildren();
  const heading = document.createElement('h2');
  if (empty || !stars[index]) {
    heading.textContent = 'Протооблако';
    const text = document.createElement('p');
    text.textContent = 'Звёзд пока нет. Они загорятся, когда из переписки появятся знания.';
    body.append(heading, text);
    selected = null;
    detail.hidden = false;
    return;
  }
  const star = stars[index];
  selected = star.id;
  heading.textContent = star.label;
  body.append(heading);
  const region = regions[regionOf[index]];
  if (region) {
    const where = document.createElement('p');
    where.textContent = 'Созвездие: ' + region.name;
    body.append(where);
  }
  const counts = document.createElement('p');
  const own = planets.filter((planet) => planet.star === index || planet.other === index);
  counts.textContent = 'Планет вокруг: ' + own.length + ' · связей: ' + degree[index];
  body.append(counts);
  if (star.born) {
    const age = document.createElement('p');
    age.textContent = 'Первое упоминание: ' + new Date(star.born).toLocaleDateString('ru-RU');
    body.append(age);
  }
  if (own.length) {
    const title = document.createElement('p');
    title.textContent = 'Факты:';
    const list = document.createElement('ul');
    for (const planet of own.slice(0, 8)) {
      const row = document.createElement('li');
      const partner = stars[planet.star === index ? planet.other : planet.star];
      row.textContent = planet.label + (partner ? ' — ' + partner.label : '');
      row.dataset.fact = planet.id;
      list.append(row);
    }
    body.append(title, list);
    // Where the knowledge came from: /api/golem/source existed but the sky never
    // asked it, so a star could not be traced back to the message behind it.
    void describeSources(list, own.slice(0, 4), star.id);
  }
  userFramed = true;
  want.target.set(starPos[index * 3], starPos[index * 3 + 1], starPos[index * 3 + 2]);
  want.dist = Math.max(70, Math.min(want.dist, 190));
  detail.hidden = false;
}

function applySearch(raw) {
  const query = String(raw || '').trim().toLocaleLowerCase('ru');
  matches = query
    ? stars.map((star, index) => [star, index])
        .filter(([star]) => star.label.toLocaleLowerCase('ru').includes(query))
        .map(([, index]) => index)
    : [];
  cursor = matches.length ? matches[0] : -1;
  searchCount.textContent = query ? (matches.length ? '1 / ' + matches.length : 'нет') : '';
  paintStars();
  labelDue = 0;
}
function showSearch(open) {
  searchBar.hidden = !open;
  if (open) searchInput.focus();
  else {
    searchInput.value = '';
    applySearch('');
    searchInput.blur();
  }
}
function focusStar(index) {
  if (index == null || index < 0 || index >= stars.length) return;
  cursor = index;
  if (matches.length) {
    const at = matches.indexOf(index);
    if (at >= 0) searchCount.textContent = at + 1 + ' / ' + matches.length;
  }
  userFramed = true;
  want.target.set(starPos[index * 3], starPos[index * 3 + 1], starPos[index * 3 + 2]);
  want.dist = Math.max(70, Math.min(want.dist, 220));
  labelDue = 0;
}
function step(delta) {
  if (!stars.length) return;
  const pool = matches.length
    ? matches
    : Array.from({length: stars.length}, (_, i) => i)
        .filter((i) => isolated < 0 || regionOf[i] === isolated)
        .sort((a, b) => degree[b] - degree[a] || a - b);
  if (!pool.length) return;
  const at = pool.indexOf(cursor);
  focusStar(pool[(at + delta + pool.length) % pool.length]);
}
function isolate(index) {
  isolated = isolated === index ? -1 : index;
  for (const row of legend.querySelectorAll('.legend-row'))
    row.classList.toggle('isolated', Number(row.dataset.region) === isolated);
  paintStars();
  labelDue = 0;
}

searchInput.addEventListener('input', () => applySearch(searchInput.value));
searchInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') { event.preventDefault(); if (cursor >= 0) inspect(cursor); }
  else if (event.key === 'ArrowDown') { event.preventDefault(); step(1); }
  else if (event.key === 'ArrowUp') { event.preventDefault(); step(-1); }
  else if (event.key === 'Escape') { event.preventDefault(); showSearch(false); }
});

async function describeSources(list, planets, owner) {
  for (const planet of planets) {
    if (selected !== owner) return;
    let source;
    try {
      const response = await fetch('/api/golem/source?id=' + encodeURIComponent(planet.id));
      if (!response.ok) continue;
      source = await response.json();
    } catch { continue; }
    if (selected !== owner) return;
    const row = list.querySelector('[data-fact="' + CSS.escape(planet.id) + '"]');
    if (!row) continue;
    const note = document.createElement('small');
    const kind = source.source === 'user-confirmed' ? 'подтверждено вами'
      : source.source === 'cloudru-extracted' ? 'извлечено моделью' : 'из памяти';
    const excerpt = source.message && typeof source.message.content === 'string'
      ? source.message.content.replace(/\s+/g, ' ').slice(0, 140)
      : '';
    note.textContent = kind + (excerpt ? ' · «' + excerpt + '»' : '');
    row.append(document.createElement('br'), note);
  }
}

function release() {
  detail.hidden = true;
  selected = null;
  cursor = -1;
  want.target.set(0, 0, 0);
  userFramed = false;
  fitCamera();
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
  want.phi = Math.max(0.1, Math.min(Math.PI - 0.1, want.phi - dy * 0.005));
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
  pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
  updateCamera();
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObject(starMesh);
  if (hits.length && hits[0].instanceId !== undefined && hits[0].instanceId < stars.length) inspect(hits[0].instanceId);
  else release();
});
canvas.addEventListener('pointercancel', () => { drag = null; });
canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  userFramed = true;
  want.dist = Math.max(60, Math.min(2600, want.dist * (event.deltaY > 0 ? 1.12 : 0.89)));
}, {passive: false});
document.getElementById('close-detail').addEventListener('click', release);
addEventListener('keydown', (event) => {
  if (event.target === searchInput) return;
  if (event.key === 'Escape') {
    if (!searchBar.hidden) showSearch(false);
    else if (isolated >= 0) isolate(isolated);
    else release();
  } else if (event.key === '/') { event.preventDefault(); showSearch(true); }
  else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') { event.preventDefault(); step(1); }
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') { event.preventDefault(); step(-1); }
  else if (event.key === 'Enter' && cursor >= 0) { event.preventDefault(); inspect(cursor); }
});

function flareFacts(ids) {
  activeFactIds = new Set((ids || []).map(String));
  flaring = new Set();
  for (const planet of planets)
    if (activeFactIds.has(planet.id)) { flaring.add(planet.star); flaring.add(planet.other); }
  signals = [];
  for (let e = 0; e < links.length && signals.length < MAX_SIGNALS; e++)
    if (flaring.has(links[e].a) && flaring.has(links[e].b))
      signals.push({link: e, phase: hash('sig' + e, 21), idle: false});
  paintStars();
}

function restingSignal() {
  if (reduced || empty || !links.length || signals.length >= MAX_SIGNALS) return;
  signals.push({link: Math.floor(Math.random() * links.length), phase: 0, idle: true});
}

function updateSignals(delta) {
  if (!signals.length) { signalMesh.count = 0; return; }
  const step = reduced ? 0 : delta * 0.00035;
  let written = 0;
  for (const signal of signals) {
    signal.phase += step * (signal.idle ? 0.5 : 0.9 + activity * 1.8);
    if (signal.idle && signal.phase >= 1) continue;
    if (!signal.idle) signal.phase %= 1;
    const link = links[signal.link];
    if (!link || written >= MAX_SIGNALS) continue;
    const a = link.a * 3, b = link.b * 3, t = signal.phase;
    const size = (signal.idle ? 0.9 : 1.6 + activity * 0.8) * (preferences.nodeSize / 2) + 0.5;
    matrix.makeScale(size, size, size);
    matrix.setPosition(
      starPos[a] + (starPos[b] - starPos[a]) * t,
      starPos[a + 1] + (starPos[b + 1] - starPos[a + 1]) * t,
      starPos[a + 2] + (starPos[b + 2] - starPos[a + 2]) * t,
    );
    signalMesh.setMatrixAt(written, matrix);
    tint.setHex(signal.idle ? 0x6f6450 : FLARE);
    signalMesh.setColorAt(written, tint);
    written++;
  }
  signals = signals.filter((signal) => !(signal.idle && signal.phase >= 1));
  signalMesh.count = written;
  signalMesh.instanceMatrix.needsUpdate = true;
  if (signalMesh.instanceColor) signalMesh.instanceColor.needsUpdate = true;
}

function orbitPlanets(now) {
  const count = planets.length;
  for (let slot = 0; slot < count; slot++) {
    const star = planetOf[slot], centre = star * 3;
    const speed = reduced ? 0 : now * 0.00022 / (1 + planetOrbit[slot] * 0.05);
    const angle = planetPhase[slot] + speed;
    const radius = planetOrbit[slot];
    const lift = Math.sin(angle) * radius * planetTilt[slot];
    const size = planetSize[slot];
    matrix.makeScale(size, size, size);
    matrix.setPosition(
      starPos[centre] + Math.cos(angle) * radius,
      starPos[centre + 1] + lift,
      starPos[centre + 2] + Math.sin(angle) * radius * 0.85,
    );
    planetMesh.setMatrixAt(slot, matrix);
  }
  planetMesh.count = count;
  planetMesh.instanceMatrix.needsUpdate = true;
}

function handleEvent(data) {
  switch (data.type) {
    case 'question': activity = Math.max(activity, 0.6); break;
    case 'recall': flareFacts(data.factIds); activity = 1; break;
    case 'asking':
    case 'token': activity = 1; break;
    case 'answer':
      if (data.traceId) previousTraceId = String(data.traceId);
      if (data.factIds) flareFacts(data.factIds);
      activity = 1;
      break;
    case 'facts':
      activity = Math.max(activity, 0.7);
      notice.textContent = 'Новые знания зажигают звёзды…';
      lastFingerprint = '';
      refresh();
      break;
    case 'index':
      activity = Math.max(activity, 0.4);
      restingSignal();
      break;
    case 'build':
      notice.textContent = data.state === 'building' ? 'Пересобираю карту памяти…'
        : data.state === 'error' ? 'Пересборка карты не удалась' : 'Карта памяти обновлена';
      if (data.state === 'ready') { lastFingerprint = ''; refresh(); }
      break;
    default: break;
  }
}

function connectStream() {
  if (typeof EventSource === 'undefined') return;
  let source;
  try { source = new EventSource('/api/golem/stream'); } catch (error) {
    console.warn('Golem activity stream:', error.message);
    return;
  }
  source.addEventListener('message', (event) => {
    let data;
    try { data = JSON.parse(event.data); } catch { return; }
    if (data && typeof data.type === 'string') handleEvent(data);
  });
}

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
      if (activeFactIds.size) flareFacts([...activeFactIds]);
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
    flareFacts(latest.fact_ids || []);
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
connectStream();
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
  activity = Math.max(0, activity - delta * 0.00045);
  if (now - lastSignal > (activity > 0.2 ? 260 : 1100)) { lastSignal = now; restingSignal(); }
  const breath = reduced ? 0 : Math.sin(now * 0.00045);
  coreLight.intensity = 2.1 + breath * 0.25 + activity * 0.6;
  glowMaterial.uniforms.uScale.value = 1 + breath * 0.05 + activity * 0.25;
  bulge.material.opacity = Math.min(1, 0.3 + activity * 0.3 + breath * 0.05 + (empty ? 0 : 0.18));
  // The whole disc turns slowly, like a galaxy should.
  if (preferences.autoRotate && !reduced && !drag) want.theta += delta * 0.00006;
  if (!drag && Math.abs(spin) > 0.00002) { want.theta += spin; spin *= 0.94; }
  orbit.theta += (want.theta - orbit.theta) * 0.16;
  orbit.phi += (want.phi - orbit.phi) * 0.16;
  orbit.dist += (want.dist - orbit.dist) * 0.12;
  orbit.target.lerp(want.target, 0.1);
  if (planets.length) orbitPlanets(now);
  updateSignals(delta);
  draw();
  updateLabels(now);
}
requestAnimationFrame(animate);
