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

const MAP_BOUNDS = { minLon: 55.0, maxLon: 57.9, minLat: 24.9, maxLat: 27.2 };
const TILE_Z = 8;
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

const straitRouteLonLat = [
  [55.25, 26.18],
  [55.55, 26.10],
  [55.95, 26.03],
  [56.30, 26.13],
  [56.62, 26.24],
  [56.92, 26.16],
  [57.25, 26.08],
  [57.62, 26.18]
];
const routePoints = straitRouteLonLat.map(([lon, lat]) => lonLatToWorld(lon, lat));

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
  const tlen = Math.hypot(tx, ty) || 1;
  const ux = tx / tlen;
  const uy = ty / tlen;
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
      const segTangentLen = Math.hypot(vx, vy) || 1;
      const tx = vx / segTangentLen;
      const ty = vy / segTangentLen;
      const nx = -ty;
      const ny = tx;
      const along = seg.start + seg.len * u;
      best = {
        x: px,
        y: py,
        dist,
        routeT: along / routeLength,
        tangent: { x: tx, y: ty },
        normal: { x: nx, y: ny },
        signedOffset: dx * nx + dy * ny
      };
    }
  }

  return best;
}

const corridorHalfWidth = 74;

function clampToCorridor(point, margin = 10) {
  const n = nearestOnRoute(point);
  const maxOffset = corridorHalfWidth - margin;
  const offset = Math.max(-maxOffset, Math.min(maxOffset, n.signedOffset));
  return {
    x: n.x + n.normal.x * offset,
    y: n.y + n.normal.y * offset
  };
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
  camera: { x: 0, y: 0, speed: 660 },
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
  spawn: { tankerAt: 1.3, threatAt: 2.8 },
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

const tankerSizes = [
  { key: "small", hp: 100, speed: 72, radius: 10 },
  { key: "medium", hp: 160, speed: 64, radius: 14 },
  { key: "large", hp: 235, speed: 54, radius: 18 }
];

function rng(min, max) {
  return Math.random() * (max - min) + min;
}

function pick(arr) {
  return arr[(Math.random() * arr.length) | 0];
}

function init() {
  for (let i = 0; i < 3; i++) spawnEscort(i);
  for (let i = 0; i < 7; i++) spawnTanker(i % 2 === 0 ? 1 : -1);

  state.tollGates = [0.22, 0.49, 0.76].map((t) => {
    const p = sampleRoute(t);
    return { t, x: p.x, y: p.y, cooldown: 0, radius: 15 };
  });

  const first = sampleRoute(0.08);
  state.camera.x = first.x - 260;
  state.camera.y = first.y - 200;

  bindInput();
  requestAnimationFrame(loop);
}

function spawnEscort(i) {
  const base = sampleRoute(0.06 + i * 0.02);
  const escort = {
    kind: "escort",
    x: base.x + base.normal.x * (30 + i * 22),
    y: base.y + base.normal.y * (30 + i * 22),
    hp: 200,
    maxHp: 200,
    radius: 11,
    speed: 152,
    waypoint: null,
    samReload: 0,
    ciwsReload: 0,
    manualVx: 0,
    manualVy: 0
  };
  state.escorts.push(escort);
  state.ships.push(escort);
}

function spawnTanker(direction = Math.random() < 0.5 ? 1 : -1) {
  const size = pick(tankerSizes);
  const cargo = pick(cargoTypes);
  const full = Math.random() < (direction === 1 ? 0.72 : 0.4);
  const startT = direction === 1 ? rng(0, 0.05) : rng(0.95, 1);
  const laneOffset = rng(-45, 45);
  const base = sampleRoute(startT);
  const tanker = {
    kind: "tanker",
    size: size.key,
    cargo: cargo.name,
    cargoValue: full ? cargo.value : Math.round(cargo.value * 0.25),
    fireRisk: full ? cargo.fireRisk : Math.max(0.2, cargo.fireRisk * 0.45),
    loadState: full ? "FULL" : "EMPTY",
    direction,
    routeT: startT,
    laneOffset,
    targetLaneOffset: laneOffset,
    speed: full ? size.speed * 0.93 : size.speed * 1.08,
    boostTimer: 0,
    hp: size.hp,
    maxHp: size.hp,
    radius: size.radius,
    x: base.x + base.normal.x * laneOffset,
    y: base.y + base.normal.y * laneOffset,
    burning: false,
    burn: 0,
    sunk: false
  };
  state.ships.push(tanker);
}

function spawnThreat() {
  const alive = state.ships.filter((s) => s.kind === "tanker" && !s.sunk);
  if (!alive.length) return;

  const target = pick(alive);
  const kind = Math.random() < 0.57 ? "drone" : "missile";
  const center = sampleRoute(target.routeT);
  const side = Math.random() < 0.5 ? -1 : 1;

  const threat = {
    kind,
    x: center.x + center.normal.x * (corridorHalfWidth + rng(100, 260) * side),
    y: center.y + center.normal.y * (corridorHalfWidth + rng(100, 260) * side),
    speed: kind === "missile" ? 240 : 165,
    hp: kind === "missile" ? 34 : 18,
    damage: kind === "missile" ? 44 : 20,
    target,
    radius: kind === "missile" ? 4 : 3
  };
  state.threats.push(threat);
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
    if (["1", "2", "3"].includes(e.key)) {
      state.priority = e.key === "1" ? "missile" : e.key === "2" ? "drone" : "any";
    }
    const selT = state.selectedTanker;
    if (selT && selT.kind === "tanker" && !selT.sunk) {
      if (k === "u") selT.targetLaneOffset = Math.max(-58, selT.targetLaneOffset - 18);
      if (k === "o") selT.targetLaneOffset = Math.min(58, selT.targetLaneOffset + 18);
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

  let hitEscort = null;
  for (let i = 0; i < state.escorts.length; i++) {
    const e = state.escorts[i];
    if (Math.hypot(e.x - p.x, e.y - p.y) < e.radius + 10) {
      hitEscort = i;
      break;
    }
  }
  if (hitEscort !== null) {
    state.selectedEscort = hitEscort;
    state.selectedTanker = null;
    return;
  }

  const hitTanker = state.ships.find(
    (s) => s.kind === "tanker" && !s.sunk && Math.hypot(s.x - p.x, s.y - p.y) < s.radius + 10
  );
  if (hitTanker) {
    state.selectedTanker = hitTanker;
    return;
  }

  const burning = state.ships.find(
    (s) => s.kind === "tanker" && s.burning && !s.sunk && Math.hypot(s.x - p.x, s.y - p.y) < s.radius + 12
  );
  if (burning) {
    useDamageControl(burning);
    return;
  }

  if (state.selectedTanker && !state.selectedTanker.sunk) {
    const nearest = nearestOnRoute(p);
    const offset = Math.max(-58, Math.min(58, nearest.signedOffset));
    state.selectedTanker.targetLaneOffset = offset;
    return;
  }

  const esc = state.escorts[state.selectedEscort];
  if (!esc) return;
  esc.waypoint = clampToCorridor(p, 12);
}

function useDamageControl(forcedTarget = null) {
  const escort = state.escorts[state.selectedEscort];
  if (!escort) return;
  const candidates = state.ships
    .filter((s) => s.kind === "tanker" && s.burning && !s.sunk)
    .sort((a, b) => Math.hypot(a.x - escort.x, a.y - escort.y) - Math.hypot(b.x - escort.x, b.y - escort.y));
  const target = forcedTarget || candidates[0];
  if (!target) return;

  const d = Math.hypot(target.x - escort.x, target.y - escort.y);
  if (d > 240) return;

  target.burn = Math.max(0, target.burn - 1.35);
  if (target.burn <= 0.12) target.burning = false;
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
    state.spawn.threatAt = state.time + rng(1.05, 2.1);
  }

  updateEscorts(dt);
  updateTankers(dt);
  updateThreats(dt);
  updateWeapons();
  updateProjectiles(dt);
  updateTollGates(dt);

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
  hud.status.textContent = state.messageTimer > 0 ? state.message : `Status: ${state.ended ? "Ended" : "Running"}`;
}

function updateCamera(dt) {
  const cam = state.camera;
  const boost = state.keys.has("shift") ? 2.1 : 1;
  if (state.keys.has("arrowleft") || state.keys.has("a")) cam.x -= cam.speed * boost * dt;
  if (state.keys.has("arrowright") || state.keys.has("d")) cam.x += cam.speed * boost * dt;
  if (state.keys.has("arrowup") || state.keys.has("w")) cam.y -= cam.speed * boost * dt;
  if (state.keys.has("arrowdown") || state.keys.has("s")) cam.y += cam.speed * boost * dt;

  handleGamepad(dt);

  const maxX = Math.max(0, WORLD.width - canvas.width);
  const maxY = Math.max(0, WORLD.height - (canvas.height - 54));
  cam.x = Math.max(-80, Math.min(maxX + 80, cam.x));
  cam.y = Math.max(-80, Math.min(maxY + 120, cam.y));
}

function updateEscorts(dt) {
  const selectedEscort = state.escorts[state.selectedEscort];
  if (selectedEscort) {
    const steer = { x: 0, y: 0 };
    if (state.keys.has("j")) steer.x -= 1;
    if (state.keys.has("l")) steer.x += 1;
    if (state.keys.has("i")) steer.y -= 1;
    if (state.keys.has("k")) steer.y += 1;

    if (steer.x || steer.y) {
      const mag = Math.hypot(steer.x, steer.y) || 1;
      selectedEscort.manualVx = (steer.x / mag) * selectedEscort.speed;
      selectedEscort.manualVy = (steer.y / mag) * selectedEscort.speed;
      selectedEscort.waypoint = null;
    } else {
      selectedEscort.manualVx *= 0.86;
      selectedEscort.manualVy *= 0.86;
    }
  }

  for (const e of state.escorts) {
    if (Math.hypot(e.manualVx, e.manualVy) > 2) {
      e.x += e.manualVx * dt;
      e.y += e.manualVy * dt;
    } else if (e.waypoint) {
      const dx = e.waypoint.x - e.x;
      const dy = e.waypoint.y - e.y;
      const d = Math.hypot(dx, dy);
      if (d < 6) e.waypoint = null;
      else {
        e.x += (dx / d) * e.speed * 1.25 * dt;
        e.y += (dy / d) * e.speed * 1.25 * dt;
      }
    }
    const c = clampToCorridor({ x: e.x, y: e.y }, 8);
    e.x = c.x;
    e.y = c.y;
    e.samReload -= dt;
    e.ciwsReload -= dt;
  }
}

function updateTankers(dt) {
  for (const t of state.ships) {
    if (t.kind !== "tanker" || t.sunk) continue;

    t.laneOffset += (t.targetLaneOffset - t.laneOffset) * dt * 2;
    const moveBoost = t.boostTimer > 0 ? 1.35 : 1;
    t.boostTimer = Math.max(0, t.boostTimer - dt);
    t.routeT += (t.direction * t.speed * moveBoost * 1.14 * dt) / routeLength;

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

    const outOfBounds = t.routeT > 1.02 || t.routeT < -0.02;
    if (outOfBounds) {
      t.sunk = true;
      state.delivered += 1;
      state.score += 45 + t.cargoValue;
      if (state.selectedTanker === t) state.selectedTanker = null;
      continue;
    }

    const p = sampleRoute(t.routeT);
    t.x = p.x + p.normal.x * t.laneOffset;
    t.y = p.y + p.normal.y * t.laneOffset;
  }
}

function updateThreats(dt) {
  for (const th of state.threats) {
    if (!th.target || th.target.sunk) {
      th.hp = -1;
      continue;
    }
    const dx = th.target.x - th.x;
    const dy = th.target.y - th.y;
    const d = Math.hypot(dx, dy) || 0.001;
    th.x += (dx / d) * th.speed * dt;
    th.y += (dy / d) * th.speed * dt;
    if (d < th.target.radius + 8) {
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
  for (const esc of state.escorts) {
    let targets = state.threats.filter((t) => Math.hypot(t.x - esc.x, t.y - esc.y) < 480);
    if (!targets.length) continue;

    if (state.priority !== "any") {
      const pref = targets.filter((t) => t.kind === state.priority);
      if (pref.length) targets = pref;
    }

    targets.sort((a, b) => Math.hypot(a.x - esc.x, a.y - esc.y) - Math.hypot(b.x - esc.x, b.y - esc.y));
    const target = targets[0];
    const d = Math.hypot(target.x - esc.x, target.y - esc.y);

    if (d < 480 && esc.samReload <= 0) {
      fireProjectile(esc.x, esc.y, target, 460, 24, "sam");
      esc.samReload = 0.9;
    }
    if (d < 170 && esc.ciwsReload <= 0) {
      fireProjectile(esc.x, esc.y, target, 650, 10, "ciws");
      esc.ciwsReload = 0.11;
    }
  }
}

function fireProjectile(x, y, target, speed, damage, kind) {
  state.projectiles.push({ x, y, target, speed, damage, kind, life: 1.7 });
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
    if (d < p.target.radius + 5) {
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
    for (const t of state.ships) {
      if (t.kind !== "tanker" || t.sunk) continue;
      const d = Math.hypot(t.x - gate.x, t.y - gate.y);
      if (d < gate.radius + t.radius && gate.cooldown <= 0) {
        gate.cooldown = 16;
        t.boostTimer = Math.max(t.boostTimer, 7);
        const payout = t.loadState === "FULL" ? 36 : 20;
        state.score += payout;
        state.message = `Status: Toll paid +${payout} (speed boost)`;
        state.messageTimer = 1.8;
      }
    }
  }
}

function handleGamepad(dt) {
  const gp = navigator.getGamepads ? navigator.getGamepads()[0] : null;
  if (!gp) return;
  const dead = (v) => (Math.abs(v) < 0.16 ? 0 : v);

  state.camera.x += dead(gp.axes[0] || 0) * 480 * dt;
  state.camera.y += dead(gp.axes[1] || 0) * 480 * dt;

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
    const esc = state.escorts[state.selectedEscort];
    if (esc) esc.waypoint = clampToCorridor(center, 10);
  }

  const esc = state.escorts[state.selectedEscort];
  if (esc) {
    let sx = 0;
    let sy = 0;
    if (pressed(14)) sx -= 1;
    if (pressed(15)) sx += 1;
    if (pressed(12)) sy -= 1;
    if (pressed(13)) sy += 1;
    if (sx || sy) {
      const mag = Math.hypot(sx, sy) || 1;
      esc.manualVx = (sx / mag) * esc.speed;
      esc.manualVy = (sy / mag) * esc.speed;
      esc.waypoint = null;
    }
  }

  state.gamepad.prevButtons = gp.buttons.map((b) => b.pressed);
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(-state.camera.x, -state.camera.y + 54);

  drawMapTiles();
  drawRouteAndCorridor();
  drawTollGates();

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

function drawRouteAndCorridor() {
  // corridor envelope
  ctx.strokeStyle = "rgba(80, 176, 255, 0.32)";
  ctx.lineWidth = corridorHalfWidth * 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(routePoints[0].x, routePoints[0].y);
  for (let i = 1; i < routePoints.length; i++) ctx.lineTo(routePoints[i].x, routePoints[i].y);
  ctx.stroke();

  // center line
  ctx.strokeStyle = "rgba(214, 243, 255, 0.7)";
  ctx.lineWidth = 2;
  ctx.setLineDash([14, 11]);
  ctx.beginPath();
  ctx.moveTo(routePoints[0].x, routePoints[0].y);
  for (let i = 1; i < routePoints.length; i++) ctx.lineTo(routePoints[i].x, routePoints[i].y);
  ctx.stroke();
  ctx.setLineDash([]);

  // threat zones outside corridor
  ctx.fillStyle = "rgba(255, 95, 95, 0.1)";
  for (const p of routePoints) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, corridorHalfWidth + 120, 0, Math.PI * 2);
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
    ctx.strokeStyle = "rgba(20,20,20,0.55)";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = "#0d1929";
    ctx.font = "11px Segoe UI";
    ctx.fillText("TOLL", gate.x - 14, gate.y + 4);
  }
}

function drawEscort(e) {
  ctx.fillStyle = "#7bd2ff";
  ctx.beginPath();
  ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2);
  ctx.fill();
  if (state.escorts[state.selectedEscort] === e) {
    ctx.strokeStyle = "#f5ff6a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.radius + 6, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (e.waypoint) {
    ctx.strokeStyle = "rgba(170,255,200,0.8)";
    ctx.beginPath();
    ctx.moveTo(e.x, e.y);
    ctx.lineTo(e.waypoint.x, e.waypoint.y);
    ctx.stroke();
    ctx.fillStyle = "#a9ffd0";
    ctx.fillRect(e.waypoint.x - 3, e.waypoint.y - 3, 6, 6);
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
  ctx.fillStyle = colors[t.cargo] || "#d6d6d6";
  ctx.fillRect(t.x - t.radius * 1.55, t.y - t.radius * 0.85, t.radius * 3.1, t.radius * 1.7);

  if (state.selectedTanker === t) {
    ctx.strokeStyle = "#ffe66a";
    ctx.lineWidth = 2;
    ctx.strokeRect(t.x - t.radius * 1.65, t.y - t.radius * 0.95, t.radius * 3.3, t.radius * 1.9);
  }

  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(t.x - t.radius * 1.55, t.y + t.radius + 6, t.radius * 3.1, 5);
  ctx.fillStyle = "#72e497";
  ctx.fillRect(t.x - t.radius * 1.55, t.y + t.radius + 6, Math.max(0, (t.hp / t.maxHp) * t.radius * 3.1), 5);

  ctx.fillStyle = t.loadState === "FULL" ? "#ffd88e" : "#d7e6f2";
  ctx.font = "10px Segoe UI";
  ctx.fillText(t.loadState, t.x - t.radius * 1.2, t.y - t.radius - 4);

  if (t.burning) {
    ctx.fillStyle = "rgba(255,130,64,0.92)";
    ctx.beginPath();
    ctx.arc(t.x, t.y - t.radius, 4 + t.burn * 3.6, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawThreat(th) {
  ctx.fillStyle = th.kind === "missile" ? "#ff7b66" : "#ffdf68";
  ctx.beginPath();
  ctx.arc(th.x, th.y, th.radius, 0, Math.PI * 2);
  ctx.fill();
}

function drawProjectile(p) {
  ctx.fillStyle = p.kind === "sam" ? "#6ef9ff" : "#ffffff";
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.kind === "sam" ? 2.8 : 1.8, 0, Math.PI * 2);
  ctx.fill();
}

function drawLabels() {
  const west = sampleRoute(0.02);
  const east = sampleRoute(0.98);
  ctx.fillStyle = "rgba(10,20,32,0.58)";
  ctx.fillRect(west.x - 84, west.y - 78, 170, 24);
  ctx.fillRect(east.x - 84, east.y - 78, 170, 24);
  ctx.fillStyle = "#eaf2ff";
  ctx.font = "14px Segoe UI";
  ctx.fillText("West traffic queue", west.x - 76, west.y - 61);
  ctx.fillText("East terminal", east.x - 67, east.y - 61);

  const selected = state.escorts[state.selectedEscort];
  if (selected) {
    ctx.fillStyle = "rgba(10,20,32,0.75)";
    ctx.fillRect(state.camera.x + 12, state.camera.y + 66, 300, 72);
    ctx.fillStyle = "#dff0ff";
    ctx.fillText(`Selected Destroyer #${state.selectedEscort + 1}`, state.camera.x + 20, state.camera.y + 88);
    ctx.fillText(
      `AA: SAM ${Math.max(0, selected.samReload).toFixed(1)}s | CIWS ${Math.max(0, selected.ciwsReload).toFixed(1)}s`,
      state.camera.x + 20,
      state.camera.y + 109
    );
    ctx.fillText("Drag map / Shift+WASD fast pan", state.camera.x + 20, state.camera.y + 128);
  }

  if (state.selectedTanker && !state.selectedTanker.sunk) {
    const t = state.selectedTanker;
    ctx.fillStyle = "rgba(10,20,32,0.75)";
    ctx.fillRect(state.camera.x + 320, state.camera.y + 66, 310, 72);
    ctx.fillStyle = "#f3fbff";
    ctx.fillText(`Selected Tanker: ${t.cargo} (${t.loadState})`, state.camera.x + 328, state.camera.y + 88);
    ctx.fillText(`Route: ${t.direction === 1 ? "West → East" : "East → West"}`, state.camera.x + 328, state.camera.y + 109);
    ctx.fillText("Tap water or U/O to shift lane", state.camera.x + 328, state.camera.y + 128);
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
