/**
 * accelerator.js — HADRON v4 Frontend
 * =====================================
 *
 * Novidades:
 *   - Animação de injeção (LINAC4 → Booster → PS → SPS → LHC)
 *   - 4 detectores reais com luminosidade individual (ATLAS, CMS, ALICE, LHCb)
 *   - Painel de alarmes com severidades e animações
 *   - Gráfico histórico de energia vs tempo
 *   - Física de partículas proporcional à energia (beta real)
 *   - Efeitos visuais avançados por detector
 *   - Estado DUMP com animação dramática
 *   - Pileup, emitância, tune, cromaticidade, corrente
 */

"use strict";

// ── Canvas e contexto ─────────────────────────────────────────────────────────

const canvas = document.getElementById("ring-canvas");
const ctx    = canvas.getContext("2d");

function resizeCanvas() {
  const size = Math.min(canvas.parentElement.offsetWidth, 460);
  canvas.width  = size;
  canvas.height = size;
}
resizeCanvas();
window.addEventListener("resize", () => { resizeCanvas(); });

const CX = () => canvas.width  / 2;
const CY = () => canvas.height / 2;
const RING_R = () => canvas.width * 0.42;
const RING_W = 10;

// ── Detectores (ângulos e cores) ──────────────────────────────────────────────

const DETECTORS = {
  IP1: { name: "ATLAS", angle: 0,               color: "#00f5ff", colorDim: "#003d50", active: false, lumi: 0 },
  IP5: { name: "CMS",   angle: Math.PI,          color: "#ff6b00", colorDim: "#401200", active: false, lumi: 0 },
  IP2: { name: "ALICE", angle: Math.PI / 2,      color: "#00ff88", colorDim: "#003320", active: false, lumi: 0 },
  IP8: { name: "LHCb",  angle: 3 * Math.PI / 2,  color: "#ff00cc", colorDim: "#330020", active: false, lumi: 0 },
};

// ── Estado visual ─────────────────────────────────────────────────────────────

const vis = {
  state:           "IDLE",
  energyTev:       0,
  targetEnergyTev: 0,
  magnetFieldT:    0,
  gamma:           1,
  beta:            0,
  luminosity:      0,
  collisionRate:   0,
  totalCollisions: 0,
  nBunches:        0,
  pileup:          0,
  emittance:       3.75,
  tuneX:           64.31,
  tuneY:           59.32,
  beamCurrentMa:   0,
  beamLifetimeH:   0,
  fillNumber:      1,
  injectionStage:  "",
  injectionProgress: 0,

  particles: [],
  sparks:    [],
  shockwaves:[],
  flashes:   [],
  dumpParticles: [],

  // Gráfico de energia (últimos 120 pontos)
  energyHistory: [],
  energyHistoryMax: 120,

  frame: 0,
  dumpEffect: 0,   // 0-1 intensidade do efeito dump
};

// ── Histórico de energia ──────────────────────────────────────────────────────

function pushEnergyHistory(energyTev, state) {
  vis.energyHistory.push({ e: energyTev, s: state, t: Date.now() });
  if (vis.energyHistory.length > vis.energyHistoryMax) {
    vis.energyHistory.shift();
  }
}

// ── Partículas ────────────────────────────────────────────────────────────────

function makeParticle(dir) {
  return {
    angle: Math.random() * Math.PI * 2,
    speed: 0.010 + Math.random() * 0.004,
    dir,
    trail: [],
    color: dir === 1 ? "#00f5ff" : "#ff6b00",
    r: RING_R() + (Math.random() - 0.5) * RING_W * 0.4,
    size: 2.5,
  };
}

function syncParticles(nBunches) {
  const rr = RING_R();
  vis.particles.forEach(p => { p.r = rr + (Math.random() - 0.5) * RING_W * 0.4; });

  const target = nBunches > 0 ? Math.max(8, Math.round(Math.log10(nBunches + 1) * 10)) : 0;
  const b1 = vis.particles.filter(p => p.dir ===  1).length;
  const b2 = vis.particles.filter(p => p.dir === -1).length;
  for (let i = b1; i < target; i++) vis.particles.push(makeParticle( 1));
  for (let i = b2; i < target; i++) vis.particles.push(makeParticle(-1));
  if (nBunches === 0) vis.particles = [];
}

// ── Efeitos de colisão ────────────────────────────────────────────────────────

function spawnCollision(x, y, big, color1 = "#00f5ff", color2 = "#ff6b00") {
  const count = big ? 80 : 30;
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = big ? 1.5 + Math.random() * 8 : 0.5 + Math.random() * 3;
    vis.sparks.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1.0,
      decay: 0.015 + Math.random() * 0.04,
      color: Math.random() < 0.5 ? color1 : color2,
      r: big ? 2.5 + Math.random() * 3.5 : 1.2 + Math.random() * 2,
    });
  }
  if (big) {
    vis.shockwaves.push({ x, y, r: 0, maxR: 130, life: 1.0, color: color2 });
    vis.flashes.push({ life: 1.0, color: color2 });
  }
}

function spawnDumpEffect() {
  const cx = CX(), cy = CY();
  // Partículas voando para fora — beam dump dramático
  for (let i = 0; i < 200; i++) {
    const angle = Math.random() * Math.PI * 2;
    const r = RING_R() + (Math.random() - 0.5) * 20;
    vis.dumpParticles.push({
      x: cx + Math.cos(angle) * r,
      y: cy + Math.sin(angle) * r,
      vx: Math.cos(angle) * (2 + Math.random() * 6),
      vy: Math.sin(angle) * (2 + Math.random() * 6),
      life: 1.0,
      decay: 0.01 + Math.random() * 0.03,
      color: Math.random() < 0.6 ? "#ff6b00" : "#ff003c",
      r: 2 + Math.random() * 3,
    });
  }
  vis.dumpEffect = 1.0;
  vis.flashes.push({ life: 2.0, color: "#ff3300" });
}

// ── Pontos de interação ───────────────────────────────────────────────────────

function checkCollisions() {
  if (vis.state !== "COLLIDING") return;
  if (vis.frame % 3 !== 0) return;

  const beam1 = vis.particles.filter(p => p.dir ===  1);
  const beam2 = vis.particles.filter(p => p.dir === -1);
  const cx = CX(), cy = CY();

  // Checa colisões perto de cada IP ativo
  for (const [ip, det] of Object.entries(DETECTORS)) {
    if (!det.active) continue;
    const ipX = cx + Math.cos(det.angle) * RING_R();
    const ipY = cy + Math.sin(det.angle) * RING_R();

    for (const a of beam1) {
      const ax = cx + Math.cos(a.angle) * a.r;
      const ay = cy + Math.sin(a.angle) * a.r;
      if (Math.hypot(ax - ipX, ay - ipY) > 20) continue;

      for (const b of beam2) {
        const bx = cx + Math.cos(b.angle) * b.r;
        const by = cy + Math.sin(b.angle) * b.r;
        if (Math.hypot(bx - ipX, by - ipY) > 20) continue;

        if (Math.hypot(ax - bx, ay - by) < 16) {
          spawnCollision(
            (ax + bx) / 2, (ay + by) / 2,
            vis.energyTev > 4,
            det.color, "#ff6b00"
          );
        }
      }
    }
  }
}

// ── Renderização ──────────────────────────────────────────────────────────────

function render() {
  const W = canvas.width, H = canvas.height;
  const cx = CX(), cy = CY(), rr = RING_R();

  // Leve trail (não limpa 100% — efeito ghosting)
  ctx.fillStyle = "rgba(2, 4, 10, 0.80)";
  ctx.fillRect(0, 0, W, H);

  // Efeito flash de dump
  if (vis.dumpEffect > 0) {
    ctx.fillStyle = `rgba(255,80,0,${vis.dumpEffect * 0.15})`;
    ctx.fillRect(0, 0, W, H);
    vis.dumpEffect = Math.max(0, vis.dumpEffect - 0.02);
  }

  drawRingGlow(cx, cy, rr);
  drawDipoleMagnets(cx, cy, rr);
  drawQuadrupoles(cx, cy, rr);
  drawInteractionPoints(cx, cy, rr);
  drawInjectionAnimation(cx, cy, rr);
  drawParticles(cx, cy);
  drawDumpParticles();
  drawSparks();
  drawShockwaves();
  drawFlashes(W, H);
  drawCenterLabel(cx, cy);
  drawEnergyArc(cx, cy);

  checkCollisions();

  vis.frame++;
  requestAnimationFrame(render);
}

// ── Funções de desenho ────────────────────────────────────────────────────────

function drawRingGlow(cx, cy, rr) {
  const frac = Math.min(vis.energyTev / 6.8, 1);
  const stateColors = {
    IDLE:         [0, 60, 80],
    PRECOOLING:   [0, 100, 200],
    INJECTING:    [0, 180, 220],
    INJECTED:     [0, 245, 255],
    ACCELERATING: [255, 120, 0],
    STABLE:       [0, 255, 136],
    COLLIDING:    [255, 50, 50],
    DUMP:         [255, 60, 0],
    FAULT:        [255, 0, 60],
  };
  const [r, g, b] = stateColors[vis.state] || [0, 60, 80];
  const alpha = 0.05 + frac * 0.2;

  const grad = ctx.createRadialGradient(cx, cy, rr - 16, cx, cy, rr + 16);
  grad.addColorStop(0,   `rgba(${r},${g},${b},0)`);
  grad.addColorStop(0.5, `rgba(${r},${g},${b},${alpha})`);
  grad.addColorStop(1,   `rgba(${r},${g},${b},0)`);

  ctx.beginPath();
  ctx.arc(cx, cy, rr, 0, Math.PI * 2);
  ctx.strokeStyle = grad;
  ctx.lineWidth = 30;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, rr, 0, Math.PI * 2);
  ctx.strokeStyle = frac > 0 ? `rgba(${r},${g},${b},0.18)` : "rgba(10,40,60,0.4)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function drawDipoleMagnets(cx, cy, rr) {
  const N = 32;  // 32 representando os 1232 reais
  const active = vis.energyTev > 0;
  const fieldFrac = Math.min(vis.magnetFieldT / 8.33, 1);

  for (let i = 0; i < N; i++) {
    const angle = (i / N) * Math.PI * 2;
    const mx = cx + Math.cos(angle) * rr;
    const my = cy + Math.sin(angle) * rr;

    ctx.save();
    ctx.translate(mx, my);
    ctx.rotate(angle + Math.PI / 2);

    ctx.fillStyle   = active ? `rgba(0,${Math.round(40 + fieldFrac*60)},80,0.9)` : "rgba(8,20,30,0.5)";
    ctx.strokeStyle = active ? "#0a3a5a" : "#041018";
    ctx.lineWidth   = 0.8;
    ctx.fillRect(-7, -4, 14, 8);
    ctx.strokeRect(-7, -4, 14, 8);

    if (active) {
      ctx.fillStyle = `rgba(0,180,255,${0.08 + fieldFrac * 0.35})`;
      ctx.fillRect(-5, -2, 10, 4);
    }
    ctx.restore();
  }
}

function drawQuadrupoles(cx, cy, rr) {
  // 8 quadrupolos de focalização (representando os 392 reais)
  const N = 8;
  const active = vis.energyTev > 0;

  for (let i = 0; i < N; i++) {
    const angle = ((i + 0.5) / N) * Math.PI * 2;
    const qx = cx + Math.cos(angle) * rr;
    const qy = cy + Math.sin(angle) * rr;

    ctx.save();
    ctx.translate(qx, qy);
    ctx.rotate(angle + Math.PI / 2);

    ctx.fillStyle   = active ? "rgba(0,80,40,0.8)" : "rgba(0,20,10,0.5)";
    ctx.strokeStyle = active ? "#0a6040" : "#041808";
    ctx.lineWidth   = 0.8;

    // Forma de quadrupolo (losango)
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(6, 0);
    ctx.lineTo(0, 8);
    ctx.lineTo(-6, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    if (active) {
      ctx.fillStyle = `rgba(0,255,150,0.15)`;
      ctx.beginPath();
      ctx.moveTo(0, -5); ctx.lineTo(4, 0); ctx.lineTo(0, 5); ctx.lineTo(-4, 0);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
}

function drawInteractionPoints(cx, cy, rr) {
  Object.entries(DETECTORS).forEach(([ip, det]) => {
    const ix = cx + Math.cos(det.angle) * rr;
    const iy = cy + Math.sin(det.angle) * rr;
    const colliding = vis.state === "COLLIDING" && det.active;
    const injected  = vis.state !== "IDLE" && vis.state !== "PRECOOLING";

    // Halo do detector
    if (injected) {
      const baseColor = colliding ? det.color : det.colorDim;
      const glowAlpha = colliding
        ? 0.2 + Math.sin(vis.frame * 0.15 + Object.keys(DETECTORS).indexOf(ip)) * 0.1
        : 0.05;

      const hexToRgb = h => {
        const r = parseInt(h.slice(1, 3), 16);
        const g = parseInt(h.slice(3, 5), 16);
        const b = parseInt(h.slice(5, 7), 16);
        return `${r},${g},${b}`;
      };

      ctx.beginPath();
      ctx.arc(ix, iy, colliding ? 18 : 10, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${hexToRgb(det.color)},${glowAlpha + 0.05})`;
      ctx.lineWidth = colliding ? 2 : 1;
      ctx.stroke();
    }

    // Ponto central
    ctx.beginPath();
    ctx.arc(ix, iy, colliding ? 5.5 : 3.5, 0, Math.PI * 2);
    ctx.fillStyle = colliding ? det.color : (injected ? "rgba(20,60,80,0.8)" : "rgba(10,30,40,0.4)");
    ctx.shadowColor = colliding ? det.color : "transparent";
    ctx.shadowBlur  = colliding ? 12 : 0;
    ctx.fill();
    ctx.shadowBlur  = 0;

    // Anel pulsante durante colisão
    if (colliding) {
      const pulse = 8 + Math.sin(vis.frame * 0.12 + Object.keys(DETECTORS).indexOf(ip) * 1.2) * 5;
      ctx.beginPath();
      ctx.arc(ix, iy, pulse, 0, Math.PI * 2);
      ctx.strokeStyle = det.color + "55";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Label do detector
    const labelDist = rr + 22;
    const lx = cx + Math.cos(det.angle) * labelDist;
    const ly = cy + Math.sin(det.angle) * labelDist;
    ctx.font = `bold ${canvas.width * 0.022}px 'Share Tech Mono', monospace`;
    ctx.fillStyle = colliding ? det.color : "#1a4a5a";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(det.name, lx, ly);
  });
}

function drawInjectionAnimation(cx, cy, rr) {
  if (vis.state !== "INJECTING" && vis.injectionStage === "") return;

  const stages = ["LINAC4", "BOOSTER", "PS", "SPS", "LHC"];
  const stageIdx = stages.indexOf(vis.injectionStage);
  if (stageIdx < 0) return;

  // Progresso de injeção como arco animado
  const progress = vis.injectionProgress;
  const arcStart = -Math.PI / 2;
  const arcEnd   = arcStart + progress * Math.PI * 2;

  ctx.beginPath();
  ctx.arc(cx, cy, rr, arcStart, arcEnd);
  ctx.strokeStyle = `rgba(0,245,255,${0.3 + Math.sin(vis.frame * 0.15) * 0.1})`;
  ctx.lineWidth = 4;
  ctx.stroke();

  // Partícula de injeção viajando pelo arco
  const injAngle = arcStart + progress * Math.PI * 2;
  const injX = cx + Math.cos(injAngle) * rr;
  const injY = cy + Math.sin(injAngle) * rr;

  ctx.beginPath();
  ctx.arc(injX, injY, 5, 0, Math.PI * 2);
  ctx.fillStyle = "#00f5ff";
  ctx.shadowColor = "#00f5ff";
  ctx.shadowBlur = 15;
  ctx.fill();
  ctx.shadowBlur = 0;

  // Nome do estágio atual
  ctx.font = `${canvas.width * 0.024}px 'Share Tech Mono', monospace`;
  ctx.fillStyle = "rgba(0,245,255,0.6)";
  ctx.textAlign = "center";
  ctx.fillText(`[ ${vis.injectionStage} ]`, cx, cy + rr * 0.35);
}

function drawParticles(cx, cy) {
  if (vis.particles.length === 0) return;
  const rr = RING_R();
  // Velocidade proporcional ao beta real
  const speedMult = 0.3 + vis.beta * 2.0;

  vis.particles.forEach(p => {
    p.angle += p.speed * p.dir * speedMult;
    p.r = rr + (p.r - rr) * 0.99 + (Math.random() - 0.5) * 0.3; // pequena oscilação

    const px = cx + Math.cos(p.angle) * p.r;
    const py = cy + Math.sin(p.angle) * p.r;

    p.trail.push({ x: px, y: py });
    if (p.trail.length > 28) p.trail.shift();

    for (let i = 1; i < p.trail.length; i++) {
      const t = i / p.trail.length;
      ctx.beginPath();
      ctx.moveTo(p.trail[i - 1].x, p.trail[i - 1].y);
      ctx.lineTo(p.trail[i].x, p.trail[i].y);
      const alpha = t * 0.45;
      ctx.strokeStyle = p.color.startsWith("#")
        ? hexToRgba(p.color, alpha)
        : p.color;
      ctx.lineWidth = p.size * 0.45 * t;
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(px, py, p.size, 0, Math.PI * 2);
    ctx.fillStyle   = p.color;
    ctx.shadowColor = p.color;
    ctx.shadowBlur  = 6 + vis.energyTev * 1.2;
    ctx.fill();
    ctx.shadowBlur = 0;
  });
}

function drawDumpParticles() {
  vis.dumpParticles = vis.dumpParticles.filter(p => p.life > 0);
  vis.dumpParticles.forEach(p => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * p.life, 0, Math.PI * 2);
    ctx.fillStyle = hexToRgba(p.color, p.life * 0.8);
    ctx.fill();
    p.x += p.vx;
    p.y += p.vy;
    p.vx *= 0.97;
    p.vy *= 0.97;
    p.life -= p.decay;
  });
}

function drawSparks() {
  vis.sparks = vis.sparks.filter(s => s.life > 0);
  vis.sparks.forEach(s => {
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r * s.life, 0, Math.PI * 2);
    ctx.fillStyle = hexToRgba(s.color, s.life * 0.9);
    ctx.shadowColor = s.color;
    ctx.shadowBlur  = 4;
    ctx.fill();
    ctx.shadowBlur = 0;
    s.x += s.vx; s.y += s.vy;
    s.vx *= 0.95; s.vy *= 0.95;
    s.life -= s.decay;
  });
}

function drawShockwaves() {
  vis.shockwaves = vis.shockwaves.filter(s => s.life > 0);
  vis.shockwaves.forEach(s => {
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.strokeStyle = hexToRgba(s.color || "#ff6b00", s.life * 0.5);
    ctx.lineWidth = 2;
    ctx.stroke();
    s.r    += 5;
    s.life -= 0.028;
  });
}

function drawFlashes(W, H) {
  vis.flashes = vis.flashes.filter(f => f.life > 0);
  vis.flashes.forEach(f => {
    const col = f.color || "#ffcc32";
    ctx.fillStyle = hexToRgba(col, f.life * 0.10);
    ctx.fillRect(0, 0, W, H);
    f.life -= 0.055;
  });
}

function drawCenterLabel(cx, cy) {
  const rr = RING_R();
  ctx.beginPath();
  ctx.arc(cx, cy, rr * 0.30, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,245,255,0.03)";
  ctx.fill();
  ctx.strokeStyle = "rgba(0,245,255,0.06)";
  ctx.lineWidth = 1;
  ctx.stroke();

  const stateLabel = {
    INJECTING: vis.injectionStage || "INJECTING",
    PRECOOLING: "COOLING",
  };

  const sz = canvas.width;
  ctx.font = `bold ${sz * 0.055}px 'Share Tech Mono', monospace`;
  ctx.fillStyle = "rgba(0,245,255,0.3)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("LHC", cx, cy - sz * 0.025);

  ctx.font = `${sz * 0.022}px 'Share Tech Mono', monospace`;
  ctx.fillStyle = "rgba(0,180,200,0.45)";
  ctx.fillText(stateLabel[vis.state] || vis.state, cx, cy + sz * 0.025);

  // Fill number
  ctx.font = `${sz * 0.017}px 'Share Tech Mono', monospace`;
  ctx.fillStyle = "rgba(0,120,140,0.3)";
  ctx.fillText(`FILL #${vis.fillNumber}`, cx, cy + sz * 0.06);
}

function drawEnergyArc(cx, cy) {
  const frac = Math.min(vis.energyTev / 6.8, 1);
  if (frac <= 0) return;
  const rr = RING_R();
  const r = rr * 0.26;

  // Fundo do arco
  ctx.beginPath();
  ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2);
  ctx.strokeStyle = "rgba(0,245,255,0.06)";
  ctx.lineWidth = 3;
  ctx.stroke();

  // Arco de progresso
  const stateGradColors = {
    ACCELERATING: ["#ff6b00", "#ffcc00"],
    STABLE:       ["#00ff88", "#00f5ff"],
    COLLIDING:    ["#ff003c", "#ff6b00"],
  };
  const [c1, c2] = stateGradColors[vis.state] || ["#00f5ff", "#00f5ff"];

  const grad = ctx.createLinearGradient(cx - r, cy, cx + r, cy);
  grad.addColorStop(0, c1);
  grad.addColorStop(1, c2);

  ctx.beginPath();
  ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
  ctx.strokeStyle = grad;
  ctx.lineWidth = 3;
  ctx.shadowColor = c1;
  ctx.shadowBlur  = 8;
  ctx.stroke();
  ctx.shadowBlur  = 0;
}

// ── SSE ───────────────────────────────────────────────────────────────────────

function connectSSE() {
  const source = new EventSource("/api/stream");
  source.onmessage = (e) => {
    const data = JSON.parse(e.data);
    applyBackendState(data);
  };
  source.onerror = () => {
    setTimeout(connectSSE, 2000);
  };
}

let _prevState = "IDLE";

function applyBackendState(data) {
  const prevState = vis.state;
  vis.state            = data.state;
  vis.energyTev        = data.energy_tev;
  vis.targetEnergyTev  = data.target_energy_tev;
  vis.magnetFieldT     = data.magnetic_field_t;
  vis.gamma            = data.gamma;
  vis.beta             = data.beta;
  vis.luminosity       = data.luminosity;
  vis.collisionRate    = data.collision_rate;
  vis.totalCollisions  = data.total_collisions;
  vis.nBunches         = data.n_bunches;
  vis.pileup           = data.pileup;
  vis.emittance        = data.emittance_um;
  vis.tuneX            = data.tune_x;
  vis.tuneY            = data.tune_y;
  vis.beamCurrentMa    = data.beam_current_ma;
  vis.beamLifetimeH    = data.beam_lifetime_h;
  vis.fillNumber       = data.fill_number || 1;
  vis.injectionStage   = data.injection_stage || "";
  vis.injectionProgress = data.injection_progress || 0;

  // Atualiza detectores
  if (data.detectors) {
    data.detectors.forEach(det => {
      if (DETECTORS[det.ip]) {
        DETECTORS[det.ip].active = det.active;
        DETECTORS[det.ip].lumi   = det.luminosity;
      }
    });
  }

  // Efeito dump
  if (prevState !== "DUMP" && data.state === "DUMP") {
    spawnDumpEffect();
  }

  syncParticles(data.n_bunches);
  updateTelemetry(data);
  updateLog(data.log);
  updateStatusDots(data);
  updateAlarms(data.alarms || []);
  updateDetectorPanel(data.detectors || []);

  // Histórico de energia (a cada ~5 frames)
  if (vis.frame % 5 === 0) {
    pushEnergyHistory(data.energy_tev, data.state);
    drawEnergyChart();
  }
}

// ── Telemetria ────────────────────────────────────────────────────────────────

const fmt = (v, d = 2) => (v !== undefined && v !== null ? Number(v).toFixed(d) : "—");
const fmtBig = n => Number(n || 0).toLocaleString("pt-BR");
function toSci(n) {
  if (!n || n === 0) return "0";
  const exp = Math.floor(Math.log10(n));
  const man = (n / Math.pow(10, exp)).toFixed(2);
  return `${man}×10<sup>${exp}</sup>`;
}

function updateTelemetry(d) {
  setMeter("energy",   fmt(d.energy_tev),        d.energy_tev / 6.8);
  setMeter("magnetic", fmt(d.magnetic_field_t),  d.magnetic_field_t / 8.33);
  setMeter("gamma",    fmt(d.gamma, 0),           Math.min(d.gamma / 7500, 1));
  setMeter("beta",     fmt(d.beta, 6),            d.beta);
  setMeter("lumi",     toSci(d.luminosity),       Math.min(d.luminosity / 2e34, 1), false, true);
  setMeter("coll",     fmt(d.collision_rate, 0),  Math.min(d.collision_rate / 8e8, 1));
  setMeter("total",    fmtBig(d.total_collisions), 0);
  setMeter("bunches",  d.n_bunches,               d.n_bunches / 2556);
  setMeter("current",  fmt(d.beam_current_ma, 1), d.beam_current_ma / 600);
  setMeter("emittance", fmt(d.emittance_um, 2),   Math.min(d.emittance_um / 6, 1), true);
  setMeter("pileup",   fmt(d.pileup, 1),          Math.min(d.pileup / 100, 1));
  setMeter("intlumi",  fmt(d.integrated_lumi_inv_fb, 4), Math.min(d.integrated_lumi_inv_fb / 0.1, 1));

  // Temperatura
  const tempK = d.temperature_k || 1.9;
  const warmFrac = (tempK - 1.9) / 1.0;
  setMeter("temp", fmt(tempK, 3), Math.min(warmFrac, 1), true);

  // Badge de estado
  const badge = document.getElementById("state-badge");
  if (badge) {
    badge.textContent = d.state;
    badge.className = "state-badge state-" + d.state.toLowerCase();
  }

  // Uptime
  const up = d.uptime_s || 0;
  const h = Math.floor(up / 3600).toString().padStart(2, "0");
  const m = Math.floor((up % 3600) / 60).toString().padStart(2, "0");
  const s = Math.floor(up % 60).toString().padStart(2, "0");
  const el = document.getElementById("uptime");
  if (el) el.textContent = `UP: ${h}:${m}:${s}`;

  // Tune
  const tuneEl = document.getElementById("m-tune-val");
  if (tuneEl) tuneEl.textContent = `${fmt(d.tune_x, 4)} / ${fmt(d.tune_y, 4)}`;

  // Energia no CM
  const ecm = (d.energy_tev || 0) * 2;
  const ecmEl = document.getElementById("m-ecm-val");
  if (ecmEl) ecmEl.textContent = fmt(ecm, 2);

  // Radiação síncrotron
  const synEl = document.getElementById("m-synrad-val");
  if (synEl) synEl.textContent = fmt(d.synchrotron_loss_kev, 1);

  // Fill number
  const fillEl = document.getElementById("fill-number");
  if (fillEl) fillEl.textContent = `FILL #${d.fill_number || 1}`;
}

function setMeter(id, val, frac = 0, danger = false, html = false) {
  const valEl = document.getElementById(`m-${id}-val`);
  const barEl = document.getElementById(`m-${id}-bar`);
  if (valEl) {
    if (html) valEl.innerHTML = val;
    else       valEl.textContent = val;
  }
  if (barEl) {
    barEl.style.width = Math.min(frac * 100, 100) + "%";
    if (danger && frac > 0) {
      barEl.style.background = frac > 0.8
        ? "var(--danger)"
        : frac > 0.55
          ? "var(--hot)"
          : "var(--accent)";
    }
  }
}

// ── Log ───────────────────────────────────────────────────────────────────────

let lastLogLength = 0;

function updateLog(lines) {
  if (!lines || lines.length === lastLogLength) return;
  lastLogLength = lines.length;
  const container = document.getElementById("log-container");
  if (!container) return;
  container.innerHTML = "";
  lines.slice(-30).reverse().forEach(line => {
    const div = document.createElement("div");
    div.className = "log-line";
    if      (line.includes("ERRO"))    div.classList.add("log-error");
    else if (line.includes("✓"))       div.classList.add("log-ok");
    else if (line.includes("⚠️"))      div.classList.add("log-alarm");
    else if (line.includes("🎯"))      div.classList.add("log-milestone");
    else if (line.includes("DUMP") || line.includes("FAULT"))
                                       div.classList.add("log-warn");
    div.textContent = line;
    container.appendChild(div);
  });
}

// ── Alarmes ───────────────────────────────────────────────────────────────────

function updateAlarms(alarms) {
  const panel = document.getElementById("alarm-panel");
  const count = document.getElementById("alarm-count");
  if (!panel) return;

  panel.innerHTML = "";

  const active = alarms.filter(a => a.active);
  if (count) {
    count.textContent = active.length > 0 ? active.length : "";
    count.style.display = active.length > 0 ? "inline-block" : "none";
  }

  if (active.length === 0) {
    const ok = document.createElement("div");
    ok.className = "alarm-ok";
    ok.textContent = "✓ SEM ALARMES ATIVOS";
    panel.appendChild(ok);
    return;
  }

  active.forEach(alarm => {
    const div = document.createElement("div");
    div.className = `alarm-item alarm-${alarm.severity.toLowerCase()}`;
    div.innerHTML = `<span class="alarm-code">${alarm.code}</span>
      <span class="alarm-msg">${alarm.message}</span>
      <span class="alarm-time">${alarm.timestamp}</span>`;
    panel.appendChild(div);
  });
}

// ── Painel de detectores ──────────────────────────────────────────────────────

function updateDetectorPanel(detectors) {
  detectors.forEach(det => {
    const el = document.getElementById(`det-${det.ip}`);
    if (!el) return;

    el.classList.toggle("det-active",   det.active);
    el.classList.toggle("det-inactive", !det.active);

    const lumiEl = el.querySelector(".det-lumi");
    if (lumiEl) lumiEl.innerHTML = det.active ? toSci(det.luminosity) : "—";

    const muEl = el.querySelector(".det-pileup");
    if (muEl) muEl.textContent = det.active ? `μ = ${Number(det.pileup).toFixed(1)}` : "";

    const intEl = el.querySelector(".det-intlumi");
    if (intEl) intEl.textContent = det.active
      ? `${Number(det.integrated_lumi_inv_pb).toFixed(3)} pb⁻¹`
      : "";
  });
}

// ── Status dots ───────────────────────────────────────────────────────────────

function updateStatusDots(d) {
  const states = ["INJECTING", "INJECTED", "ACCELERATING", "STABLE", "COLLIDING"];
  setDot("dot-cryo",   true);
  setDot("dot-beam",   states.includes(d.state));
  setDot("dot-stable", ["STABLE", "COLLIDING"].includes(d.state));
  setDot("dot-coll",   d.state === "COLLIDING");
  setDot("dot-fault",  d.state === "FAULT");
}

function setDot(id, active) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle("dot-active",   active);
  el.classList.toggle("dot-inactive", !active);
}

// ── Gráfico de energia ────────────────────────────────────────────────────────

function drawEnergyChart() {
  const chartCanvas = document.getElementById("energy-chart");
  if (!chartCanvas || vis.energyHistory.length < 2) return;
  const cc = chartCanvas.getContext("2d");
  const W = chartCanvas.width, H = chartCanvas.height;

  cc.clearRect(0, 0, W, H);

  // Fundo
  cc.fillStyle = "rgba(0,5,12,0.0)";
  cc.fillRect(0, 0, W, H);

  // Grid horizontal
  const gridLines = [1.0, 3.0, 5.0, 6.8];
  gridLines.forEach(e => {
    const y = H - (e / 7) * (H - 10) - 4;
    cc.beginPath();
    cc.moveTo(0, y);
    cc.lineTo(W, y);
    cc.strokeStyle = "rgba(0,245,255,0.07)";
    cc.lineWidth = 0.5;
    cc.stroke();
    cc.font = "9px 'Share Tech Mono', monospace";
    cc.fillStyle = "rgba(0,245,255,0.2)";
    cc.fillText(`${e}`, 2, y - 2);
  });

  // Linha de energia
  const pts = vis.energyHistory;
  cc.beginPath();
  pts.forEach((p, i) => {
    const x = (i / (vis.energyHistoryMax - 1)) * W;
    const y = H - (p.e / 7) * (H - 10) - 4;
    i === 0 ? cc.moveTo(x, y) : cc.lineTo(x, y);
  });

  const stateColor = {
    ACCELERATING: "#ff6b00",
    STABLE:       "#00ff88",
    COLLIDING:    "#ff003c",
  };
  const lineColor = stateColor[vis.state] || "#00f5ff";

  cc.strokeStyle = lineColor;
  cc.lineWidth   = 1.5;
  cc.shadowColor = lineColor;
  cc.shadowBlur  = 4;
  cc.stroke();
  cc.shadowBlur  = 0;

  // Área sob a curva
  cc.lineTo(W, H);
  cc.lineTo(0, H);
  cc.closePath();
  cc.fillStyle = lineColor + "18";
  cc.fill();
}

// ── Utilitários ───────────────────────────────────────────────────────────────

function hexToRgba(hex, alpha) {
  if (!hex || !hex.startsWith("#")) return `rgba(0,245,255,${alpha})`;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ── Comandos ──────────────────────────────────────────────────────────────────

async function sendCommand(cmd, body = {}) {
  try {
    const res = await fetch(`/api/command/${cmd}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!data.success) console.warn(`Comando '${cmd}' falhou: ${data.message}`);
  } catch (err) {
    console.error("Erro:", err);
  }
}

async function toggleDetector(ip) {
  try {
    await fetch(`/api/detector/${ip}/toggle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Erro ao alternar detector:", err);
  }
}

window.cmdInject     = () => sendCommand("inject", { n_bunches: 2556 });
window.cmdAccelerate = () => sendCommand("accelerate");
window.cmdCollide    = () => sendCommand("collide");
window.cmdDump       = () => sendCommand("dump");
window.toggleDet     = (ip) => toggleDetector(ip);

// ── Boot ──────────────────────────────────────────────────────────────────────

connectSSE();
render();
