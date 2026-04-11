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

const WORLD = { width: 4200, height: 1800 };
const state = {
  camera: { x: 0, y: 0, speed: 620 },
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
  spawn: { tankerAt: 0, threatAt: 2 },
  ended: false
};

const cargoTypes = [
  { name: "Crude Oil", fireRisk: 1.0, value: 100 },
  { name: "LPG", fireRisk: 1.3, value: 130 },
  { name: "Helium", fireRisk: 0.4, value: 115 },
  { name: "Petrochemicals", fireRisk: 1.2, value: 140 },
  { name: "Urea", fireRisk: 0.6, value: 90 },
  { name: "Containers", fireRisk: 0.5, value: 95 }
];

const tankerSizes = [
  { key: "small", hp: 100, speed: 62, radius: 12 },
  { key: "medium", hp: 150, speed: 54, radius: 16 },
  { key: "large", hp: 220, speed: 44, radius: 21 }
];

function rng(min, max) {
  return Math.random() * (max - min) + min;
}

function pick(list) {
  return list[(Math.random() * list.length) | 0];
}

function spawnEscort(i) {
  const escort = {
    kind: "escort",
    x: 260 + i * 80,
    y: 820 + i * 55,
    hp: 180,
    maxHp: 180,
    radius: 12,
    reload: 0
  };
  state.escorts.push(escort);
  state.ships.push(escort);
}

function spawnTanker() {
  const size = pick(tankerSizes);
  const cargo = pick(cargoTypes);
  const tanker = {
    kind: "tanker",
    size: size.key,
    cargo: cargo.name,
    cargoValue: cargo.value,
    fireRisk: cargo.fireRisk,
    x: -100,
    y: 860 + rng(-180, 180),
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
  const kind = Math.random() < 0.55 ? "drone" : "missile";
  const tankers = state.ships.filter((s) => s.kind === "tanker" && !s.sunk);
  if (!tankers.length) return;
  const target = pick(tankers);
  const fromNorth = Math.random() < 0.5;
  const threat = {
    kind,
    x: target.x + rng(180, 600),
    y: fromNorth ? 240 : 1540,
    speed: kind === "missile" ? 220 : 150,
    hp: kind === "missile" ? 34 : 20,
    damage: kind === "missile" ? 46 : 20,
    targetId: target
  };
  state.threats.push(threat);
}

function init() {
  for (let i = 0; i < 3; i++) spawnEscort(i);
  for (let i = 0; i < 5; i++) {
    spawnTanker();
    state.ships[state.ships.length - 1].x = -260 - i * 140;
  }
  bindInput();
  requestAnimationFrame(loop);
}

function bindInput() {
  window.addEventListener("keydown", (e) => {
    state.keys.add(e.key.toLowerCase());
    if (e.key === "Tab") {
      e.preventDefault();
      state.selectedEscort = (state.selectedEscort + 1) % state.escorts.length;
    }
    if (e.key.toLowerCase() === "f") useDamageControl();
    if (["1", "2", "3"].includes(e.key)) {
      state.priority = e.key === "1" ? "missile" : e.key === "2" ? "drone" : "any";
    }
  });
  window.addEventListener("keyup", (e) => state.keys.delete(e.key.toLowerCase()));

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
    if (Math.abs(dx) + Math.abs(dy) > 2) state.pointer.moved = true;
    state.camera.x -= dx;
    state.camera.y -= dy;
  });
  canvas.addEventListener("pointerup", (e) => {
    if (!state.pointer.moved) handleTap(e.clientX, e.clientY);
    state.pointer.down = false;
  });
}

function handleTap(screenX, screenY) {
  const wx = screenX + state.camera.x;
  const wy = screenY + state.camera.y - 54;

  let hitEscort = -1;
  state.escorts.forEach((esc, i) => {
    if (Math.hypot(esc.x - wx, esc.y - wy) < esc.radius + 8) hitEscort = i;
  });
  if (hitEscort >= 0) {
    state.selectedEscort = hitEscort;
    return;
  }

  const burning = state.ships.find(
    (s) => s.kind === "tanker" && s.burning && !s.sunk && Math.hypot(s.x - wx, s.y - wy) < s.radius + 10
  );
  if (burning) useDamageControl(burning);
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
  if (d > 230) return;

  target.burn = Math.max(0, target.burn - 1.2);
  if (target.burn <= 0.15) target.burning = false;
  state.score += 8;
}

function update(dt) {
  if (state.ended) return;
  state.time += dt;

  const cam = state.camera;
  if (state.keys.has("arrowleft") || state.keys.has("a")) cam.x -= cam.speed * dt;
  if (state.keys.has("arrowright") || state.keys.has("d")) cam.x += cam.speed * dt;
  if (state.keys.has("arrowup") || state.keys.has("w")) cam.y -= cam.speed * dt;
  if (state.keys.has("arrowdown") || state.keys.has("s")) cam.y += cam.speed * dt;
  handleGamepad(dt);

  cam.x = Math.max(-300, Math.min(WORLD.width - canvas.width + 300, cam.x));
  cam.y = Math.max(-200, Math.min(WORLD.height - canvas.height + 260, cam.y));

  if (state.time > state.spawn.tankerAt) {
    spawnTanker();
    state.spawn.tankerAt = state.time + rng(2.4, 4.2);
  }
  if (state.time > state.spawn.threatAt) {
    spawnThreat();
    state.spawn.threatAt = state.time + rng(1.2, 2.4);
  }

  const aliveTankers = state.ships.filter((s) => s.kind === "tanker" && !s.sunk);
  const leadX = aliveTankers.length ? Math.max(...aliveTankers.map((t) => t.x)) : 200;
  state.escorts.forEach((esc, i) => {
    const targetX = leadX - 90 + i * 32;
    const targetY = 760 + i * 130;
    esc.x += (targetX - esc.x) * dt * 1.3;
    esc.y += (targetY - esc.y) * dt * 1.3;
  });

  state.ships.forEach((s) => {
    if (s.kind !== "tanker" || s.sunk) return;
    s.x += s.speed * dt;
    if (s.burning) {
      s.burn += dt * 0.35;
      s.hp -= (4 + s.burn * 3) * dt;
    }
    if (s.hp <= 0 || s.burn > 4.8) {
      s.sunk = true;
      state.lost += 1;
      state.score -= 120;
    }
    if (s.x > WORLD.width + 80) {
      s.sunk = true;
      state.delivered += 1;
      state.score += 50 + s.cargoValue;
    }
  });

  for (const esc of state.escorts) {
    esc.reload -= dt;
    if (esc.reload > 0) continue;

    let targets = state.threats.filter((t) => Math.hypot(t.x - esc.x, t.y - esc.y) < 260);
    if (state.priority !== "any") {
      const exact = targets.filter((t) => t.kind === state.priority);
      if (exact.length) targets = exact;
    }
    if (!targets.length) continue;

    const target = targets.sort((a, b) => a.hp - b.hp)[0];
    target.hp -= 16;
    esc.reload = 0.2;
    if (target.hp <= 0) {
      state.threats = state.threats.filter((t) => t !== target);
      state.score += target.kind === "missile" ? 20 : 10;
    }
  }

  state.threats.forEach((t) => {
    const target = t.targetId;
    if (!target || target.sunk) return;
    const dx = target.x - t.x;
    const dy = target.y - t.y;
    const d = Math.hypot(dx, dy) || 0.0001;
    t.x += (dx / d) * t.speed * dt;
    t.y += (dy / d) * t.speed * dt;
    if (d < target.radius + 6) {
      target.hp -= t.damage;
      if (!target.burning && Math.random() < 0.45 * target.fireRisk) {
        target.burning = true;
        target.burn = Math.max(target.burn, 0.2);
      }
      t.hp = -999;
    }
  });
  state.threats = state.threats.filter((t) => t.hp > 0);

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

function handleGamepad(dt) {
  const gp = navigator.getGamepads ? navigator.getGamepads()[0] : null;
  if (!gp) return;

  const dead = (v) => (Math.abs(v) < 0.15 ? 0 : v);
  state.camera.x += dead(gp.axes[0] || 0) * 500 * dt;
  state.camera.y += dead(gp.axes[1] || 0) * 500 * dt;

  const pressed = (i) => gp.buttons[i] && gp.buttons[i].pressed;
  const tap = (i) => pressed(i) && !state.gamepad.prevButtons[i];

  if (tap(0)) useDamageControl(); // A/Cross
  if (tap(4)) state.selectedEscort = (state.selectedEscort - 1 + state.escorts.length) % state.escorts.length; // LB
  if (tap(5)) state.selectedEscort = (state.selectedEscort + 1) % state.escorts.length; // RB
  if (tap(12)) state.priority = "missile";
  if (tap(13)) state.priority = "drone";
  if (tap(15)) state.priority = "any";

  state.gamepad.prevButtons = gp.buttons.map((b) => b.pressed);
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(-state.camera.x, -state.camera.y + 54);

  // sea lanes
  ctx.fillStyle = "rgba(92, 171, 255, 0.14)";
  ctx.fillRect(0, 640, WORLD.width, 380);
  ctx.strokeStyle = "rgba(140, 205, 255, 0.38)";
  ctx.setLineDash([14, 10]);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 830);
  ctx.lineTo(WORLD.width, 830);
  ctx.stroke();
  ctx.setLineDash([]);

  // shore threat zones
  ctx.fillStyle = "rgba(255, 110, 110, 0.12)";
  ctx.fillRect(0, 0, WORLD.width, 300);
  ctx.fillRect(0, 1500, WORLD.width, 300);

  // traffic jam markers
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = "rgba(255,255,255,0.2)";
    ctx.fillRect(20 + i * 14, 830 + (i % 2) * 18, 10, 10);
    ctx.fillRect(WORLD.width - 150 + i * 14, 830 + (i % 2) * 18, 10, 10);
  }

  for (const s of state.ships) {
    if (s.kind === "tanker" && s.sunk) continue;
    if (s.kind === "escort") drawEscort(s);
    if (s.kind === "tanker") drawTanker(s);
  }
  for (const t of state.threats) drawThreat(t);

  ctx.restore();
}

function drawEscort(s) {
  ctx.fillStyle = "#7ec9ff";
  ctx.beginPath();
  ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
  ctx.fill();
  if (state.escorts[state.selectedEscort] === s) {
    ctx.strokeStyle = "#eaff66";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.radius + 6, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawTanker(s) {
  const colorByCargo = {
    "Crude Oil": "#d9b38c",
    LPG: "#b0d6ff",
    Helium: "#d9d6ff",
    Petrochemicals: "#ffb3a8",
    Urea: "#dbf0bc",
    Containers: "#c8cfd9"
  };

  ctx.fillStyle = colorByCargo[s.cargo] || "#d8d8d8";
  ctx.fillRect(s.x - s.radius * 1.5, s.y - s.radius * 0.8, s.radius * 3, s.radius * 1.6);

  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(s.x - s.radius * 1.5, s.y + s.radius + 7, s.radius * 3, 5);
  ctx.fillStyle = "#6ce693";
  const hpW = (s.hp / s.maxHp) * s.radius * 3;
  ctx.fillRect(s.x - s.radius * 1.5, s.y + s.radius + 7, Math.max(0, hpW), 5);

  if (s.burning) {
    ctx.fillStyle = "rgba(255,120,70,0.9)";
    ctx.beginPath();
    ctx.arc(s.x, s.y - s.radius, 5 + s.burn * 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawThreat(t) {
  ctx.fillStyle = t.kind === "missile" ? "#ff7f66" : "#ffda6a";
  ctx.beginPath();
  ctx.arc(t.x, t.y, t.kind === "missile" ? 5 : 4, 0, Math.PI * 2);
  ctx.fill();
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
