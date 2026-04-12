const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const hud = {
  timer: document.getElementById("timer"),
  score: document.getElementById("score"),
  delivered: document.getElementById("delivered"),
  lost: document.getElementById("lost"),
  burning: document.getElementById("burning"),
  status: document.getElementById("status")
};

// Expanded theater: includes northern Gulf approaches (Kharg area) + farther SE/east exits
const MAP_BOUNDS = { minLon: 49.6, maxLon: 62.0, minLat: 22.0, maxLat: 30.1 };
const TILE_Z = 7;
const TILE_SIZE = 256;
const DEBUG_MAP_ONLY = false;
const DEBUG_CORRIDOR_ONLY = false;

function mercatorX(lon) {
  return (lon + 180) / 360;
}

function mercatorY(lat) {
  const rad = (lat * Math.PI) / 180;
  return (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2;
}

const projBounds = {
  minX: mercatorX(MAP_BOUNDS.minLon),
  maxX: mercatorX(MAP_BOUNDS.maxLon),
  minY: mercatorY(MAP_BOUNDS.maxLat),
  maxY: mercatorY(MAP_BOUNDS.minLat)
};

const WORLD = {
  width: (projBounds.maxX - projBounds.minX) * (2 ** TILE_Z) * TILE_SIZE,
  height: (projBounds.maxY - projBounds.minY) * (2 ** TILE_Z) * TILE_SIZE
};

function lonLatToWorld(lon, lat) {
  const nx = mercatorX(lon);
  const ny = mercatorY(lat);
  return {
    x: ((nx - projBounds.minX) / (projBounds.maxX - projBounds.minX)) * WORLD.width,
    y: ((ny - projBounds.minY) / (projBounds.maxY - projBounds.minY)) * WORLD.height
  };
}

// User-provided navigable water polygon (authoritative route zone envelope)
const navigablePolygonLonLat = [
  [48.6444508387649, 29.242755529556163],
  [50.21330325836547, 27.277889180546765],
  [51.59190804080512, 26.117891195173883],
  [52.97777239656128, 24.55399358437532],
  [54.04833341003783, 24.645493809822327],
  [55.16112843154835, 25.44353780868606],
  [55.933244020525535, 26.025099986644918],
  [56.12560859926711, 26.419612648104945],
  [56.62419220778955, 26.468043561602457],
  [56.614987659257935, 26.228554190292186],
  [56.861732843473874, 24.923443387742665],
  [57.53299317429182, 24.158112926159063],
  [58.792857016998795, 23.858908055033723],
  [59.54564928074586, 23.06355354504754],
  [61.685008516604626, 22.159666526638574],
  [61.72852646914271, 24.08617552118855],
  [61.24139848212633, 24.838087356811315],
  [58.557121749014556, 25.302485495516592],
  [57.292964933540134, 25.629690185306245],
  [56.98860901582421, 26.49877378671981],
  [56.5730090830736, 26.889142215814985],
  [56.177605550677725, 26.618048798321652],
  [54.91363964805663, 26.32201118133132],
  [52.16379046926917, 26.755346596411954],
  [49.77226456324712, 29.651668157452022],
  [48.6444508387649, 29.242755529556163]
];
const navigablePolygonWorld = navigablePolygonLonLat.map(([lon, lat]) => lonLatToWorld(lon, lat));

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersects = yi > point.y !== yj > point.y
      && point.x < ((xj - xi) * (point.y - yi)) / ((yj - yi) || 1e-9) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function isInsideNavigablePolygon(point) {
  return pointInPolygon(point, navigablePolygonWorld);
}

// Long navigable shipping trunk aligned to deep-water centerline from Gulf -> Strait -> Oman Sea
// Keep points offshore so route/corridor never cuts across Iranian land tiles.
const trunkRouteLonLat = [
  [50.20, 27.18],
  [50.56, 27.00],
  [50.98, 26.80],
  [51.46, 26.56],
  [52.00, 26.30],
  [52.60, 26.05],
  [53.24, 25.86],
  [53.90, 25.74],
  [54.54, 25.65],
  [55.08, 25.59],
  [55.56, 25.62],
  [55.94, 25.64],
  [56.20, 25.70],
  [56.36, 25.78],
  [56.50, 25.87],
  [56.66, 25.97],
  [56.86, 26.01],
  [57.12, 25.95],
  [57.42, 25.80],
  [57.76, 25.59],
  [58.14, 25.37],
  [58.50, 25.18],
  [58.80, 25.02],
  [59.02, 24.92],
  [59.55, 24.68]
];
const fallbackRoutePoints = trunkRouteLonLat.map(([lon, lat]) => lonLatToWorld(lon, lat));

function buildPolygonCenterlineRoute(polygon, samples = 44) {
  if (!polygon || polygon.length < 4) return [];

  let minX = Infinity;
  let maxX = -Infinity;
  for (const p of polygon) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
  }
  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || maxX - minX < 4) return [];

  const route = [];
  let prevY = null;

  for (let i = 0; i < samples; i++) {
    const x = minX + (i / (samples - 1)) * (maxX - minX);
    const ys = [];

    for (let a = 0, b = polygon.length - 1; a < polygon.length; b = a++) {
      const p1 = polygon[b];
      const p2 = polygon[a];
      const xMin = Math.min(p1.x, p2.x);
      const xMax = Math.max(p1.x, p2.x);
      if (x < xMin || x > xMax) continue;

      const dx = p2.x - p1.x;
      if (Math.abs(dx) < 1e-6) {
        ys.push(p1.y, p2.y);
        continue;
      }

      const u = (x - p1.x) / dx;
      if (u < 0 || u > 1) continue;
      ys.push(p1.y + (p2.y - p1.y) * u);
    }

    ys.sort((m, n) => m - n);
    if (ys.length < 2) continue;

    let chosenMid = null;
    let chosenSpan = -1;
    for (let k = 0; k < ys.length - 1; k += 2) {
      const yA = ys[k];
      const yB = ys[k + 1];
      const span = Math.abs(yB - yA);
      const mid = (yA + yB) * 0.5;
      if (span < 6) continue;

      if (prevY != null && prevY >= Math.min(yA, yB) && prevY <= Math.max(yA, yB)) {
        chosenMid = mid;
        chosenSpan = span;
        break;
      }
      if (span > chosenSpan) {
        chosenMid = mid;
        chosenSpan = span;
      }
    }

    if (chosenMid == null) continue;
    route.push({ x, y: chosenMid });
    prevY = chosenMid;
  }

  if (route.length < 6) return [];

  const smoothed = route.map((_, i) => {
    const a = route[Math.max(0, i - 1)];
    const b = route[i];
    const c = route[Math.min(route.length - 1, i + 1)];
    return { x: b.x, y: (a.y + b.y + c.y) / 3 };
  });

  const compact = [smoothed[0]];
  for (let i = 1; i < smoothed.length; i++) {
    const p = smoothed[i];
    const last = compact[compact.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) >= 10) compact.push(p);
  }
  return compact;
}

let routePoints = buildPolygonCenterlineRoute(navigablePolygonWorld, 44);
if (routePoints.length < 8) routePoints = fallbackRoutePoints;

let routeSegments = [];
let routeLength = 0;
function rebuildRouteGeometry(points) {
  routeSegments = [];
  routeLength = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    routeSegments.push({ a, b, len, start: routeLength, end: routeLength + len });
    routeLength += len;
  }
}
rebuildRouteGeometry(routePoints);

function sampleRoute(t) {
  const clampedT = Math.max(0, Math.min(1, t));
  const distance = clampedT * routeLength;
  let seg = routeSegments[routeSegments.length - 1];
  for (const s of routeSegments) {
    if (distance >= s.start && distance <= s.end) {
      seg = s;
      break;
    }
  }

  const local = seg.len <= 0.001 ? 0 : (distance - seg.start) / seg.len;
  const x = seg.a.x + (seg.b.x - seg.a.x) * local;
  const y = seg.a.y + (seg.b.y - seg.a.y) * local;

  const tx = seg.b.x - seg.a.x;
  const ty = seg.b.y - seg.a.y;
  const tLen = Math.hypot(tx, ty) || 1;
  const ux = tx / tLen;
  const uy = ty / tLen;
  const nx = -uy;
  const ny = ux;

  return { x, y, tangent: { x: ux, y: uy }, normal: { x: nx, y: ny } };
}

function nearestOnRoute(point) {
  let best = null;
  for (const seg of routeSegments) {
    const vx = seg.b.x - seg.a.x;
    const vy = seg.b.y - seg.a.y;
    const vLen2 = vx * vx + vy * vy || 1;
    let u = ((point.x - seg.a.x) * vx + (point.y - seg.a.y) * vy) / vLen2;
    u = Math.max(0, Math.min(1, u));

    const px = seg.a.x + vx * u;
    const py = seg.a.y + vy * u;
    const dx = point.x - px;
    const dy = point.y - py;
    const dist = Math.hypot(dx, dy);

    if (!best || dist < best.dist) {
      const segLen = Math.hypot(vx, vy) || 1;
      const tx = vx / segLen;
      const ty = vy / segLen;
      const nx = -ty;
      const ny = tx;
      const along = seg.start + seg.len * u;
      best = {
        x: px,
        y: py,
        dist,
        routeT: along / routeLength,
        normal: { x: nx, y: ny },
        tangent: { x: tx, y: ty },
        signedOffset: dx * nx + dy * ny
      };
    }
  }
  return best;
}

// Water-rule proxy: ships are constrained to a tapered navigable corridor.
// Wider at the Gulf/Oman ends, narrower at the Strait pinch point.
// Keep corridor conservative so traffic does not spill onto nearby coasts.
// Wide at both ends, but much tighter through the Strait pinch.
const corridorBaseWest = 38;
const corridorBaseEast = 30;
const straitPinchT = 0.70;
const straitPinchSigma = 0.055;
const straitPinchDepth = 22;

const ANCHOR_ZONES = {
  west: { lon: 55.35, lat: 25.92, radius: 42, entryT: 0.60 },
  east: { lon: 57.30, lat: 25.18, radius: 40, entryT: 0.86 }
};

const anchorWest = lonLatToWorld(ANCHOR_ZONES.west.lon, ANCHOR_ZONES.west.lat);
const anchorEast = lonLatToWorld(ANCHOR_ZONES.east.lon, ANCHOR_ZONES.east.lat);

function corridorHalfWidthAtT(routeT) {
  const t = Math.max(0, Math.min(1, routeT));
  const base = corridorBaseWest + (corridorBaseEast - corridorBaseWest) * t;
  const pinch = straitPinchDepth * Math.exp(-((t - straitPinchT) ** 2) / (2 * straitPinchSigma * straitPinchSigma));
  return Math.max(10, base - pinch);
}

function maxLaneOffsetForRouteT(routeT, margin = 4) {
  return Math.max(5, corridorHalfWidthAtT(routeT) - margin);
}

function clampToCorridor(point, margin = 6) {
  const n = nearestOnRoute(point);
  const maxOffset = maxLaneOffsetForRouteT(n.routeT, margin);
  const off = Math.max(-maxOffset, Math.min(maxOffset, n.signedOffset));
  return { x: n.x + n.normal.x * off, y: n.y + n.normal.y * off };
}

function worldToTileSample(worldX, worldY, z = TILE_Z) {
  const scale = 2 ** z;
  const nx = projBounds.minX + (worldX / WORLD.width) * (projBounds.maxX - projBounds.minX);
  const ny = projBounds.minY + (worldY / WORLD.height) * (projBounds.maxY - projBounds.minY);
  const tileFX = nx * scale;
  const tileFY = ny * scale;
  const tx = Math.floor(tileFX);
  const ty = Math.floor(tileFY);
  const px = Math.max(0, Math.min(TILE_SIZE - 1, Math.floor((tileFX - tx) * TILE_SIZE)));
  const py = Math.max(0, Math.min(TILE_SIZE - 1, Math.floor((tileFY - ty) * TILE_SIZE)));
  return { tx, ty, px, py };
}

function classifyOSMWater(r, g, b) {
  // OSM standard water tends to be light blue/cyan (e.g. #aad3df variants).
  const blueDominant = b >= g - 6 && g >= r - 4;
  const brightEnough = r >= 88 && g >= 118 && b >= 132;
  const cyanTilt = (g - r) >= 12 && (b - r) >= 22;
  return blueDominant && brightEnough && cyanTilt;
}

function getTilePixelClass(worldX, worldY) {
  if (worldX < 0 || worldY < 0 || worldX > WORLD.width || worldY > WORLD.height) return "land";

  const { tx, ty, px, py } = worldToTileSample(worldX, worldY, TILE_Z);
  const rec = getTile(TILE_Z, tx, ty);
  if (!rec.loaded) return "unknown";
  if (rec.pixelAccess === false) return "unknown";

  try {
    if (!rec.pixelCanvas) {
      rec.pixelCanvas = document.createElement("canvas");
      rec.pixelCanvas.width = TILE_SIZE;
      rec.pixelCanvas.height = TILE_SIZE;
      rec.pixelCtx = rec.pixelCanvas.getContext("2d", { willReadFrequently: true });
      rec.pixelCtx.drawImage(rec.img, 0, 0, TILE_SIZE, TILE_SIZE);
    }
    const data = rec.pixelCtx.getImageData(px, py, 1, 1).data;
    return classifyOSMWater(data[0], data[1], data[2]) ? "water" : "land";
  } catch (_e) {
    rec.pixelAccess = false;
    return "unknown";
  }
}

const waterClassCache = new Map();
function isNavigableWater(point) {
  if (!isInsideNavigablePolygon(point)) return false;
  const key = `${Math.round(point.x / 4)}:${Math.round(point.y / 4)}`;
  if (waterClassCache.has(key)) return waterClassCache.get(key);
  const cls = getTilePixelClass(point.x, point.y);
  // Allow movement while tile pixels are not yet readable/loaded.
  const ok = cls !== "land";
  waterClassCache.set(key, ok);
  return ok;
}

function projectToNearestWater(point, maxRadius = 160, ringStep = 8) {
  if (isNavigableWater(point)) return { x: point.x, y: point.y };

  let best = null;
  for (let r = ringStep; r <= maxRadius; r += ringStep) {
    const steps = Math.max(16, Math.ceil((Math.PI * 2 * r) / 16));
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const c = { x: point.x + Math.cos(a) * r, y: point.y + Math.sin(a) * r };
      if (!isNavigableWater(c)) continue;
      const d = Math.hypot(c.x - point.x, c.y - point.y);
      if (!best || d < best.d) best = { x: c.x, y: c.y, d };
    }
    if (best) break;
  }
  return best ? { x: best.x, y: best.y } : null;
}

function clampPointToWater(point, fallback = null, maxRadius = 160) {
  const snapped = projectToNearestWater(point, maxRadius, 8);
  if (snapped) return snapped;
  return fallback ? { x: fallback.x, y: fallback.y } : { x: point.x, y: point.y };
}

const tileCache = new Map();
function getTile(z, x, y) {
  const key = `${z}/${x}/${y}`;
  if (tileCache.has(key)) return tileCache.get(key);
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
  const rec = { img, loaded: false, pixelAccess: null, pixelCanvas: null, pixelCtx: null };
  img.onload = () => (rec.loaded = true);
  tileCache.set(key, rec);
  return rec;
}

const state = {
  camera: { x: 0, y: 0, speed: 760 },
  zoom: 1,
  keys: new Set(),
  pointer: { down: false, moved: false, lx: 0, ly: 0 },
  gamepad: { prevButtons: [] },
  time: 0,
  duration: 720,
  score: 0,
  delivered: 0,
  lost: 0,
  priority: "missile",
  selectedEscort: 0,
  selectedTanker: null,
  ships: [],
  escorts: [],
  threats: [],
  projectiles: [],
  tollGates: [],
  alliedPickups: [],
  alliedShieldCharges: 0,
  ambientTraffic: [],
  liveTrafficEnabled: false,
  liveTrafficSource: "sim",
  trafficNextAt: 0,
  upgradePoints: 0,
  nextPowerDelivery: 3,
  upgrades: {
    weaponTier: 1,
    damageControlTier: 1,
    fleetTier: 1
  },
  spawn: { tankerAt: 1.2, threatAt: 2.5, alliedAt: 16 },
  message: "Status: Running",
  messageTimer: 0,
  ended: false
};

const navRules = {
  tankerLaneAbsMax: 30,
  tankerSeparation: 22,
  collisionRange: 6.5,
  groundingPenalty: 14
};

// Optional live traffic hook (set window.SOH_TRAFFIC_ENDPOINT in browser)
const LIVE_TRAFFIC_ENDPOINT = window.SOH_TRAFFIC_ENDPOINT || null;
const LIVE_TRAFFIC_REFRESH_SECONDS = 45;

const cargoTypes = [
  { name: "Crude Oil", fireRisk: 1.0, value: 100 },
  { name: "LPG", fireRisk: 1.3, value: 140 },
  { name: "Helium", fireRisk: 0.35, value: 120 },
  { name: "Petrochemicals", fireRisk: 1.2, value: 150 },
  { name: "Urea", fireRisk: 0.55, value: 95 },
  { name: "Containers", fireRisk: 0.5, value: 110 }
];

// Role/class-based ship set for visual + gameplay differentiation
const shipClasses = [
  { key: "Aframax", hp: 120, speed: 74, radius: 6.5, lengthMul: 2.1, turnRate: 4.2 },
  { key: "Suezmax", hp: 170, speed: 66, radius: 8.2, lengthMul: 2.35, turnRate: 3.4 },
  { key: "VLCC", hp: 245, speed: 56, radius: 10.8, lengthMul: 2.7, turnRate: 2.8 },
  { key: "Container", hp: 150, speed: 68, radius: 7.8, lengthMul: 2.25, turnRate: 3.8 },
  { key: "LNG", hp: 165, speed: 64, radius: 8.4, lengthMul: 2.3, turnRate: 3.2 }
];

function rng(min, max) {
  return Math.random() * (max - min) + min;
}

function pick(arr) {
  return arr[(Math.random() * arr.length) | 0];
}

function normalizeVec(v) {
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l };
}

function rotateVec(v, radians) {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function smoothHeading(current, target, rate, dt) {
  const mix = Math.max(0, Math.min(1, rate * dt));
  return normalizeVec({
    x: current.x + (target.x - current.x) * mix,
    y: current.y + (target.y - current.y) * mix
  });
}

function grantDeliveryPowerProgress() {
  if (state.delivered >= state.nextPowerDelivery) {
    state.upgradePoints += 1;
    state.nextPowerDelivery += 3;
    state.message = `Status: Power-up point earned (${state.upgradePoints})`;
    state.messageTimer = 2.2;
  }
}

function spendUpgrade(type) {
  if (state.upgradePoints <= 0) return;

  if (type === "fleet") {
    if (state.escorts.length >= 7) return;
    const lead = state.ships.find((s) => s.kind === "tanker" && !s.sunk);
    const routeT = lead ? lead.routeT : 0.12;
    spawnEscort(state.escorts.length, routeT);
    state.upgrades.fleetTier += 1;
    state.upgradePoints -= 1;
    state.message = "Status: Fleet power-up: +1 escort deployed";
    state.messageTimer = 2;
    return;
  }

  if (type === "weapon") {
    if (state.upgrades.weaponTier >= 4) return;
    state.upgrades.weaponTier += 1;
    state.upgradePoints -= 1;
    state.message = `Status: Weapons upgraded to Tier ${state.upgrades.weaponTier}`;
    state.messageTimer = 2;
    return;
  }

  if (type === "damage") {
    if (state.upgrades.damageControlTier >= 4) return;
    state.upgrades.damageControlTier += 1;
    state.upgradePoints -= 1;
    state.message = `Status: Damage Control upgraded to Tier ${state.upgrades.damageControlTier}`;
    state.messageTimer = 2;
  }
}

function init() {
  if (!DEBUG_MAP_ONLY) {
    for (let i = 0; i < 3; i++) spawnEscort(i);
    for (let i = 0; i < 9; i++) spawnTanker(i % 2 === 0 ? 1 : -1);
  }

  state.tollGates = DEBUG_MAP_ONLY || DEBUG_CORRIDOR_ONLY
    ? []
    : [0.18, 0.42, 0.67, 0.86].map((t) => {
        const p = sampleRoute(t);
        return { x: p.x, y: p.y, radius: 11, cooldown: 0 };
      });

  const start = sampleRoute(0.1);
  state.camera.x = start.x - canvas.width * 0.35;
  state.camera.y = start.y - canvas.height * 0.25;

  if (DEBUG_MAP_ONLY || DEBUG_CORRIDOR_ONLY) {
    state.ambientTraffic = [];
    state.threats = [];
    state.projectiles = [];
    state.alliedPickups = [];
    state.message = DEBUG_MAP_ONLY ? "Status: MAP-ONLY diagnostic mode" : "Status: Corridor debug mode";
  } else {
    setupAmbientTraffic();
  }

  bindInput();
  requestAnimationFrame(loop);
}

function setupAmbientTraffic() {
  if (LIVE_TRAFFIC_ENDPOINT) {
    state.liveTrafficEnabled = true;
    state.liveTrafficSource = "api";
    state.trafficNextAt = 0;
    fetchLiveTraffic();
    return;
  }

  state.liveTrafficEnabled = false;
  state.liveTrafficSource = "sim";
  state.ambientTraffic = [];

  for (let i = 0; i < 24; i++) {
    const t = Math.random();
    const p = sampleRoute(t);
    const laneMax = maxLaneOffsetForRouteT(t, 3);
    const off = rng(-laneMax, laneMax);
    const direction = Math.random() < 0.5 ? 1 : -1;
    const heading = direction === 1 ? p.tangent : { x: -p.tangent.x, y: -p.tangent.y };
    const seed = {
      name: `AIS-${1000 + i}`,
      x: p.x + p.normal.x * off,
      y: p.y + p.normal.y * off,
      routeT: t,
      laneOffset: off,
      direction,
      heading,
      speed: rng(18, 48),
      radius: rng(4, 7),
      lengthMul: rng(2.0, 2.8),
      cargo: Math.random() < 0.5 ? "Container" : "Aframax",
      source: "sim"
    };
    const water = clampPointToWater({ x: seed.x, y: seed.y }, p, 180);
    seed.x = water.x;
    seed.y = water.y;
    state.ambientTraffic.push(seed);
  }
}

async function fetchLiveTraffic() {
  if (!LIVE_TRAFFIC_ENDPOINT) return;

  const url = `${LIVE_TRAFFIC_ENDPOINT}?minLon=${MAP_BOUNDS.minLon}&maxLon=${MAP_BOUNDS.maxLon}&minLat=${MAP_BOUNDS.minLat}&maxLat=${MAP_BOUNDS.maxLat}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error("invalid payload");

    state.ambientTraffic = rows
      .filter((r) => Number.isFinite(r.lon) && Number.isFinite(r.lat))
      .slice(0, 200)
      .map((r, idx) => {
        const p = lonLatToWorld(Number(r.lon), Number(r.lat));
        const n = nearestOnRoute(p);
        const maxLane = maxLaneOffsetForRouteT(n.routeT, 3);
        if (n.dist > maxLane + 10) return null;

        const cog = Number.isFinite(r.cog) ? r.cog : rng(0, 359);
        const rad = (cog * Math.PI) / 180;
        const heading = { x: Math.cos(rad), y: Math.sin(rad) };
        const dirDot = heading.x * n.tangent.x + heading.y * n.tangent.y;
        const direction = dirDot >= 0 ? 1 : -1;
        const speed = Number.isFinite(r.sog) ? Math.max(0, r.sog * 0.9) : rng(14, 42);
        return {
          name: r.name || `LIVE-${idx}`,
          x: n.x + n.normal.x * Math.max(-maxLane, Math.min(maxLane, n.signedOffset)),
          y: n.y + n.normal.y * Math.max(-maxLane, Math.min(maxLane, n.signedOffset)),
          routeT: n.routeT,
          laneOffset: Math.max(-maxLane, Math.min(maxLane, n.signedOffset)),
          direction,
          heading,
          speed,
          radius: 5.2,
          lengthMul: 2.35,
          cargo: r.type || "AIS",
          source: "api"
        };
      })
      .filter(Boolean);
  } catch (_e) {
    if (!state.ambientTraffic.length) {
      setupAmbientTraffic();
    }
  }
}

function spawnEscort(i, routeT = null) {
  const base = sampleRoute(routeT ?? (0.08 + i * 0.015));
  const spawnPos = clampPointToWater({ x: base.x + base.normal.x * (18 + i * 14), y: base.y + base.normal.y * (18 + i * 14) }, base, 180);
  const e = {
    kind: "escort",
    x: spawnPos.x,
    y: spawnPos.y,
    vx: 0,
    vy: 0,
    heading: { x: 1, y: 0 },
    hp: 200,
    maxHp: 200,
    radius: 5,
    speed: 162,
    turnRate: 6,
    speedNow: 0,
    waypoint: null,
    samReload: 0,
    ciwsReload: 0,
    manualVx: 0,
    manualVy: 0
  };
  state.escorts.push(e);
  state.ships.push(e);
}

function spawnTanker(direction = Math.random() < 0.5 ? 1 : -1) {
  const shipClass = pick(shipClasses);
  const cargo = pick(cargoTypes);
  const full = Math.random() < (direction === 1 ? 0.72 : 0.38);
  const stageFirst = Math.random() < 0.45;
  const t0 = stageFirst
    ? direction === 1
      ? ANCHOR_ZONES.west.entryT + rng(-0.015, 0.015)
      : ANCHOR_ZONES.east.entryT + rng(-0.015, 0.015)
    : direction === 1
      ? rng(0, 0.04)
      : rng(0.96, 1);
  const laneMaxAtSpawn = maxLaneOffsetForRouteT(t0, 4);
  const laneOffset = rng(-laneMaxAtSpawn, laneMaxAtSpawn);
  const base = sampleRoute(t0);

  const anchor = direction === 1 ? anchorWest : anchorEast;
  const anchorRad = direction === 1 ? ANCHOR_ZONES.west.radius : ANCHOR_ZONES.east.radius;
  const moorHeadingBase = direction === 1 ? { ...base.tangent } : { x: -base.tangent.x, y: -base.tangent.y };
  const moorHeading = normalizeVec(rotateVec(moorHeadingBase, rng(-0.22, 0.22)));

  const spawnPos = clampPointToWater({ x: base.x + base.normal.x * laneOffset, y: base.y + base.normal.y * laneOffset }, base, 220);

  state.ships.push({
    kind: "tanker",
    shipClass: shipClass.key,
    cargo: cargo.name,
    cargoValue: full ? cargo.value : Math.round(cargo.value * 0.25),
    fireRisk: full ? cargo.fireRisk : Math.max(0.2, cargo.fireRisk * 0.45),
    loadState: full ? "FULL" : "EMPTY",
    direction,
    routeT: t0,
    laneOffset,
    targetLaneOffset: laneOffset,
    speed: full ? shipClass.speed * 0.92 : shipClass.speed * 1.08,
    cruiseSpeed: full ? shipClass.speed * 0.92 : shipClass.speed * 1.08,
    turnRate: shipClass.turnRate,
    speedNow: 0,
    boostTimer: 0,
    stuckTimer: 0,
    recoveryTimer: 0,
    laneBias: Math.random() < 0.5 ? -1 : 1,
    prevRouteT: t0,
    heading: { ...moorHeading },
    moorHeading,
    hp: shipClass.hp,
    maxHp: shipClass.hp,
    radius: shipClass.radius,
    lengthMul: shipClass.lengthMul,
    x: spawnPos.x,
    y: spawnPos.y,
    staged: stageFirst,
    stageTimer: stageFirst ? rng(9, 20) : 0,
    burning: false,
    burn: 0,
    sunk: false
  });
}

// Iranian side attacks only (north side / smaller world Y)
function spawnThreat() {
  const targets = state.ships.filter((s) => s.kind === "tanker" && !s.sunk);
  if (!targets.length) return;
  const target = pick(targets);
  const kind = Math.random() < 0.57 ? "drone" : "missile";

  const center = sampleRoute(target.routeT);
  const xJitter = rng(-220, 220);
  const yNorthOffset = rng(120, 280);
  const spawnX = center.x + xJitter;
  const spawnY = Math.max(0, center.y - yNorthOffset);

  state.threats.push({
    kind,
    x: spawnX,
    y: spawnY,
    speed: kind === "missile" ? 245 : 165,
    hp: kind === "missile" ? 34 : 18,
    damage: kind === "missile" ? 44 : 20,
    target,
    radius: kind === "missile" ? 3 : 2
  });
}

function spawnAlliedPickup() {
  const t = rng(0.2, 0.9);
  const p = sampleRoute(t);
  // Allied side approximate = south side (larger world Y)
  state.alliedPickups.push({
    x: p.x + p.normal.x * -24,
    y: p.y + p.normal.y * -24,
    radius: 9,
    life: 28
  });
}

function bindInput() {
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    state.keys.add(k);

    if (e.key === "Tab") {
      e.preventDefault();
      state.selectedEscort = (state.selectedEscort + 1) % state.escorts.length;
      state.selectedTanker = null;
    }

    if (k === "f") useDamageControl();
    if (["1", "2", "3"].includes(e.key)) state.priority = e.key === "1" ? "missile" : e.key === "2" ? "drone" : "any";
    if (e.key === "+" || e.key === "=") state.zoom = Math.min(2.2, state.zoom + 0.1);
    if (e.key === "-") state.zoom = Math.max(0.6, state.zoom - 0.1);
    if (e.key === "7") spendUpgrade("fleet");
    if (e.key === "8") spendUpgrade("weapon");
    if (e.key === "9") spendUpgrade("damage");

    const t = state.selectedTanker;
    if (t && !t.sunk) {
      const laneMax = maxLaneOffsetForRouteT(t.routeT, 4);
      if (k === "u") t.targetLaneOffset = Math.max(-laneMax, t.targetLaneOffset - 12);
      if (k === "o") t.targetLaneOffset = Math.min(laneMax, t.targetLaneOffset + 12);
    }
  });

  window.addEventListener("keyup", (e) => state.keys.delete(e.key.toLowerCase()));

  canvas.addEventListener("pointerdown", (e) => {
    state.pointer.down = true;
    state.pointer.moved = false;
    state.pointer.lx = e.clientX;
    state.pointer.ly = e.clientY;
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!state.pointer.down) return;
    const dx = e.clientX - state.pointer.lx;
    const dy = e.clientY - state.pointer.ly;
    state.pointer.lx = e.clientX;
    state.pointer.ly = e.clientY;
    if (Math.abs(dx) + Math.abs(dy) > 3) state.pointer.moved = true;
    state.camera.x -= dx / state.zoom;
    state.camera.y -= dy / state.zoom;
  });

  canvas.addEventListener("pointerup", (e) => {
    if (!state.pointer.moved) handleTap(e.clientX, e.clientY);
    state.pointer.down = false;
  });

  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const before = screenToWorld(sx, sy);

      const step = e.deltaY > 0 ? -0.08 : 0.08;
      state.zoom = Math.max(0.6, Math.min(2.2, state.zoom + step));

      const after = screenToWorld(sx, sy);
      state.camera.x += before.x - after.x;
      state.camera.y += before.y - after.y;
    },
    { passive: false }
  );
}

function screenToWorld(screenX, screenY) {
  return { x: state.camera.x + screenX / state.zoom, y: state.camera.y + (screenY - 54) / state.zoom };
}

function handleTap(screenX, screenY) {
  const p = screenToWorld(screenX, screenY);

  for (let i = 0; i < state.escorts.length; i++) {
    const e = state.escorts[i];
    if (Math.hypot(e.x - p.x, e.y - p.y) < e.radius + 8) {
      state.selectedEscort = i;
      state.selectedTanker = null;
      return;
    }
  }

  const tanker = state.ships.find((s) => s.kind === "tanker" && !s.sunk && Math.hypot(s.x - p.x, s.y - p.y) < s.radius + 8);
  if (tanker) {
    state.selectedTanker = tanker;
    return;
  }

  const burning = state.ships.find(
    (s) => s.kind === "tanker" && s.burning && !s.sunk && Math.hypot(s.x - p.x, s.y - p.y) < s.radius + 10
  );
  if (burning) {
    useDamageControl(burning);
    return;
  }

  if (state.selectedTanker && !state.selectedTanker.sunk) {
    const n = nearestOnRoute(p);
    const laneMax = maxLaneOffsetForRouteT(n.routeT, 4);
    state.selectedTanker.targetLaneOffset = Math.max(-laneMax, Math.min(laneMax, n.signedOffset));
    return;
  }

  const esc = state.escorts[state.selectedEscort];
  if (esc) {
    const c = clampToCorridor(p, 6);
    esc.waypoint = clampPointToWater(c, { x: esc.x, y: esc.y }, 220);
  }
}

function useDamageControl(forced = null) {
  const escort = state.escorts[state.selectedEscort];
  if (!escort) return;
  const candidates = state.ships
    .filter((s) => s.kind === "tanker" && s.burning && !s.sunk)
    .sort((a, b) => Math.hypot(a.x - escort.x, a.y - escort.y) - Math.hypot(b.x - escort.x, b.y - escort.y));
  const t = forced || candidates[0];
  if (!t) return;
  if (Math.hypot(t.x - escort.x, t.y - escort.y) > 240) return;

  const dcStrength = 1.35 + (state.upgrades.damageControlTier - 1) * 0.45;
  t.burn = Math.max(0, t.burn - dcStrength);
  if (t.burn <= 0.12) t.burning = false;
  state.score += 8;
}

function update(dt) {
  if (state.ended) return;

  if (DEBUG_MAP_ONLY) {
    state.ambientTraffic = [];
    state.threats = [];
    state.projectiles = [];
    state.alliedPickups = [];
    state.tollGates = [];
    state.time += dt;
    hud.timer.textContent = `Time: ${Math.max(0, Math.ceil(state.duration - state.time))}`;
    hud.score.textContent = "Score: diagnostic";
    hud.delivered.textContent = "Delivered: diagnostic";
    hud.lost.textContent = "Lost: diagnostic";
    hud.burning.textContent = "Burning: diagnostic";
    hud.status.textContent = "Status: MAP-ONLY diagnostic (tiles + corridor overlay only)";
    updateCamera(dt);
    return;
  }

  state.time += dt;
  state.messageTimer = Math.max(0, state.messageTimer - dt);

  updateCamera(dt);

  if (!DEBUG_CORRIDOR_ONLY && state.time > state.spawn.tankerAt) {
    spawnTanker(Math.random() < 0.5 ? 1 : -1);
    state.spawn.tankerAt = state.time + rng(2.4, 4.5);
  }
  if (!DEBUG_CORRIDOR_ONLY && state.time > state.spawn.threatAt) {
    spawnThreat();
    state.spawn.threatAt = state.time + rng(1.0, 2.0);
  }
  if (!DEBUG_CORRIDOR_ONLY && state.time > state.spawn.alliedAt) {
    spawnAlliedPickup();
    state.spawn.alliedAt = state.time + rng(20, 30);
  }

  if (!DEBUG_CORRIDOR_ONLY && state.liveTrafficEnabled && state.time >= state.trafficNextAt) {
    state.trafficNextAt = state.time + LIVE_TRAFFIC_REFRESH_SECONDS;
    fetchLiveTraffic();
  }

  if (!DEBUG_CORRIDOR_ONLY) updateAmbientTraffic(dt);
  updateEscorts(dt);
  updateTankers(dt);
  if (!DEBUG_CORRIDOR_ONLY) {
    updateThreats(dt);
    updateWeapons();
    updateProjectiles(dt);
    updateTollGates(dt);
    updateAlliedPickups(dt);
  }
  checkCollisionsAndGrounding(dt);

  if (state.time >= state.duration) {
    state.ended = true;
    state.message = state.delivered >= 24 ? "Status: Victory" : "Status: Defeat";
  }

  const burningCount = state.ships.filter((s) => s.kind === "tanker" && s.burning && !s.sunk).length;
  hud.timer.textContent = `Time: ${Math.max(0, Math.ceil(state.duration - state.time))}`;
  hud.score.textContent = `Score: ${Math.round(state.score)}`;
  hud.delivered.textContent = `Delivered: ${state.delivered}`;
  hud.lost.textContent = `Lost: ${state.lost}`;
  hud.burning.textContent = `Burning: ${burningCount}`;
  const baseStatus = DEBUG_CORRIDOR_ONLY
    ? "Status: Corridor debug mode (traffic/attacks disabled)"
    : `Status: Running (Shield ${state.alliedShieldCharges}, Traffic ${state.liveTrafficSource.toUpperCase()}:${state.ambientTraffic.length})`;
  hud.status.textContent = state.messageTimer > 0 ? state.message : baseStatus;
}

function updateAmbientTraffic(dt) {
  for (const v of state.ambientTraffic) {
    v.routeT += (v.direction * v.speed * dt * 0.55) / routeLength;
    if (v.routeT < 0) v.routeT += 1;
    if (v.routeT > 1) v.routeT -= 1;

    const p = sampleRoute(v.routeT);
    const maxLane = maxLaneOffsetForRouteT(v.routeT, 3);
    v.laneOffset = Math.max(-maxLane, Math.min(maxLane, v.laneOffset));
    const next = { x: p.x + p.normal.x * v.laneOffset, y: p.y + p.normal.y * v.laneOffset };
    const water = clampPointToWater(next, { x: v.x, y: v.y }, 140);
    v.x = water.x;
    v.y = water.y;
    v.heading = v.direction === 1 ? p.tangent : { x: -p.tangent.x, y: -p.tangent.y };
  }
}

function updateCamera(dt) {
  const boost = state.keys.has("shift") ? 2.2 : 1;
  if (state.keys.has("arrowleft") || state.keys.has("a")) state.camera.x -= state.camera.speed * boost * dt;
  if (state.keys.has("arrowright") || state.keys.has("d")) state.camera.x += state.camera.speed * boost * dt;
  if (state.keys.has("arrowup") || state.keys.has("w")) state.camera.y -= state.camera.speed * boost * dt;
  if (state.keys.has("arrowdown") || state.keys.has("s")) state.camera.y += state.camera.speed * boost * dt;

  handleGamepad(dt);

  const viewW = canvas.width / state.zoom;
  const viewH = (canvas.height - 54) / state.zoom;
  const maxX = Math.max(0, WORLD.width - viewW);
  const maxY = Math.max(0, WORLD.height - viewH);
  state.camera.x = Math.max(-100, Math.min(maxX + 100, state.camera.x));
  state.camera.y = Math.max(-100, Math.min(maxY + 120, state.camera.y));
}

function updateEscorts(dt) {
  const selected = state.escorts[state.selectedEscort];
  if (selected) {
    const steer = { x: 0, y: 0 };
    if (state.keys.has("j")) steer.x -= 1;
    if (state.keys.has("l")) steer.x += 1;
    if (state.keys.has("i")) steer.y -= 1;
    if (state.keys.has("k")) steer.y += 1;

    if (steer.x || steer.y) {
      const m = Math.hypot(steer.x, steer.y) || 1;
      selected.manualVx = (steer.x / m) * selected.speed;
      selected.manualVy = (steer.y / m) * selected.speed;
      selected.waypoint = null;
    } else {
      selected.manualVx *= 0.86;
      selected.manualVy *= 0.86;
    }
  }

  for (const e of state.escorts) {
    const prev = { x: e.x, y: e.y };
    if (Math.hypot(e.manualVx, e.manualVy) > 2) {
      e.x += e.manualVx * dt;
      e.y += e.manualVy * dt;
    } else if (e.waypoint) {
      const dx = e.waypoint.x - e.x;
      const dy = e.waypoint.y - e.y;
      const d = Math.hypot(dx, dy);
      if (d < 4) e.waypoint = null;
      else {
        e.x += (dx / d) * e.speed * 1.2 * dt;
        e.y += (dy / d) * e.speed * 1.2 * dt;
      }
    }

    const c = clampToCorridor({ x: e.x, y: e.y }, 5);
    const cw = clampPointToWater(c, prev, 180);
    e.x = cw.x;
    e.y = cw.y;

    if (!isNavigableWater({ x: e.x, y: e.y })) {
      e.hp = Math.max(20, e.hp - navRules.groundingPenalty * dt);
    }
    const vx = e.x - prev.x;
    const vy = e.y - prev.y;
    const l = Math.hypot(vx, vy);
    if (l > 0.01) {
      const desired = { x: vx / l, y: vy / l };
      e.heading = smoothHeading(e.heading, desired, e.turnRate, dt);
      e.speedNow = l / Math.max(0.0001, dt);
    } else {
      e.speedNow *= 0.94;
    }

    e.samReload -= dt;
    e.ciwsReload -= dt;
  }
}

function applyTankerSeparation() {
  const tankers = state.ships.filter((s) => s.kind === "tanker" && !s.sunk && !s.staged);
  for (let i = 0; i < tankers.length; i++) {
    for (let j = i + 1; j < tankers.length; j++) {
      const a = tankers[i];
      const b = tankers[j];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d < navRules.tankerSeparation) {
        const steer = (navRules.tankerSeparation - d) * 0.35;
        const maxA = maxLaneOffsetForRouteT(a.routeT, 4);
        const maxB = maxLaneOffsetForRouteT(b.routeT, 4);

        if (a.direction === b.direction) {
          const aLeads = a.direction === 1 ? a.routeT >= b.routeT : a.routeT <= b.routeT;
          const lead = aLeads ? a : b;
          const lag = aLeads ? b : a;
          const lagMax = maxLaneOffsetForRouteT(lag.routeT, 4);
          const leadMax = maxLaneOffsetForRouteT(lead.routeT, 4);

          lag.targetLaneOffset = clamp(lag.targetLaneOffset + lag.laneBias * steer * 1.35, -lagMax, lagMax);
          lead.targetLaneOffset = clamp(lead.targetLaneOffset - lag.laneBias * steer * 0.45, -leadMax, leadMax);
          lag.boostTimer = Math.max(lag.boostTimer, 0.8);
          lead.speed = Math.max((lead.cruiseSpeed || lead.speed) * 0.78, lead.speed * 0.985);
        } else {
          a.targetLaneOffset = clamp(a.targetLaneOffset - steer, -maxA, maxA);
          b.targetLaneOffset = clamp(b.targetLaneOffset + steer, -maxB, maxB);
          a.speed = Math.max((a.cruiseSpeed || a.speed) * 0.75, a.speed * 0.98);
          b.speed = Math.max((b.cruiseSpeed || b.speed) * 0.75, b.speed * 0.98);
        }
      }
    }
  }
}

function checkCollisionsAndGrounding(dt) {
  const active = state.ships.filter((s) => !s.sunk);

  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i];
      const b = active[j];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d < navRules.collisionRange + a.radius * 0.25 + b.radius * 0.25) {
        if (a.kind === "tanker") a.hp -= 8 * dt;
        if (b.kind === "tanker") b.hp -= 8 * dt;
        if (a.kind === "escort") a.hp -= 3 * dt;
        if (b.kind === "escort") b.hp -= 3 * dt;
        state.message = "Status: Collision risk! Maintain separation";
        state.messageTimer = 0.8;
      }
    }
  }

  for (const s of active) {
    if (!isNavigableWater({ x: s.x, y: s.y })) {
      if (s.kind === "tanker") {
        s.hp -= navRules.groundingPenalty * dt;
        if (!s.burning && Math.random() < 0.03) {
          s.burning = true;
          s.burn = Math.max(0.25, s.burn);
        }
      }
    }
  }
}

function updateTankers(dt) {
  for (const t of state.ships) {
    if (t.kind !== "tanker" || t.sunk) continue;
    const prevX = t.x;
    const prevY = t.y;

    if (t.staged) {
      t.stageTimer -= dt;
      t.heading = smoothHeading(t.heading, t.moorHeading, t.turnRate * 0.6, dt);
      t.speedNow *= 0.9;
      if (t.stageTimer <= 0) {
        t.staged = false;
      } else {
        continue;
      }
    }

    const cruise = t.cruiseSpeed || t.speed;
    t.speed += (cruise - t.speed) * dt * 0.9;

    const laneMax = maxLaneOffsetForRouteT(t.routeT, 4);
    t.targetLaneOffset = clamp(t.targetLaneOffset, -laneMax, laneMax);
    t.laneOffset += (t.targetLaneOffset - t.laneOffset) * dt * 2;
    const moveBoost = t.boostTimer > 0 ? 1.34 : 1;
    t.boostTimer = Math.max(0, t.boostTimer - dt);
    t.routeT += (t.direction * t.speed * moveBoost * 1.15 * dt) / routeLength;

    // Corridor can narrow quickly through the Strait, so re-clamp after route advancement.
    const laneMaxNow = maxLaneOffsetForRouteT(t.routeT, 4);
    t.laneOffset = clamp(t.laneOffset, -laneMaxNow, laneMaxNow);

    if (t.burning) {
      t.burn += dt * 0.38;
      t.hp -= (4 + t.burn * 3.25) * dt;
    }

    if (t.hp <= 0 || t.burn > 4.9) {
      t.sunk = true;
      state.lost += 1;
      state.score -= 120;
      if (state.selectedTanker === t) state.selectedTanker = null;
      continue;
    }

    const exitedEast = t.direction === 1 && t.x > WORLD.width + 24;
    const exitedWest = t.direction === -1 && t.x < -24;
    if (t.routeT > 1.08 || t.routeT < -0.08 || exitedEast || exitedWest) {
      t.sunk = true;
      state.delivered += 1;
      state.score += 45 + t.cargoValue;
      grantDeliveryPowerProgress();
      if (state.selectedTanker === t) state.selectedTanker = null;
      continue;
    }

    const p = sampleRoute(t.routeT);
    t.x = p.x + p.normal.x * t.laneOffset;
    t.y = p.y + p.normal.y * t.laneOffset;

    // Final safety snap: guarantees tankers stay inside navigable water corridor.
    const n = nearestOnRoute({ x: t.x, y: t.y });
    const laneMaxSafe = maxLaneOffsetForRouteT(n.routeT, 4);
    const safeOffset = clamp(n.signedOffset, -laneMaxSafe, laneMaxSafe);
    t.routeT = n.routeT;
    t.laneOffset = safeOffset;
    t.x = n.x + n.normal.x * safeOffset;
    t.y = n.y + n.normal.y * safeOffset;

    const waterLocked = clampPointToWater({ x: t.x, y: t.y }, { x: prevX, y: prevY }, 220);
    t.x = waterLocked.x;
    t.y = waterLocked.y;
    const nw = nearestOnRoute({ x: t.x, y: t.y });
    t.routeT = nw.routeT;
    t.laneOffset = clamp(nw.signedOffset, -maxLaneOffsetForRouteT(nw.routeT, 4), maxLaneOffsetForRouteT(nw.routeT, 4));

    const desiredHeading = t.direction === 1 ? { ...p.tangent } : { x: -p.tangent.x, y: -p.tangent.y };
    t.heading = smoothHeading(t.heading, desiredHeading, t.turnRate, dt);
    const moved = Math.hypot(t.x - prevX, t.y - prevY);
    t.speedNow = moved / Math.max(0.0001, dt);

    const prevRouteT = t.prevRouteT ?? t.routeT;
    const forwardProgress = (t.routeT - prevRouteT) * t.direction;
    t.prevRouteT = t.routeT;

    const lowProgress = forwardProgress < 0.00012;
    const lowMotion = t.speedNow < Math.max(8, cruise * 0.22);
    if (lowProgress && lowMotion) t.stuckTimer += dt;
    else t.stuckTimer = Math.max(0, t.stuckTimer - dt * 1.7);

    if (t.stuckTimer > 2.2) {
      const rescueStep = (8 + t.radius * 0.9) * (Math.random() < 0.5 ? -1 : 1) * (t.laneBias || 1);
      const laneMaxRescue = maxLaneOffsetForRouteT(t.routeT, 4);
      t.targetLaneOffset = clamp(t.targetLaneOffset + rescueStep, -laneMaxRescue, laneMaxRescue);
      t.boostTimer = Math.max(t.boostTimer, 2.0);
      t.recoveryTimer = Math.max(t.recoveryTimer, 3.0);
      t.stuckTimer = 0.7;
      state.message = "Status: Auto-nav recovery active";
      state.messageTimer = 0.8;
    }

    if (t.recoveryTimer > 0) {
      t.recoveryTimer = Math.max(0, t.recoveryTimer - dt);
      const recoverCruise = cruise * 1.16;
      t.speed += (recoverCruise - t.speed) * dt * 1.15;
    }
  }

  applyTankerSeparation();
}

function updateThreats(dt) {
  for (const th of state.threats) {
    if (!th.target || th.target.sunk) {
      th.hp = -1;
      continue;
    }

    // allied shield support: consumes charge to intercept incoming threat near convoy
    if (state.alliedShieldCharges > 0) {
      const nearConvoy = Math.hypot(th.x - th.target.x, th.y - th.target.y) < 160;
      if (nearConvoy) {
        state.alliedShieldCharges -= 1;
        th.hp = -1;
        state.score += 18;
        state.message = "Status: Allied shield intercepted threat";
        state.messageTimer = 1.2;
        continue;
      }
    }

    const dx = th.target.x - th.x;
    const dy = th.target.y - th.y;
    const d = Math.hypot(dx, dy) || 0.001;
    th.x += (dx / d) * th.speed * dt;
    th.y += (dy / d) * th.speed * dt;

    if (d < th.target.radius + 7) {
      th.target.hp -= th.damage;
      if (!th.target.burning && Math.random() < 0.45 * th.target.fireRisk) {
        th.target.burning = true;
        th.target.burn = Math.max(th.target.burn, 0.25);
      }
      th.hp = -1;
    }
  }
  state.threats = state.threats.filter((t) => t.hp > 0);
}

function updateWeapons() {
  const weaponTier = state.upgrades.weaponTier;
  const samDamage = 24 + (weaponTier - 1) * 4;
  const ciwsDamage = 10 + (weaponTier - 1) * 2;
  const samReloadBase = 0.9 * (1 - (weaponTier - 1) * 0.12);
  const ciwsReloadBase = 0.11 * (1 - (weaponTier - 1) * 0.10);

  for (const e of state.escorts) {
    let targets = state.threats.filter((t) => Math.hypot(t.x - e.x, t.y - e.y) < 460);
    if (!targets.length) continue;
    if (state.priority !== "any") {
      const pref = targets.filter((t) => t.kind === state.priority);
      if (pref.length) targets = pref;
    }

    targets.sort((a, b) => Math.hypot(a.x - e.x, a.y - e.y) - Math.hypot(b.x - e.x, b.y - e.y));
    const t = targets[0];
    const d = Math.hypot(t.x - e.x, t.y - e.y);

    if (d < 460 && e.samReload <= 0) {
      fireProjectile(e.x, e.y, t, 470, samDamage, "sam");
      e.samReload = Math.max(0.35, samReloadBase);
    }
    if (d < 150 && e.ciwsReload <= 0) {
      fireProjectile(e.x, e.y, t, 660, ciwsDamage, "ciws");
      e.ciwsReload = Math.max(0.05, ciwsReloadBase);
    }
  }
}

function fireProjectile(x, y, target, speed, damage, kind) {
  state.projectiles.push({ x, y, target, speed, damage, kind, life: 1.6 });
}

function updateProjectiles(dt) {
  for (const p of state.projectiles) {
    p.life -= dt;
    if (p.life <= 0 || !p.target || p.target.hp <= 0) {
      p.life = -1;
      continue;
    }
    const dx = p.target.x - p.x;
    const dy = p.target.y - p.y;
    const d = Math.hypot(dx, dy) || 0.001;
    p.x += (dx / d) * p.speed * dt;
    p.y += (dy / d) * p.speed * dt;
    if (d < p.target.radius + 4) {
      p.target.hp -= p.damage;
      p.life = -1;
      state.score += p.kind === "sam" ? 4 : 2;
      if (p.target.hp <= 0) state.score += p.target.kind === "missile" ? 14 : 8;
    }
  }
  state.projectiles = state.projectiles.filter((p) => p.life > 0);
  state.threats = state.threats.filter((t) => t.hp > 0);
}

function updateTollGates(dt) {
  for (const gate of state.tollGates) {
    gate.cooldown = Math.max(0, gate.cooldown - dt);
    for (const s of state.ships) {
      if (s.kind !== "tanker" || s.sunk) continue;
      const d = Math.hypot(s.x - gate.x, s.y - gate.y);
      if (d < gate.radius + s.radius && gate.cooldown <= 0) {
        gate.cooldown = 16;
        s.boostTimer = Math.max(s.boostTimer, 7);
        const payout = s.loadState === "FULL" ? 36 : 20;
        state.score += payout;
        state.message = `Status: Toll paid +${payout} (speed boost)`;
        state.messageTimer = 1.7;
      }
    }
  }
}

function updateAlliedPickups(dt) {
  for (const p of state.alliedPickups) {
    p.life -= dt;
    if (p.life <= 0) continue;

    const consumers = [...state.escorts, ...state.ships.filter((s) => s.kind === "tanker" && !s.sunk)];
    for (const s of consumers) {
      if (Math.hypot(s.x - p.x, s.y - p.y) < s.radius + p.radius) {
        p.life = -1;
        state.alliedShieldCharges += 4;
        state.score += 24;
        state.message = "Status: Allied defense link +4 shield charges";
        state.messageTimer = 2;
        break;
      }
    }
  }
  state.alliedPickups = state.alliedPickups.filter((p) => p.life > 0);
}

function handleGamepad(dt) {
  const gp = navigator.getGamepads ? navigator.getGamepads()[0] : null;
  if (!gp) return;
  const dead = (v) => (Math.abs(v) < 0.16 ? 0 : v);

  state.camera.x += dead(gp.axes[0] || 0) * 520 * dt;
  state.camera.y += dead(gp.axes[1] || 0) * 520 * dt;

  const pressed = (i) => gp.buttons[i] && gp.buttons[i].pressed;
  const tap = (i) => pressed(i) && !state.gamepad.prevButtons[i];

  if (tap(4)) {
    state.selectedEscort = (state.selectedEscort - 1 + state.escorts.length) % state.escorts.length;
    state.selectedTanker = null;
  }
  if (tap(5)) {
    state.selectedEscort = (state.selectedEscort + 1) % state.escorts.length;
    state.selectedTanker = null;
  }
  if (tap(0)) useDamageControl();
  if (tap(12)) state.priority = "missile";
  if (tap(13)) state.priority = "drone";
  if (tap(15)) state.priority = "any";

  if (tap(2)) {
    const center = screenToWorld(canvas.width * 0.5, canvas.height * 0.5);
    const e = state.escorts[state.selectedEscort];
    if (e) e.waypoint = clampToCorridor(center, 6);
  }

  const e = state.escorts[state.selectedEscort];
  if (e) {
    let sx = 0;
    let sy = 0;
    if (pressed(14)) sx -= 1;
    if (pressed(15)) sx += 1;
    if (pressed(12)) sy -= 1;
    if (pressed(13)) sy += 1;
    if (sx || sy) {
      const m = Math.hypot(sx, sy) || 1;
      e.manualVx = (sx / m) * e.speed;
      e.manualVy = (sy / m) * e.speed;
      e.waypoint = null;
    }
  }

  state.gamepad.prevButtons = gp.buttons.map((b) => b.pressed);
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(0, 54);
  ctx.scale(state.zoom, state.zoom);
  ctx.translate(-state.camera.x, -state.camera.y);

  drawMapTiles();
  drawSeaCorridorDebugOverlay();

  if (DEBUG_MAP_ONLY) {
    drawDiagnosticBanner();
    ctx.restore();
    return;
  }

  if (!DEBUG_CORRIDOR_ONLY) {
    drawTollGates();
    drawAlliedPickups();
    drawAmbientTraffic();
  }

  for (const s of state.ships) {
    if (s.kind === "tanker" && s.sunk) continue;
    if (s.kind === "escort") drawEscort(s);
    if (s.kind === "tanker") drawTanker(s);
  }
  if (!DEBUG_CORRIDOR_ONLY) {
    for (const t of state.threats) drawThreat(t);
    for (const p of state.projectiles) drawProjectile(p);
  }
  drawLabels();

  ctx.restore();

  ctx.fillStyle = "rgba(10,20,32,0.72)";
  ctx.fillRect(8, canvas.height - 26, 340, 18);
  ctx.fillStyle = "#dce8ff";
  ctx.font = "12px Segoe UI";
  ctx.fillText("Map data © OpenStreetMap contributors", 12, canvas.height - 13);
}

function drawAmbientTraffic() {
  for (const v of state.ambientTraffic) {
    drawShipSprite(v.x, v.y, v.heading, {
      scale: v.radius * 1.65,
      lengthMul: v.lengthMul,
      hullColor: "rgba(194, 208, 228, 0.85)",
      outlineColor: "rgba(40, 50, 64, 0.8)",
      deckColor: "rgba(238,245,255,0.3)",
      style: "ambient",
      speedNow: v.speed
    });
  }
}

function drawMapTiles() {
  const scale = 2 ** TILE_Z;
  const viewW = canvas.width / state.zoom;
  const viewH = (canvas.height - 54) / state.zoom;
  const xMin = Math.floor(projBounds.minX * scale);
  const yMin = Math.floor(projBounds.minY * scale);
  const xMax = Math.ceil(projBounds.maxX * scale);
  const yMax = Math.ceil(projBounds.maxY * scale);

  for (let tx = xMin; tx <= xMax; tx++) {
    for (let ty = yMin; ty <= yMax; ty++) {
      const rec = getTile(TILE_Z, tx, ty);
      const tileNX = tx / scale;
      const tileNY = ty / scale;
      const wx = ((tileNX - projBounds.minX) / (projBounds.maxX - projBounds.minX)) * WORLD.width;
      const wy = ((tileNY - projBounds.minY) / (projBounds.maxY - projBounds.minY)) * WORLD.height;
      const ww = (1 / scale / (projBounds.maxX - projBounds.minX)) * WORLD.width;
      const wh = (1 / scale / (projBounds.maxY - projBounds.minY)) * WORLD.height;

      if (wx + ww < state.camera.x - 30 || wx > state.camera.x + viewW + 30) continue;
      if (wy + wh < state.camera.y - 80 || wy > state.camera.y + viewH + 80) continue;

      if (rec.loaded) ctx.drawImage(rec.img, wx, wy, ww, wh);
      else {
        ctx.fillStyle = "#19384f";
        ctx.fillRect(wx, wy, ww, wh);
      }
    }
  }
}

function drawSeaCorridor() {
  // Visual corridor overlay disabled (too noisy over map imagery).
  // Navigation still uses the same corridor rules in gameplay logic.
  return;

  // Render a tapered navigable channel so visuals match routing constraints.
  // We draw many short segments with local width sampled from routeT.
  ctx.strokeStyle = "rgba(75, 170, 255, 0.30)";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const segments = 56;
  let prev = sampleRoute(0);
  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    const curr = sampleRoute(t);
    const tm = (i - 0.5) / segments;
    ctx.lineWidth = corridorHalfWidthAtT(tm) * 2;
    ctx.beginPath();
    ctx.moveTo(prev.x, prev.y);
    ctx.lineTo(curr.x, curr.y);
    ctx.stroke();
    prev = curr;
  }

  ctx.strokeStyle = "rgba(220,245,255,0.72)";
  ctx.lineWidth = 2;
  ctx.setLineDash([14, 12]);
  ctx.beginPath();
  ctx.moveTo(routePoints[0].x, routePoints[0].y);
  for (let i = 1; i < routePoints.length; i++) ctx.lineTo(routePoints[i].x, routePoints[i].y);
  ctx.stroke();
  ctx.setLineDash([]);

  // visual anchor queues (stranded tanker groups)
  ctx.strokeStyle = "rgba(255, 168, 80, 0.75)";
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.arc(anchorWest.x, anchorWest.y, ANCHOR_ZONES.west.radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(anchorEast.x, anchorEast.y, ANCHOR_ZONES.east.radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawSeaCorridorDebugOverlay() {
  drawNavigablePolygonOverlay();

  // Unmistakable proof overlay is active.
  ctx.fillStyle = "rgba(255, 0, 200, 0.9)";
  ctx.font = "bold 14px Segoe UI";
  ctx.fillText(`POLYGON ON (${navigablePolygonWorld.length} pts)`, state.camera.x + 20, state.camera.y + 112);

  // Route overlay intentionally disabled during map-only diagnostics.
  // This prevents showing an incorrect dark-blue band while route geometry is being tuned.

  if (DEBUG_CORRIDOR_ONLY) {
    ctx.fillStyle = "rgba(6, 14, 26, 0.70)";
    ctx.fillRect(state.camera.x + 12, state.camera.y + 66, 450, 26);
    ctx.fillStyle = "#cfefff";
    ctx.font = "13px Segoe UI";
    ctx.fillText("Corridor Debug View: cyan polygon = your allowed zone", state.camera.x + 20, state.camera.y + 84);
  }
}

function drawNavigablePolygonOverlay() {
  if (!navigablePolygonWorld.length) return;
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.beginPath();
  ctx.moveTo(navigablePolygonWorld[0].x, navigablePolygonWorld[0].y);
  for (let i = 1; i < navigablePolygonWorld.length; i++) {
    ctx.lineTo(navigablePolygonWorld[i].x, navigablePolygonWorld[i].y);
  }
  ctx.closePath();

  ctx.fillStyle = "rgba(255, 0, 200, 0.12)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 0, 200, 0.95)";
  ctx.lineWidth = 4;
  ctx.setLineDash([14, 8]);
  ctx.stroke();
  ctx.setLineDash([]);

  // Vertex markers so polygon is unmistakably visible over water tiles.
  ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
  for (const p of navigablePolygonWorld) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawDiagnosticBanner() {
  ctx.fillStyle = "rgba(10, 20, 32, 0.84)";
  ctx.fillRect(state.camera.x + 12, state.camera.y + 66, 620, 34);
  ctx.fillStyle = "#bfe8ff";
  ctx.font = "bold 15px Segoe UI";
  ctx.fillText("MAP-ONLY DIAGNOSTIC: only map tiles and highlighted corridor are rendered", state.camera.x + 20, state.camera.y + 89);
}

function drawTollGates() {
  for (const gate of state.tollGates) {
    const active = gate.cooldown <= 0;
    ctx.fillStyle = active ? "rgba(255, 216, 90, 0.9)" : "rgba(180, 160, 100, 0.45)";
    ctx.beginPath();
    ctx.arc(gate.x, gate.y, gate.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(20,20,20,0.6)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

function drawAlliedPickups() {
  for (const p of state.alliedPickups) {
    ctx.save();
    ctx.translate(p.x, p.y);
    const pulse = 1 + Math.sin(state.time * 5) * 0.08;
    ctx.scale(pulse, pulse);
    ctx.fillStyle = "rgba(120, 255, 210, 0.92)";
    drawStar(0, 0, 5, p.radius, p.radius * 0.45);
    ctx.restore();
  }
}

function drawStar(cx, cy, spikes, outerR, innerR) {
  let rot = Math.PI / 2 * 3;
  const step = Math.PI / spikes;
  ctx.beginPath();
  ctx.moveTo(cx, cy - outerR);
  for (let i = 0; i < spikes; i++) {
    ctx.lineTo(cx + Math.cos(rot) * outerR, cy + Math.sin(rot) * outerR);
    rot += step;
    ctx.lineTo(cx + Math.cos(rot) * innerR, cy + Math.sin(rot) * innerR);
    rot += step;
  }
  ctx.lineTo(cx, cy - outerR);
  ctx.closePath();
  ctx.fill();
}

function drawEscort(e) {
  drawShipSprite(e.x, e.y, e.heading, {
    scale: e.radius * 2.0,
    lengthMul: 1.9,
    hullColor: "#8ed6ff",
    outlineColor: "#1d2a38",
    deckColor: "rgba(255,255,255,0.38)",
    style: "destroyer",
    speedNow: e.speedNow || 0
  });

  if (state.escorts[state.selectedEscort] === e) {
    ctx.strokeStyle = "#f5ff6a";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.radius + 5, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (e.waypoint) {
    ctx.strokeStyle = "rgba(170,255,200,0.8)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(e.x, e.y);
    ctx.lineTo(e.waypoint.x, e.waypoint.y);
    ctx.stroke();
  }
}

function drawTanker(t) {
  const colors = {
    "Crude Oil": "#d9b38c",
    LPG: "#b0d6ff",
    Helium: "#d7d0ff",
    Petrochemicals: "#ffb8a8",
    Urea: "#def2be",
    Containers: "#c9d0d8"
  };
  const classStyles = {
    VLCC: { lengthMul: 2.95, deck: "rgba(245,225,190,0.42)", style: "vlcc" },
    Suezmax: { lengthMul: 2.6, deck: "rgba(240,230,205,0.40)", style: "suezmax" },
    Aframax: { lengthMul: 2.35, deck: "rgba(240,230,205,0.36)", style: "aframax" },
    Container: { lengthMul: 2.4, deck: "rgba(170,210,250,0.33)", style: "container" },
    LNG: { lengthMul: 2.5, deck: "rgba(210,240,255,0.37)", style: "lng" }
  };
  const c = classStyles[t.shipClass] || classStyles.Suezmax;

  drawShipSprite(t.x, t.y, t.heading, {
    scale: t.radius * 2.0,
    lengthMul: t.lengthMul || c.lengthMul,
    hullColor: colors[t.cargo] || "#d6d6d6",
    outlineColor: "#2f2d2a",
    deckColor: c.deck,
    style: c.style,
    speedNow: t.speedNow || 0
  });

  if (state.selectedTanker === t) {
    ctx.strokeStyle = "#ffe66a";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(t.x, t.y, t.radius + 5, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(0,0,0,0.38)";
  ctx.fillRect(t.x - t.radius * 1.5, t.y + t.radius + 4, t.radius * 3, 4);
  ctx.fillStyle = "#72e497";
  ctx.fillRect(t.x - t.radius * 1.5, t.y + t.radius + 4, Math.max(0, (t.hp / t.maxHp) * t.radius * 3), 4);

  ctx.fillStyle = t.loadState === "FULL" ? "#ffd88e" : "#d7e6f2";
  ctx.font = "9px Segoe UI";
  ctx.fillText(`${t.loadState} ${t.shipClass}`, t.x - t.radius * 1.35, t.y - t.radius - 4);

  if (t.burning) {
    ctx.fillStyle = "rgba(255,130,64,0.92)";
    ctx.beginPath();
    ctx.arc(t.x, t.y - t.radius, 3 + t.burn * 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawWakeTrail(x, y, heading, length, width, alpha = 0.18) {
  const speedNorm = Math.max(0.15, Math.min(1.45, arguments[6] ?? 0.8));
  const len = length * (0.72 + speedNorm * 0.62);
  const w = width * (0.82 + speedNorm * 0.28);
  const visAlpha = alpha * (0.75 + Math.min(1.2, state.zoom) * 0.22);

  const backX = -heading.x;
  const backY = -heading.y;
  const nx = -backY;
  const ny = backX;

  ctx.fillStyle = `rgba(220,245,255,${visAlpha})`;
  ctx.beginPath();
  ctx.moveTo(x + nx * w, y + ny * w);
  ctx.lineTo(x - nx * w, y - ny * w);
  ctx.lineTo(x + backX * len - nx * (w * 0.25), y + backY * len - ny * (w * 0.25));
  ctx.lineTo(x + backX * len + nx * (w * 0.25), y + backY * len + ny * (w * 0.25));
  ctx.closePath();
  ctx.fill();
}

function drawShipSprite(x, y, heading, spec) {
  const { scale, lengthMul, hullColor, outlineColor, deckColor, style, speedNow = 0 } = spec;
  const lod = state.zoom;
  const speedNorm = Math.min(1.4, speedNow / 130);

  drawWakeTrail(
    x - heading.x * scale * 0.9,
    y - heading.y * scale * 0.9,
    heading,
    scale * (2.8 + lengthMul * 0.5),
    scale * 0.5,
    0.14,
    speedNorm
  );

  const a = Math.atan2(heading.y, heading.x);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);

  ctx.fillStyle = hullColor;
  ctx.strokeStyle = outlineColor;
  ctx.lineWidth = 1;

  const nose = scale * 1.0;
  const mid = scale * 0.35;
  const stern = -scale * lengthMul;
  const beam = scale * 0.38;

  ctx.beginPath();
  ctx.moveTo(nose, 0);
  ctx.lineTo(mid, -beam);
  ctx.lineTo(stern * 0.35, -beam * 0.88);
  ctx.lineTo(stern, -beam * 0.32);
  ctx.lineTo(stern - scale * 0.12, 0);
  ctx.lineTo(stern, beam * 0.32);
  ctx.lineTo(stern * 0.35, beam * 0.88);
  ctx.lineTo(mid, beam);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  if (lod > 0.95) {
    ctx.fillStyle = deckColor;
    ctx.fillRect(stern * 0.55, -beam * 0.48, Math.abs(stern) * 0.95, beam * 0.96);

    if (style === "container") {
      ctx.fillStyle = "rgba(210,80,80,0.40)";
      for (let i = 0; i < 4; i++) {
        ctx.fillRect(stern * 0.5 + i * scale * 0.35, -beam * 0.22, scale * 0.28, beam * 0.44);
      }
    }

    if (style === "destroyer") {
      ctx.fillStyle = "rgba(240,250,255,0.45)";
      ctx.fillRect(stern * 0.28, -beam * 0.18, scale * 0.55, beam * 0.36);
      ctx.fillRect(stern * 0.02, -beam * 0.14, scale * 0.25, beam * 0.28);
    }

    if (style === "lng") {
      ctx.fillStyle = "rgba(240,250,255,0.46)";
      for (let i = 0; i < 3; i++) {
        const dx = stern * 0.45 + i * scale * 0.45;
        ctx.beginPath();
        ctx.arc(dx, 0, scale * 0.16, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (style === "vlcc" || style === "suezmax" || style === "aframax") {
      ctx.fillStyle = "rgba(80,80,80,0.24)";
      ctx.fillRect(stern * 0.45, -beam * 0.08, Math.abs(stern) * 0.7, beam * 0.16);
    }
  } else {
    // Low zoom fallback silhouette
    ctx.fillStyle = "rgba(255,255,255,0.28)";
    ctx.fillRect(stern * 0.2, -beam * 0.2, scale * 0.4, beam * 0.4);
  }

  ctx.restore();
}

function drawThreat(t) {
  const aim = t.target ? Math.atan2(t.target.y - t.y, t.target.x - t.x) : 0;
  ctx.save();
  ctx.translate(t.x, t.y);
  ctx.rotate(aim);

  if (t.kind === "missile") {
    ctx.fillStyle = "#ffb089";
    ctx.strokeStyle = "rgba(60, 35, 30, 0.9)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(t.radius + 2.4, 0);
    ctx.lineTo(-t.radius - 2.2, -t.radius * 0.75);
    ctx.lineTo(-t.radius * 0.95, 0);
    ctx.lineTo(-t.radius - 2.2, t.radius * 0.75);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "rgba(255, 220, 120, 0.9)";
    ctx.beginPath();
    ctx.arc(-t.radius - 1.6, 0, 1.4, 0, Math.PI * 2);
    ctx.fill();
  } else {
    const r = t.radius + 0.8;
    ctx.fillStyle = "#ffe083";
    ctx.strokeStyle = "rgba(65, 58, 24, 0.9)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(r, 0);
    ctx.lineTo(0, r);
    ctx.lineTo(-r, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  ctx.restore();
}

function drawProjectile(p) {
  ctx.fillStyle = p.kind === "sam" ? "#6ef9ff" : "#ffffff";
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.kind === "sam" ? 2 : 1.5, 0, Math.PI * 2);
  ctx.fill();
}

function drawLabels() {
  const west = sampleRoute(0.02);
  const east = sampleRoute(0.98);
  // Move location labels inland so they don't obscure the shipping waterway.
  const westLabelX = west.x - 148;
  const westLabelY = west.y - 128;
  const eastLabelX = east.x - 62;
  const eastLabelY = east.y - 154;
  ctx.fillStyle = "rgba(10,20,32,0.62)";
  ctx.fillRect(westLabelX, westLabelY, 216, 24);
  ctx.fillRect(eastLabelX, eastLabelY, 204, 24);
  ctx.fillStyle = "#eaf2ff";
  ctx.font = "14px Segoe UI";
  ctx.fillText("Kharg / Gulf queue", westLabelX + 20, westLabelY + 17);
  ctx.fillText("Arabian Sea exit", eastLabelX + 24, eastLabelY + 17);

  const selected = state.escorts[state.selectedEscort];
  if (selected) {
    ctx.fillStyle = "rgba(10,20,32,0.75)";
    ctx.fillRect(state.camera.x + 12, state.camera.y + 66, 350, 72);
    ctx.fillStyle = "#dff0ff";
    ctx.fillText(`Selected Destroyer #${state.selectedEscort + 1}`, state.camera.x + 20, state.camera.y + 88);
    ctx.fillText(
      `AA: SAM ${Math.max(0, selected.samReload).toFixed(1)}s | CIWS ${Math.max(0, selected.ciwsReload).toFixed(1)}s | Shield ${state.alliedShieldCharges}`,
      state.camera.x + 20,
      state.camera.y + 109
    );
    ctx.fillText(
      `Upgrades: Pts ${state.upgradePoints} | Fleet T${state.upgrades.fleetTier} | Wpn T${state.upgrades.weaponTier} | DC T${state.upgrades.damageControlTier}`,
      state.camera.x + 20,
      state.camera.y + 128
    );
  }

  if (state.selectedTanker && !state.selectedTanker.sunk) {
    const t = state.selectedTanker;
    ctx.fillStyle = "rgba(10,20,32,0.75)";
    ctx.fillRect(state.camera.x + 370, state.camera.y + 66, 340, 72);
    ctx.fillStyle = "#f3fbff";
    ctx.fillText(`Tanker: ${t.shipClass} ${t.cargo} (${t.loadState})`, state.camera.x + 380, state.camera.y + 88);
    ctx.fillText(`Route: ${t.direction === 1 ? "Kharg → Sea" : "Sea → Kharg"}`, state.camera.x + 380, state.camera.y + 109);
    ctx.fillText("Tap water or U/O to shift lane within corridor", state.camera.x + 380, state.camera.y + 128);
  }
}

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;
  update(dt);
  draw();
  requestAnimationFrame(loop);
}

init();
