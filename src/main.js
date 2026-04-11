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

// Strait of Hormuz approximate map extent
const MAP_BOUNDS = {
  minLon: 55.0,
  maxLon: 57.9,
  minLat: 24.9,
  maxLat: 27.2
};

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

const tileCache = new Map();

function tileKey(z, x, y) {
  return `${z}/${x}/${y}`;
}

function getTile(z, x, y) {
  const key = tileKey(z, x, y);
  if (tileCache.has(key)) return tileCache.get(key);

  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
  const rec = { img, loaded: false, error: false };
  img.onload = () => (rec.loaded = true);
  img.onerror = () => (rec.error = true);
  tileCache.set(key, rec);
  return rec;
}

function lonLatToWorld(lon, lat) {
  const nx = mercatorX(lon);
  const ny = mercatorY(lat);
  return {
    x: ((nx - projBounds.minX) / (projBounds.maxX - projBounds.minX)) * WORLD.width,
    y: ((ny - projBounds.minY) / (projBounds.maxY - projBounds.minY)) * WORLD.height
  };
}

const state = {
  camera: { x: 0, y: 0, speed: 520 },
  keys: new Set(),
  pointer: { down: false, moved: false, x: 0, y: 0, lx: 0, ly: 0 },
  gamepad: { prevButtons: [] },
  time: 0,
  duration: 600,
  score: 0,
  delivered: 0,
  lost: 0,
  priority: "missile",
  selectedEscort: 0,
  ships: [],
  escorts: [],
  threats: [],
  projectiles: [],
  spawn: { tankerAt: 1.2, threatAt: 3.0 },
  ended: false
};

const cargoTypes = [
  { name: "Crude Oil", fireRisk: 1.0, value: 100 },
  { name: "LPG", fireRisk: 1.3, value: 135 },
  { name: "Helium", fireRisk: 0.35, value: 120 },
  { name: "Petrochemicals", fireRisk: 1.2, value: 145 },
  { name: "Urea", fireRisk: 0.55, value: 95 },
  { name: "Containers", fireRisk: 0.45, value: 105 }
];

const tankerSizes = [
  { key: "small", hp: 100, speed: 70, radius: 10 },
  { key: "medium", hp: 160, speed: 61, radius: 14 },
  { key: "large", hp: 230, speed: 52, radius: 18 }
];

const westSpawn = lonLatToWorld(55.25, 26.2);
const eastExit = lonLatToWorld(57.65, 26.2);
const laneYTop = lonLatToWorld(56.2, 26.45).y;
const laneYBottom = lonLatToWorld(56.2, 25.85).y;

function rng(min, max) {
  return Math.random() * (max - min) + min;
}

function pick(arr) {
  return arr[(Math.random() * arr.length) | 0];
}

function init() {
  for (let i = 0; i < 3; i++) spawnEscort(i);
  for (let i = 0; i < 4; i++) {
    spawnTanker();
    const t = state.ships[state.ships.length - 1];
    t.x = westSpawn.x - 200 - i * 90;
  }

  state.camera.x = westSpawn.x - 260;
  state.camera.y = laneYTop - 180;

  bindInput();
  requestAnimationFrame(loop);
}

function spawnEscort(i) {
  const escort = {
    kind: "escort",
    x: westSpawn.x - 110 - i * 35,
    y: laneYTop + 60 + i * 110,
    hp: 190,
    maxHp: 190,
    radius: 11,
    speed: 145,
    waypoint: null,
    samReload: 0,
    ciwsReload: 0,
    manualVx: 0,
    manualVy: 0
  };
  state.escorts.push(escort);
  state.ships.push(escort);
}

function spawnTanker() {
  const size = pick(tankerSizes);
  const cargo = pick(cargoTypes);
  const yLane = rng(laneYTop + 20, laneYBottom - 20);
  const tanker = {
    kind: "tanker",
    size: size.key,
    cargo: cargo.name,
    cargoValue: cargo.value,
    fireRisk: cargo.fireRisk,
    x: westSpawn.x - 60,
    y: yLane,
    hp: size.hp,
    maxHp: size.hp,
    speed: size.speed,
    radius: size.radius,
    burning: false,
    burn: 0,
    sunk: false
  };
  state.ships.push(tanker);
}

function spawnThreat() {
  const aliveTankers = state.ships.filter((s) => s.kind === "tanker" && !s.sunk);
  if (!aliveTankers.length) return;

  const target = pick(aliveTankers);
  const kind = Math.random() < 0.58 ? "drone" : "missile";
  const north = Math.random() < 0.5;

  const threat = {
    kind,
    x: target.x + rng(120, 580),
    y: north ? laneYTop - rng(120, 260) : laneYBottom + rng(120, 260),
    speed: kind === "missile" ? 235 : 160,
    hp: kind === "missile" ? 32 : 18,
    damage: kind === "missile" ? 44 : 19,
    target,
    radius: kind === "missile" ? 4 : 3
  };
  state.threats.push(threat);
}

function bindInput() {
  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    state.keys.add(k);

    if (e.key === "Tab") {
      e.preventDefault();
      state.selectedEscort = (state.selectedEscort + 1) % state.escorts.length;
    }
    if (k === "f") useDamageControl();
    if (["1", "2", "3"].includes(e.key)) {
      state.priority = e.key === "1" ? "missile" : e.key === "2" ? "drone" : "any";
    }
  });

  window.addEventListener("keyup", (e) => {
    state.keys.delete(e.key.toLowerCase());
  });

  canvas.addEventListener("pointerdown", (e) => {
    state.pointer.down = true;
    state.pointer.moved = false;
    state.pointer.x = state.pointer.lx = e.clientX;
    state.pointer.y = state.pointer.ly = e.clientY;
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
  return {
    x: screenX + state.camera.x,
    y: screenY + state.camera.y - 54
  };
}

function handleTap(screenX, screenY) {
  const p = screenToWorld(screenX, screenY);

  let hitEscort = -1;
  state.escorts.forEach((esc, i) => {
    if (Math.hypot(esc.x - p.x, esc.y - p.y) < esc.radius + 10) hitEscort = i;
  });
  if (hitEscort >= 0) {
    state.selectedEscort = hitEscort;
    return;
  }

  const burning = state.ships.find(
    (s) => s.kind === "tanker" && s.burning && !s.sunk && Math.hypot(s.x - p.x, s.y - p.y) < s.radius + 12
  );
  if (burning) {
    useDamageControl(burning);
    return;
  }

  // set waypoint for selected escort
  const esc = state.escorts[state.selectedEscort];
  if (!esc) return;
  esc.waypoint = clampToWaterLane(p.x, p.y);
}

function clampToWaterLane(x, y) {
  const lanePadding = 8;
  return {
    x: Math.max(0, Math.min(WORLD.width, x)),
    y: Math.max(laneYTop + lanePadding, Math.min(laneYBottom - lanePadding, y))
  };
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

  target.burn = Math.max(0, target.burn - 1.3);
  if (target.burn <= 0.15) target.burning = false;
  state.score += 8;
}

function update(dt) {
  if (state.ended) return;
  state.time += dt;

  updateCamera(dt);

  if (state.time > state.spawn.tankerAt) {
    spawnTanker();
    state.spawn.tankerAt = state.time + rng(2.8, 4.6);
  }
  if (state.time > state.spawn.threatAt) {
    spawnThreat();
    state.spawn.threatAt = state.time + rng(1.1, 2.1);
  }

  updateEscorts(dt);
  updateTankers(dt);
  updateThreats(dt);
  updateProjectiles(dt);
  updateWeapons(dt);

  if (state.time >= state.duration) {
    state.ended = true;
    hud.status.textContent = state.delivered >= 14 ? "Status: Victory" : "Status: Defeat";
  }

  const burningCount = state.ships.filter((s) => s.kind === "tanker" && s.burning && !s.sunk).length;
  hud.timer.textContent = `Time: ${Math.max(0, Math.ceil(state.duration - state.time))}`;
  hud.score.textContent = `Score: ${Math.round(state.score)}`;
  hud.delivered.textContent = `Delivered: ${state.delivered}`;
  hud.lost.textContent = `Lost: ${state.lost}`;
  hud.burning.textContent = `Burning: ${burningCount}`;
}

function updateCamera(dt) {
  const cam = state.camera;
  if (state.keys.has("arrowleft") || state.keys.has("a")) cam.x -= cam.speed * dt;
  if (state.keys.has("arrowright") || state.keys.has("d")) cam.x += cam.speed * dt;
  if (state.keys.has("arrowup") || state.keys.has("w")) cam.y -= cam.speed * dt;
  if (state.keys.has("arrowdown") || state.keys.has("s")) cam.y += cam.speed * dt;

  handleGamepad(dt);

  cam.x = Math.max(-40, Math.min(WORLD.width - canvas.width + 40, cam.x));
  cam.y = Math.max(-50, Math.min(WORLD.height - canvas.height + 120, cam.y));
}

function updateEscorts(dt) {
  const esc = state.escorts[state.selectedEscort];
  if (esc) {
    const steer = { x: 0, y: 0 };
    if (state.keys.has("j")) steer.x -= 1;
    if (state.keys.has("l")) steer.x += 1;
    if (state.keys.has("i")) steer.y -= 1;
    if (state.keys.has("k")) steer.y += 1;

    if (steer.x || steer.y) {
      const mag = Math.hypot(steer.x, steer.y) || 1;
      esc.manualVx = (steer.x / mag) * esc.speed;
      esc.manualVy = (steer.y / mag) * esc.speed;
      esc.waypoint = null;
    } else {
      esc.manualVx *= 0.85;
      esc.manualVy *= 0.85;
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
      if (d < 6) {
        e.waypoint = null;
      } else {
        const boost = 1.25; // exaggerated gameplay speed
        e.x += (dx / d) * e.speed * boost * dt;
        e.y += (dy / d) * e.speed * boost * dt;
      }
    }

    const clamped = clampToWaterLane(e.x, e.y);
    e.x = clamped.x;
    e.y = clamped.y;
    e.samReload -= dt;
    e.ciwsReload -= dt;
  }
}

function updateTankers(dt) {
  for (const s of state.ships) {
    if (s.kind !== "tanker" || s.sunk) continue;

    s.x += s.speed * dt * 1.08; // exaggerated gameplay speed

    if (s.burning) {
      s.burn += dt * 0.36;
      s.hp -= (4 + s.burn * 3.2) * dt;
    }

    if (s.hp <= 0 || s.burn > 4.8) {
      s.sunk = true;
      state.lost += 1;
      state.score -= 120;
      continue;
    }

    if (s.x >= eastExit.x + 40) {
      s.sunk = true;
      state.delivered += 1;
      state.score += 50 + s.cargoValue;
    }
  }
}

function updateThreats(dt) {
  for (const t of state.threats) {
    const target = t.target;
    if (!target || target.sunk) {
      t.hp = -1;
      continue;
    }

    const dx = target.x - t.x;
    const dy = target.y - t.y;
    const d = Math.hypot(dx, dy) || 0.001;
    t.x += (dx / d) * t.speed * dt;
    t.y += (dy / d) * t.speed * dt;

    if (d < target.radius + 8) {
      target.hp -= t.damage;
      if (!target.burning && Math.random() < 0.45 * target.fireRisk) {
        target.burning = true;
        target.burn = Math.max(target.burn, 0.2);
      }
      t.hp = -1;
    }
  }

  state.threats = state.threats.filter((t) => t.hp > 0);
}

function updateWeapons(dt) {
  for (const esc of state.escorts) {
    let targets = state.threats.filter((t) => Math.hypot(t.x - esc.x, t.y - esc.y) < 460);
    if (!targets.length) continue;

    if (state.priority !== "any") {
      const preferred = targets.filter((t) => t.kind === state.priority);
      if (preferred.length) targets = preferred;
    }

    targets.sort((a, b) => Math.hypot(a.x - esc.x, a.y - esc.y) - Math.hypot(b.x - esc.x, b.y - esc.y));
    const nearest = targets[0];
    const d = Math.hypot(nearest.x - esc.x, nearest.y - esc.y);

    // SAM: long range, slower rate, high damage
    if (d < 460 && esc.samReload <= 0) {
      fireProjectile(esc.x, esc.y, nearest, 440, 24, "sam");
      esc.samReload = 0.9;
    }

    // CIWS: close range, rapid fire, lower damage
    if (d < 165 && esc.ciwsReload <= 0) {
      fireProjectile(esc.x, esc.y, nearest, 620, 10, "ciws");
      esc.ciwsReload = 0.12;
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

    if (d < p.target.radius + 5) {
      p.target.hp -= p.damage;
      p.life = -1;
      state.score += p.kind === "sam" ? 4 : 2;
      if (p.target.hp <= 0) {
        state.score += p.target.kind === "missile" ? 14 : 8;
      }
    }
  }
  state.projectiles = state.projectiles.filter((p) => p.life > 0);
  state.threats = state.threats.filter((t) => t.hp > 0);
}

function handleGamepad(dt) {
  const gp = navigator.getGamepads ? navigator.getGamepads()[0] : null;
  if (!gp) return;

  const dead = (v) => (Math.abs(v) < 0.16 ? 0 : v);

  state.camera.x += dead(gp.axes[0] || 0) * 460 * dt;
  state.camera.y += dead(gp.axes[1] || 0) * 460 * dt;

  const pressed = (i) => gp.buttons[i] && gp.buttons[i].pressed;
  const tap = (i) => pressed(i) && !state.gamepad.prevButtons[i];

  if (tap(4)) state.selectedEscort = (state.selectedEscort - 1 + state.escorts.length) % state.escorts.length; // LB
  if (tap(5)) state.selectedEscort = (state.selectedEscort + 1) % state.escorts.length; // RB
  if (tap(0)) useDamageControl(); // A

  if (tap(12)) state.priority = "missile"; // dpad up
  if (tap(13)) state.priority = "drone"; // dpad down
  if (tap(15)) state.priority = "any"; // dpad right

  if (tap(2)) {
    // X/Square: set waypoint at center screen
    const center = screenToWorld(canvas.width * 0.5, canvas.height * 0.5);
    const esc = state.escorts[state.selectedEscort];
    if (esc) esc.waypoint = clampToWaterLane(center.x, center.y);
  }

  // dpad steering for selected escort
  const esc = state.escorts[state.selectedEscort];
  if (esc) {
    let steerX = 0;
    let steerY = 0;
    if (pressed(14)) steerX -= 1;
    if (pressed(15)) steerX += 1;
    if (pressed(12)) steerY -= 1;
    if (pressed(13)) steerY += 1;
    if (steerX || steerY) {
      const mag = Math.hypot(steerX, steerY) || 1;
      esc.manualVx = (steerX / mag) * esc.speed;
      esc.manualVy = (steerY / mag) * esc.speed;
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
  drawLanesAndZones();

  for (const s of state.ships) {
    if (s.kind === "tanker" && s.sunk) continue;
    if (s.kind === "escort") drawEscort(s);
    if (s.kind === "tanker") drawTanker(s);
  }
  for (const t of state.threats) drawThreat(t);
  for (const p of state.projectiles) drawProjectile(p);

  drawLabels();

  ctx.restore();

  // OSM attribution requirement
  ctx.fillStyle = "rgba(10, 20, 32, 0.72)";
  ctx.fillRect(8, canvas.height - 26, 340, 18);
  ctx.fillStyle = "#dce8ff";
  ctx.font = "12px Segoe UI";
  ctx.fillText("Map data © OpenStreetMap contributors", 12, canvas.height - 13);
}

function drawMapTiles() {
  const scale = 2 ** TILE_Z;
  const xTileMin = Math.floor(projBounds.minX * scale);
  const yTileMin = Math.floor(projBounds.minY * scale);
  const xTileMax = Math.ceil(projBounds.maxX * scale);
  const yTileMax = Math.ceil(projBounds.maxY * scale);

  for (let tx = xTileMin; tx <= xTileMax; tx++) {
    for (let ty = yTileMin; ty <= yTileMax; ty++) {
      const rec = getTile(TILE_Z, tx, ty);
      const tileNX = tx / scale;
      const tileNY = ty / scale;
      const wx = ((tileNX - projBounds.minX) / (projBounds.maxX - projBounds.minX)) * WORLD.width;
      const wy = ((tileNY - projBounds.minY) / (projBounds.maxY - projBounds.minY)) * WORLD.height;
      const ww = (1 / scale / (projBounds.maxX - projBounds.minX)) * WORLD.width;
      const wh = (1 / scale / (projBounds.maxY - projBounds.minY)) * WORLD.height;

      if (wx + ww < state.camera.x - 30 || wx > state.camera.x + canvas.width + 30) continue;
      if (wy + wh < state.camera.y - 80 || wy > state.camera.y + canvas.height + 80) continue;

      if (rec.loaded) {
        ctx.drawImage(rec.img, wx, wy, ww, wh);
      } else {
        ctx.fillStyle = "#1a3550";
        ctx.fillRect(wx, wy, ww, wh);
      }
    }
  }
}

function drawLanesAndZones() {
  ctx.fillStyle = "rgba(74, 169, 255, 0.18)";
  ctx.fillRect(0, laneYTop, WORLD.width, laneYBottom - laneYTop);

  ctx.strokeStyle = "rgba(190,230,255,0.5)";
  ctx.lineWidth = 2;
  ctx.setLineDash([16, 12]);
  ctx.beginPath();
  ctx.moveTo(0, (laneYTop + laneYBottom) * 0.5);
  ctx.lineTo(WORLD.width, (laneYTop + laneYBottom) * 0.5);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = "rgba(255, 94, 94, 0.12)";
  ctx.fillRect(0, 0, WORLD.width, laneYTop - 10);
  ctx.fillRect(0, laneYBottom + 10, WORLD.width, WORLD.height - laneYBottom);
}

function drawEscort(s) {
  ctx.fillStyle = "#7bd2ff";
  ctx.beginPath();
  ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
  ctx.fill();

  if (state.escorts[state.selectedEscort] === s) {
    ctx.strokeStyle = "#f5ff6a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.radius + 6, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (s.waypoint) {
    ctx.strokeStyle = "rgba(170,255,200,0.75)";
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(s.waypoint.x, s.waypoint.y);
    ctx.stroke();
    ctx.fillStyle = "#a9ffd0";
    ctx.fillRect(s.waypoint.x - 3, s.waypoint.y - 3, 6, 6);
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

  ctx.fillStyle = "rgba(0,0,0,0.32)";
  ctx.fillRect(t.x - t.radius * 1.55, t.y + t.radius + 6, t.radius * 3.1, 5);
  ctx.fillStyle = "#72e497";
  ctx.fillRect(t.x - t.radius * 1.55, t.y + t.radius + 6, Math.max(0, (t.hp / t.maxHp) * t.radius * 3.1), 5);

  if (t.burning) {
    ctx.fillStyle = "rgba(255,130,64,0.92)";
    ctx.beginPath();
    ctx.arc(t.x, t.y - t.radius, 4 + t.burn * 3.6, 0, Math.PI * 2);
    ctx.fill();
  }
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
  ctx.arc(p.x, p.y, p.kind === "sam" ? 2.8 : 1.8, 0, Math.PI * 2);
  ctx.fill();
}

function drawLabels() {
  ctx.fillStyle = "rgba(10,20,32,0.58)";
  ctx.fillRect(westSpawn.x - 8, laneYTop - 44, 170, 24);
  ctx.fillRect(eastExit.x - 20, laneYTop - 44, 150, 24);

  ctx.fillStyle = "#eaf2ff";
  ctx.font = "14px Segoe UI";
  ctx.fillText("West traffic queue", westSpawn.x, laneYTop - 27);
  ctx.fillText("East terminal", eastExit.x, laneYTop - 27);

  const selected = state.escorts[state.selectedEscort];
  if (selected) {
    ctx.fillStyle = "rgba(10,20,32,0.75)";
    ctx.fillRect(state.camera.x + 12, state.camera.y + 66, 260, 58);
    ctx.fillStyle = "#dff0ff";
    ctx.fillText(`Selected Destroyer #${state.selectedEscort + 1}`, state.camera.x + 20, state.camera.y + 88);
    ctx.fillText(
      `AA: SAM ${Math.max(0, selected.samReload).toFixed(1)}s | CIWS ${Math.max(0, selected.ciwsReload).toFixed(1)}s`,
      state.camera.x + 20,
      state.camera.y + 109
    );
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
