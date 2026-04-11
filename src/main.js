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

// Expanded theater: includes northern Gulf approaches (Kharg area) + southern exits
const MAP_BOUNDS = { minLon: 49.6, maxLon: 59.2, minLat: 23.6, maxLat: 30.1 };
const TILE_Z = 7;
const TILE_SIZE = 256;

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

// Long navigable shipping trunk: Kharg approaches -> Strait -> Gulf of Oman exit
const trunkRouteLonLat = [
  [50.20, 29.25],
  [51.10, 29.00],
  [52.30, 28.55],
  [53.35, 28.05],
  [54.30, 27.45],
  [55.10, 26.95],
  [55.70, 26.55],
  [56.30, 26.35],
  [56.95, 26.22],
  [57.60, 26.04],
  [58.25, 25.55],
  [58.85, 24.95]
];
const routePoints = trunkRouteLonLat.map(([lon, lat]) => lonLatToWorld(lon, lat));

const routeSegments = [];
let routeLength = 0;
for (let i = 0; i < routePoints.length - 1; i++) {
  const a = routePoints[i];
  const b = routePoints[i + 1];
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  routeSegments.push({ a, b, len, start: routeLength, end: routeLength + len });
  routeLength += len;
}

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

// Water-rule proxy: ships are constrained to this navigable corridor around route centerline.
const corridorHalfWidth = 46;
function clampToCorridor(point, margin = 6) {
  const n = nearestOnRoute(point);
  const maxOffset = corridorHalfWidth - margin;
  const off = Math.max(-maxOffset, Math.min(maxOffset, n.signedOffset));
  return { x: n.x + n.normal.x * off, y: n.y + n.normal.y * off };
}

const tileCache = new Map();
function getTile(z, x, y) {
  const key = `${z}/${x}/${y}`;
  if (tileCache.has(key)) return tileCache.get(key);
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
  const rec = { img, loaded: false };
  img.onload = () => (rec.loaded = true);
  tileCache.set(key, rec);
  return rec;
}

const state = {
  camera: { x: 0, y: 0, speed: 760 },
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
  spawn: { tankerAt: 1.2, threatAt: 2.5, alliedAt: 16 },
  message: "Status: Running",
  messageTimer: 0,
  ended: false
};

const cargoTypes = [
  { name: "Crude Oil", fireRisk: 1.0, value: 100 },
  { name: "LPG", fireRisk: 1.3, value: 140 },
  { name: "Helium", fireRisk: 0.35, value: 120 },
  { name: "Petrochemicals", fireRisk: 1.2, value: 150 },
  { name: "Urea", fireRisk: 0.55, value: 95 },
  { name: "Containers", fireRisk: 0.5, value: 110 }
];

// Smaller map-relative silhouettes
const tankerSizes = [
  { key: "small", hp: 100, speed: 76, radius: 6 },
  { key: "medium", hp: 160, speed: 67, radius: 8 },
  { key: "large", hp: 235, speed: 58, radius: 11 }
];

function rng(min, max) {
  return Math.random() * (max - min) + min;
}

function pick(arr) {
  return arr[(Math.random() * arr.length) | 0];
}

function init() {
  for (let i = 0; i < 3; i++) spawnEscort(i);
  for (let i = 0; i < 9; i++) spawnTanker(i % 2 === 0 ? 1 : -1);

  state.tollGates = [0.18, 0.42, 0.67, 0.86].map((t) => {
    const p = sampleRoute(t);
    return { x: p.x, y: p.y, radius: 11, cooldown: 0 };
  });

  const start = sampleRoute(0.1);
  state.camera.x = start.x - canvas.width * 0.35;
  state.camera.y = start.y - canvas.height * 0.25;

  bindInput();
  requestAnimationFrame(loop);
}

function spawnEscort(i) {
  const base = sampleRoute(0.08 + i * 0.015);
  const e = {
    kind: "escort",
    x: base.x + base.normal.x * (18 + i * 14),
    y: base.y + base.normal.y * (18 + i * 14),
    vx: 0,
    vy: 0,
    heading: { x: 1, y: 0 },
    hp: 200,
    maxHp: 200,
    radius: 5,
    speed: 162,
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
  const size = pick(tankerSizes);
  const cargo = pick(cargoTypes);
  const full = Math.random() < (direction === 1 ? 0.72 : 0.38);
  const t0 = direction === 1 ? rng(0, 0.04) : rng(0.96, 1);
  const laneOffset = rng(-28, 28);
  const base = sampleRoute(t0);

  state.ships.push({
    kind: "tanker",
    size: size.key,
    cargo: cargo.name,
    cargoValue: full ? cargo.value : Math.round(cargo.value * 0.25),
    fireRisk: full ? cargo.fireRisk : Math.max(0.2, cargo.fireRisk * 0.45),
    loadState: full ? "FULL" : "EMPTY",
    direction,
    routeT: t0,
    laneOffset,
    targetLaneOffset: laneOffset,
    speed: full ? size.speed * 0.92 : size.speed * 1.08,
    boostTimer: 0,
    heading: direction === 1 ? { ...base.tangent } : { x: -base.tangent.x, y: -base.tangent.y },
    hp: size.hp,
    maxHp: size.hp,
    radius: size.radius,
    x: base.x + base.normal.x * laneOffset,
    y: base.y + base.normal.y * laneOffset,
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

    const t = state.selectedTanker;
    if (t && !t.sunk) {
      if (k === "u") t.targetLaneOffset = Math.max(-34, t.targetLaneOffset - 12);
      if (k === "o") t.targetLaneOffset = Math.min(34, t.targetLaneOffset + 12);
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
    state.camera.x -= dx;
    state.camera.y -= dy;
  });

  canvas.addEventListener("pointerup", (e) => {
    if (!state.pointer.moved) handleTap(e.clientX, e.clientY);
    state.pointer.down = false;
  });
}

function screenToWorld(screenX, screenY) {
  return { x: screenX + state.camera.x, y: screenY + state.camera.y - 54 };
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
    state.selectedTanker.targetLaneOffset = Math.max(-34, Math.min(34, n.signedOffset));
    return;
  }

  const esc = state.escorts[state.selectedEscort];
  if (esc) esc.waypoint = clampToCorridor(p, 6);
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

  t.burn = Math.max(0, t.burn - 1.35);
  if (t.burn <= 0.12) t.burning = false;
  state.score += 8;
}

function update(dt) {
  if (state.ended) return;

  state.time += dt;
  state.messageTimer = Math.max(0, state.messageTimer - dt);

  updateCamera(dt);

  if (state.time > state.spawn.tankerAt) {
    spawnTanker(Math.random() < 0.5 ? 1 : -1);
    state.spawn.tankerAt = state.time + rng(2.4, 4.5);
  }
  if (state.time > state.spawn.threatAt) {
    spawnThreat();
    state.spawn.threatAt = state.time + rng(1.0, 2.0);
  }
  if (state.time > state.spawn.alliedAt) {
    spawnAlliedPickup();
    state.spawn.alliedAt = state.time + rng(20, 30);
  }

  updateEscorts(dt);
  updateTankers(dt);
  updateThreats(dt);
  updateWeapons();
  updateProjectiles(dt);
  updateTollGates(dt);
  updateAlliedPickups(dt);

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
  hud.status.textContent = state.messageTimer > 0 ? state.message : `Status: Running (Shield ${state.alliedShieldCharges})`;
}

function updateCamera(dt) {
  const boost = state.keys.has("shift") ? 2.2 : 1;
  if (state.keys.has("arrowleft") || state.keys.has("a")) state.camera.x -= state.camera.speed * boost * dt;
  if (state.keys.has("arrowright") || state.keys.has("d")) state.camera.x += state.camera.speed * boost * dt;
  if (state.keys.has("arrowup") || state.keys.has("w")) state.camera.y -= state.camera.speed * boost * dt;
  if (state.keys.has("arrowdown") || state.keys.has("s")) state.camera.y += state.camera.speed * boost * dt;

  handleGamepad(dt);

  const maxX = Math.max(0, WORLD.width - canvas.width);
  const maxY = Math.max(0, WORLD.height - (canvas.height - 54));
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
    e.x = c.x;
    e.y = c.y;
    const vx = e.x - prev.x;
    const vy = e.y - prev.y;
    const l = Math.hypot(vx, vy);
    if (l > 0.01) e.heading = { x: vx / l, y: vy / l };

    e.samReload -= dt;
    e.ciwsReload -= dt;
  }
}

function updateTankers(dt) {
  for (const t of state.ships) {
    if (t.kind !== "tanker" || t.sunk) continue;

    t.laneOffset += (t.targetLaneOffset - t.laneOffset) * dt * 2;
    const moveBoost = t.boostTimer > 0 ? 1.34 : 1;
    t.boostTimer = Math.max(0, t.boostTimer - dt);
    t.routeT += (t.direction * t.speed * moveBoost * 1.15 * dt) / routeLength;

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

    if (t.routeT > 1.02 || t.routeT < -0.02) {
      t.sunk = true;
      state.delivered += 1;
      state.score += 45 + t.cargoValue;
      if (state.selectedTanker === t) state.selectedTanker = null;
      continue;
    }

    const p = sampleRoute(t.routeT);
    t.x = p.x + p.normal.x * t.laneOffset;
    t.y = p.y + p.normal.y * t.laneOffset;
    t.heading = t.direction === 1 ? { ...p.tangent } : { x: -p.tangent.x, y: -p.tangent.y };
  }
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
      fireProjectile(e.x, e.y, t, 470, 24, "sam");
      e.samReload = 0.9;
    }
    if (d < 150 && e.ciwsReload <= 0) {
      fireProjectile(e.x, e.y, t, 660, 10, "ciws");
      e.ciwsReload = 0.11;
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
  ctx.translate(-state.camera.x, -state.camera.y + 54);

  drawMapTiles();
  drawSeaCorridor();
  drawTollGates();
  drawAlliedPickups();

  for (const s of state.ships) {
    if (s.kind === "tanker" && s.sunk) continue;
    if (s.kind === "escort") drawEscort(s);
    if (s.kind === "tanker") drawTanker(s);
  }
  for (const t of state.threats) drawThreat(t);
  for (const p of state.projectiles) drawProjectile(p);
  drawLabels();

  ctx.restore();

  ctx.fillStyle = "rgba(10,20,32,0.72)";
  ctx.fillRect(8, canvas.height - 26, 340, 18);
  ctx.fillStyle = "#dce8ff";
  ctx.font = "12px Segoe UI";
  ctx.fillText("Map data © OpenStreetMap contributors", 12, canvas.height - 13);
}

function drawMapTiles() {
  const scale = 2 ** TILE_Z;
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

      if (wx + ww < state.camera.x - 30 || wx > state.camera.x + canvas.width + 30) continue;
      if (wy + wh < state.camera.y - 80 || wy > state.camera.y + canvas.height + 80) continue;

      if (rec.loaded) ctx.drawImage(rec.img, wx, wy, ww, wh);
      else {
        ctx.fillStyle = "#19384f";
        ctx.fillRect(wx, wy, ww, wh);
      }
    }
  }
}

function drawSeaCorridor() {
  ctx.strokeStyle = "rgba(75, 170, 255, 0.30)";
  ctx.lineWidth = corridorHalfWidth * 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(routePoints[0].x, routePoints[0].y);
  for (let i = 1; i < routePoints.length; i++) ctx.lineTo(routePoints[i].x, routePoints[i].y);
  ctx.stroke();

  ctx.strokeStyle = "rgba(220,245,255,0.72)";
  ctx.lineWidth = 2;
  ctx.setLineDash([14, 12]);
  ctx.beginPath();
  ctx.moveTo(routePoints[0].x, routePoints[0].y);
  for (let i = 1; i < routePoints.length; i++) ctx.lineTo(routePoints[i].x, routePoints[i].y);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = "rgba(255, 95, 95, 0.1)";
  for (const p of routePoints) {
    ctx.beginPath();
    ctx.arc(p.x, p.y - 130, corridorHalfWidth + 95, 0, Math.PI * 2);
    ctx.fill();
  }
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
  drawShipSprite(e.x, e.y, e.heading, e.radius * 1.9, "#8ed6ff", "#1d2a38");

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
  drawShipSprite(t.x, t.y, t.heading, t.radius * 2.2, colors[t.cargo] || "#d6d6d6", "#2f2d2a");

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
  ctx.fillText(t.loadState, t.x - t.radius, t.y - t.radius - 4);

  if (t.burning) {
    ctx.fillStyle = "rgba(255,130,64,0.92)";
    ctx.beginPath();
    ctx.arc(t.x, t.y - t.radius, 3 + t.burn * 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawShipSprite(x, y, heading, scale, hullColor, outlineColor) {
  const a = Math.atan2(heading.y, heading.x);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);

  ctx.fillStyle = hullColor;
  ctx.strokeStyle = outlineColor;
  ctx.lineWidth = 1;

  ctx.beginPath();
  ctx.moveTo(scale * 1.1, 0);
  ctx.lineTo(scale * 0.35, -scale * 0.45);
  ctx.lineTo(-scale * 1.0, -scale * 0.30);
  ctx.lineTo(-scale * 1.15, 0);
  ctx.lineTo(-scale * 1.0, scale * 0.30);
  ctx.lineTo(scale * 0.35, scale * 0.45);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.fillRect(-scale * 0.2, -scale * 0.12, scale * 0.55, scale * 0.24);

  ctx.restore();
}

function drawThreat(t) {
  ctx.fillStyle = t.kind === "missile" ? "#ff7b66" : "#ffdf68";
  ctx.beginPath();
  ctx.arc(t.x, t.y, t.radius, 0, Math.PI * 2);
  ctx.fill();
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
  ctx.fillStyle = "rgba(10,20,32,0.62)";
  ctx.fillRect(west.x - 108, west.y - 74, 216, 24);
  ctx.fillRect(east.x - 102, east.y - 74, 204, 24);
  ctx.fillStyle = "#eaf2ff";
  ctx.font = "14px Segoe UI";
  ctx.fillText("Kharg / Gulf queue", west.x - 88, west.y - 57);
  ctx.fillText("Arabian Sea exit", east.x - 78, east.y - 57);

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
    ctx.fillText("Drag map or Shift+WASD for fast theater scroll", state.camera.x + 20, state.camera.y + 128);
  }

  if (state.selectedTanker && !state.selectedTanker.sunk) {
    const t = state.selectedTanker;
    ctx.fillStyle = "rgba(10,20,32,0.75)";
    ctx.fillRect(state.camera.x + 370, state.camera.y + 66, 340, 72);
    ctx.fillStyle = "#f3fbff";
    ctx.fillText(`Tanker: ${t.cargo} (${t.loadState})`, state.camera.x + 380, state.camera.y + 88);
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
