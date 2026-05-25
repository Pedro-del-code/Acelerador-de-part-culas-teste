"use strict";

// ── Canvas ───────────────────────────────────────────────────────────────────
const canvas = document.getElementById("ring-canvas");
const ctx    = canvas.getContext("2d");
const CX = canvas.width / 2, CY = canvas.height / 2;
const RING_R = 210, RING_W = 10;

// ── Detectores: posição angular no canvas ────────────────────────────────────
const DET_ANGLES = { ATLAS: 0, CMS: Math.PI, ALICE: Math.PI/2, LHCb: 3*Math.PI/2 };
const DET_COLORS = { ATLAS: "#00f5ff", CMS: "#ff6b00", ALICE: "#00ff88", LHCb: "#ff88ff" };

// ── Estado visual ────────────────────────────────────────────────────────────
const vis = {
  state: "IDLE", energyTev: 0, magnetT: 0,
  gamma: 1, luminosity: 0, collisionRate: 0,
  totalCollisions: 0, nBunches: 0, quenchRisk: 0,
  detectors: {}, particles: [],
  sparks: [], shockwaves: [], flashes: [],
  frame: 0,
  collisionPulse: 0,          // intensidade do pulso de colisão
  ringDistortion: 0,          // distorção do anel na colisão
  catastropheTriggered: false,
  catastrophePhase: 0,        // 0=normal 1=buildup 2=explosion 3=blackout
  catastropheTimer: 0,
  screenOverlay: 0,           // opacidade da sobreposição de tela
  energySpikes: [],           // picos de energia visual
  plasmaRings: [],            // anéis de plasma pós-colisão
  glitchLines: [],            // linhas de glitch na tela
};

// ── Partículas ────────────────────────────────────────────────────────────────
function makeParticle(dir, color) {
  return {
    angle: Math.random() * Math.PI * 2,
    speed: 0.013 + Math.random() * 0.005,
    dir, color,
    trail: [],
    r: RING_R + (Math.random() - 0.5) * RING_W * 0.4,
    size: 2.8,
  };
}

function syncParticles(nBunches) {
  const target = nBunches > 0 ? Math.max(10, Math.round(Math.log10(nBunches + 1) * 12)) : 0;
  const b1 = vis.particles.filter(p => p.dir ===  1).length;
  const b2 = vis.particles.filter(p => p.dir === -1).length;
  for (let i = b1; i < target; i++) vis.particles.push(makeParticle( 1, "#00f5ff"));
  for (let i = b2; i < target; i++) vis.particles.push(makeParticle(-1, "#ff6b00"));
  if (nBunches === 0) vis.particles = [];
}

// ── Colisões visuais ──────────────────────────────────────────────────────────
function spawnCollision(x, y, big) {
  const count = big ? 80 : 28;
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = big ? 1 + Math.random() * 8 : 0.5 + Math.random() * 3;
    vis.sparks.push({
      x, y, vx: Math.cos(a)*s, vy: Math.sin(a)*s,
      life: 1.0, decay: 0.016 + Math.random()*0.04,
      color: Math.random() < 0.5 ? "#00f5ff" : "#ff6b00",
      r: big ? 2 + Math.random()*3 : 1 + Math.random()*2,
    });
  }
  if (big) {
    vis.shockwaves.push({ x, y, r: 0, life: 1.0 });
    vis.flashes.push({ life: 1.0 });
    // Pulso de colisão — ilumina o anel inteiro
    vis.collisionPulse = Math.min(1.0, vis.collisionPulse + 0.3);
  }
}

function spawnCatastrophicCollision() {
  // Colisão catastrófica no centro
  const count = 300;
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = 3 + Math.random() * 15;
    const colors = ["#00f5ff","#ff6b00","#ff003c","#ffffff","#ffff00","#ff88ff","#00ff88"];
    vis.sparks.push({
      x: CX + (Math.random()-0.5)*60,
      y: CY + (Math.random()-0.5)*60,
      vx: Math.cos(a)*s, vy: Math.sin(a)*s,
      life: 1.0, decay: 0.008 + Math.random()*0.02,
      color: colors[Math.floor(Math.random()*colors.length)],
      r: 3 + Math.random()*6,
    });
  }
  // Múltiplas ondas de choque
  for (let i = 0; i < 5; i++) {
    setTimeout(() => {
      vis.shockwaves.push({ x: CX, y: CY, r: 0, life: 1.0, catastrophic: true });
    }, i * 200);
  }
  // Flash branco total
  vis.flashes.push({ life: 2.0, white: true });
  // Anéis de plasma
  for (let i = 0; i < 8; i++) {
    vis.plasmaRings.push({
      r: 10 + i * 25, life: 1.0,
      color: `hsl(${Math.random()*360},100%,70%)`,
      speed: 2 + Math.random() * 4,
    });
  }
}

function checkCollisions() {
  if (vis.state !== "COLLIDING" || vis.frame % 2 !== 0) return;
  if (vis.catastrophePhase > 0) return;
  const b1 = vis.particles.filter(p => p.dir ===  1);
  const b2 = vis.particles.filter(p => p.dir === -1);
  for (const a of b1) {
    const ax = CX + Math.cos(a.angle)*a.r, ay = CY + Math.sin(a.angle)*a.r;
    for (const b of b2) {
      const bx = CX + Math.cos(b.angle)*b.r, by = CY + Math.sin(b.angle)*b.r;
      if (Math.hypot(ax-bx, ay-by) < 14)
        spawnCollision((ax+bx)/2, (ay+by)/2, vis.energyTev > 4);
    }
  }
}

// ── CATÁSTROFE — dispara ao clicar COLLIDE ────────────────────────────────────
function triggerCatastrophe() {
  if (vis.catastropheTriggered) return;
  vis.catastropheTriggered = true;
  vis.catastrophePhase = 1;
  vis.catastropheTimer = 0;

  // Fase 1: buildup (3s) → fase 2: explosão (2s) → fase 3: blackout + reinicio
  addCriticalLog("⚠ ANOMALIA ENERGÉTICA DETECTADA — CONTENÇÃO FALHANDO");
  addCriticalLog("⚠⚠ BEAM LOSS CATASTRÓFICO — QPS OFFLINE");
  addCriticalLog("⚠⚠⚠ FALHA CRÍTICA DO SISTEMA — EVACUAÇÃO IMEDIATA");

  setTimeout(() => {
    vis.catastrophePhase = 2;
    spawnCatastrophicCollision();
    addCriticalLog("☢ EXPLOSÃO CATASTRÓFICA — DANO IRREPARÁVEL AO ANEL");
  }, 3000);

  setTimeout(() => {
    vis.catastrophePhase = 3;
    startBlackoutSequence();
  }, 5000);
}

function startBlackoutSequence() {
  const overlay = document.getElementById("catastrophe-overlay");
  if (!overlay) return;
  overlay.style.display = "flex";

  const lines = [
    "CRITICAL SYSTEM FAILURE",
    "BEAM CONTAINMENT LOST",
    "SUPERCONDUCTING MAGNET QUENCH CASCADE",
    "EMERGENCY SHUTDOWN INITIATED",
    "DETECTOR SYSTEMS OFFLINE",
    "EVACUATING PERSONNEL...",
    "REBOOTING CONTROL SYSTEMS...",
  ];

  let i = 0;
  const msgEl = document.getElementById("overlay-msg");
  const interval = setInterval(() => {
    if (i < lines.length && msgEl) {
      const line = document.createElement("div");
      line.className = "overlay-line";
      line.textContent = "> " + lines[i];
      msgEl.appendChild(line);
      i++;
    } else {
      clearInterval(interval);
      // Pisca e reinicia
      setTimeout(() => {
        overlay.classList.add("reboot");
        setTimeout(() => {
          location.reload();
        }, 2500);
      }, 1200);
    }
  }, 600);
}

function addCriticalLog(msg) {
  const c = document.getElementById("log-container");
  if (!c) return;
  const d = document.createElement("div");
  d.className = "log-line log-critical";
  d.textContent = `[${new Date().toLocaleTimeString()}] [CRITICAL] ${msg}`;
  c.prepend(d);
}

// ── RENDER ────────────────────────────────────────────────────────────────────
function render() {
  // Glitch na catástrofe
  let glitchOffsetX = 0, glitchOffsetY = 0;
  if (vis.catastrophePhase >= 1) {
    const intensity = vis.catastrophePhase === 1 ? 0.3 : 1.0;
    if (Math.random() < 0.15 * intensity) {
      glitchOffsetX = (Math.random()-0.5) * 12 * intensity;
      glitchOffsetY = (Math.random()-0.5) * 6 * intensity;
    }
  }

  ctx.save();
  ctx.translate(glitchOffsetX, glitchOffsetY);

  // Fundo com afterglow de colisão
  const bgFlash = vis.collisionPulse * 0.04;
  ctx.fillStyle = `rgba(${2+bgFlash*20},${4+bgFlash*8},${10+bgFlash*5},0.80)`;
  ctx.fillRect(-20, -20, canvas.width+40, canvas.height+40);

  drawRingGlow();
  drawDipoles();
  drawDetectorPoints();
  drawParticles();
  drawSparks();
  drawShockwaves();
  drawPlasmaRings();
  drawFlashes();
  drawCenter();
  drawQuenchWarning();
  drawCatastropheEffect();

  ctx.restore();

  checkCollisions();

  // Decai o pulso de colisão
  if (vis.collisionPulse > 0) vis.collisionPulse = Math.max(0, vis.collisionPulse - 0.02);

  vis.frame++;
  requestAnimationFrame(render);
}

function drawRingGlow() {
  const f = Math.min(vis.energyTev / 6.8, 1);
  const catBoost = vis.catastrophePhase === 1 ? 1 + vis.catastropheTimer * 0.3 : 1;
  const a = (0.05 + f * 0.2 + vis.collisionPulse * 0.15) * catBoost;
  const g = ctx.createRadialGradient(CX, CY, RING_R-14, CX, CY, RING_R+14);

  // Muda cor na catástrofe
  const color = vis.catastrophePhase >= 2 ? "255,60,0" : "0,245,255";
  g.addColorStop(0,   `rgba(${color},0)`);
  g.addColorStop(0.5, `rgba(${color},${Math.min(a,0.6)})`);
  g.addColorStop(1,   `rgba(${color},0)`);
  ctx.beginPath(); ctx.arc(CX, CY, RING_R, 0, Math.PI*2);
  ctx.strokeStyle = g; ctx.lineWidth = 30; ctx.stroke();

  ctx.beginPath(); ctx.arc(CX, CY, RING_R, 0, Math.PI*2);
  ctx.strokeStyle = f > 0 ? `rgba(${color},0.18)` : "rgba(10,40,60,0.4)";
  ctx.lineWidth = 1.5; ctx.stroke();
}

function drawDipoles() {
  const N = 16, active = vis.energyTev > 0;
  const fieldFrac = Math.min(vis.magnetT / 8.33, 1);
  for (let i = 0; i < N; i++) {
    const a = (i/N) * Math.PI * 2;
    // Vibração na catástrofe
    const vibX = vis.catastrophePhase >= 1 ? (Math.random()-0.5) * vis.catastropheTimer * 1.5 : 0;
    const vibY = vis.catastrophePhase >= 1 ? (Math.random()-0.5) * vis.catastropheTimer * 1.5 : 0;
    ctx.save();
    ctx.translate(CX + Math.cos(a)*RING_R + vibX, CY + Math.sin(a)*RING_R + vibY);
    ctx.rotate(a + Math.PI/2);
    // Cor muda para vermelho na catástrofe
    const dipoleColor = vis.catastrophePhase >= 1 ? "rgba(80,0,0,0.92)" : (active ? "rgba(0,50,80,0.92)" : "rgba(8,20,30,0.6)");
    ctx.fillStyle   = dipoleColor;
    ctx.strokeStyle = active ? "#0a4a6a" : "#041018";
    ctx.lineWidth   = 0.8;
    ctx.fillRect(-9,-5,18,10); ctx.strokeRect(-9,-5,18,10);
    if (active) {
      const innerColor = vis.catastrophePhase >= 1 ? `rgba(255,60,0,${0.2 + fieldFrac*0.6})` : `rgba(0,200,255,${0.1 + fieldFrac*0.45})`;
      ctx.fillStyle = innerColor;
      ctx.fillRect(-7,-3,14,6);
    }
    ctx.restore();
  }
}

function drawDetectorPoints() {
  Object.entries(DET_ANGLES).forEach(([name, angle]) => {
    const ix = CX + Math.cos(angle)*RING_R;
    const iy = CY + Math.sin(angle)*RING_R;
    const col = vis.catastrophePhase >= 2 ? "#ff003c" : DET_COLORS[name];
    const colliding = vis.state === "COLLIDING";

    ctx.beginPath(); ctx.arc(ix, iy, 6, 0, Math.PI*2);
    ctx.fillStyle = colliding ? col : "rgba(20,60,80,0.5)";
    ctx.shadowColor = col; ctx.shadowBlur = colliding ? (12 + vis.catastrophePhase * 20) : 0;
    ctx.fill(); ctx.shadowBlur = 0;

    if (colliding) {
      const pulse = 6 + Math.sin(vis.frame*0.13 + angle)*4;
      ctx.beginPath(); ctx.arc(ix, iy, pulse, 0, Math.PI*2);
      ctx.strokeStyle = col.replace(")", ",0.3)").replace("rgb","rgba");
      ctx.lineWidth = 1.5; ctx.stroke();
    }

    ctx.font = "9px 'Share Tech Mono'";
    ctx.fillStyle = colliding ? col : "rgba(50,100,120,0.6)";
    ctx.textAlign = "center";
    const lx = CX + Math.cos(angle)*(RING_R + 22);
    const ly = CY + Math.sin(angle)*(RING_R + 22) + 4;
    ctx.fillText(name, lx, ly);
  });
}

function drawParticles() {
  const f = Math.min(vis.energyTev / 6.8, 1);
  const speedMult   = 0.4 + Math.pow(f, 1.5) * 40.0;
  const maxTrail    = Math.round(6 + f * 300);
  const coreOpacity = Math.max(0, 1 - (f - 0.3) / 0.3);
  const trailW      = 0.5 + f * 3.5;
  const trailAlpha  = 0.35 + f * 0.65;

  vis.particles.forEach(p => {
    // Velocidade aumenta caoticamente na catástrofe
    const catSpeedBoost = vis.catastrophePhase >= 1 ? 1 + vis.catastropheTimer * 2 : 1;
    p.angle += p.speed * p.dir * speedMult * catSpeedBoost;

    // Distorção radial do anel na catástrofe
    const radDistort = vis.catastrophePhase >= 1
      ? p.r + Math.sin(vis.frame * 0.3 + p.angle * 5) * vis.catastropheTimer * 8
      : p.r;

    const px = CX + Math.cos(p.angle)*radDistort;
    const py = CY + Math.sin(p.angle)*radDistort;
    p.trail.push({x:px, y:py});
    if (p.trail.length > maxTrail) p.trail.shift();

    // Cor muda para vermelho na catástrofe
    const trailColor = vis.catastrophePhase >= 2
      ? p.color.replace("#00f5ff","#ff4400").replace("#ff6b00","#ff0000")
      : p.color;

    for (let i = 1; i < p.trail.length; i++) {
      const t = i / p.trail.length;
      ctx.beginPath();
      ctx.moveTo(p.trail[i-1].x, p.trail[i-1].y);
      ctx.lineTo(p.trail[i].x,   p.trail[i].y);
      ctx.strokeStyle = trailColor.replace(")", `,${t*trailAlpha})`).replace("rgb","rgba").replace("#","rgba(").replace(/^rgba\(([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2}),/, (m,r,g,b) => `rgba(${parseInt(r,16)},${parseInt(g,16)},${parseInt(b,16)},`);
      ctx.lineWidth   = trailW * t;
      ctx.stroke();
    }
    if (coreOpacity > 0.02) {
      ctx.beginPath(); ctx.arc(px, py, p.size, 0, Math.PI*2);
      const coreColor = vis.catastrophePhase >= 2 ? "#ff4400" : p.color;
      ctx.fillStyle   = `${coreColor}${Math.round(coreOpacity*255).toString(16).padStart(2,'0')}`;
      ctx.shadowColor = coreColor; ctx.shadowBlur = 10 + vis.energyTev*2 + vis.catastrophePhase * 15;
      ctx.fill(); ctx.shadowBlur = 0;
    }
  });
}

function drawSparks() {
  vis.sparks = vis.sparks.filter(s => s.life > 0);
  vis.sparks.forEach(s => {
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r*s.life, 0, Math.PI*2);
    const alpha = Math.round(s.life * 255).toString(16).padStart(2,'0');
    ctx.fillStyle = s.color + alpha;
    ctx.fill();
    s.x += s.vx; s.y += s.vy; s.vx *= 0.95; s.vy *= 0.95; s.life -= s.decay;
  });
}

function drawShockwaves() {
  vis.shockwaves = vis.shockwaves.filter(s => s.life > 0);
  vis.shockwaves.forEach(s => {
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI*2);
    const color = s.catastrophic ? "255,80,0" : "255,160,0";
    ctx.strokeStyle = `rgba(${color},${s.life*0.6})`; 
    ctx.lineWidth = s.catastrophic ? 4 : 2; 
    ctx.stroke();
    s.r += s.catastrophic ? 8 : 5; 
    s.life -= 0.028;
  });
}

function drawPlasmaRings() {
  vis.plasmaRings = vis.plasmaRings.filter(r => r.life > 0);
  vis.plasmaRings.forEach(r => {
    ctx.beginPath(); ctx.arc(CX, CY, r.r, 0, Math.PI*2);
    ctx.strokeStyle = r.color.replace(")", `,${r.life})`).replace("hsl","hsla");
    ctx.lineWidth = 3 * r.life;
    ctx.shadowColor = r.color;
    ctx.shadowBlur = 20 * r.life;
    ctx.stroke();
    ctx.shadowBlur = 0;
    r.r += r.speed;
    r.life -= 0.015;
  });
}

function drawFlashes() {
  vis.flashes = vis.flashes.filter(f => f.life > 0);
  vis.flashes.forEach(f => {
    if (f.white) {
      ctx.fillStyle = `rgba(255,255,255,${f.life*0.4})`;
    } else {
      ctx.fillStyle = `rgba(255,200,50,${f.life*0.1})`;
    }
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    f.life -= f.white ? 0.03 : 0.06;
  });
}

function drawCenter() {
  const catColor = vis.catastrophePhase >= 2 ? "255,0,60" : "0,245,255";

  ctx.beginPath(); ctx.arc(CX, CY, 68, 0, Math.PI*2);
  ctx.fillStyle = `rgba(${catColor},0.03)`; ctx.fill();
  ctx.strokeStyle = `rgba(${catColor},0.07)`; ctx.lineWidth = 1; ctx.stroke();

  ctx.font = "bold 22px 'Share Tech Mono'";
  ctx.fillStyle = vis.catastrophePhase >= 1 ? `rgba(255,60,0,0.8)` : "rgba(0,245,255,0.3)";
  ctx.textAlign = "center"; ctx.fillText("LHC", CX, CY-6);

  ctx.font = "10px 'Share Tech Mono'";
  ctx.fillStyle = vis.catastrophePhase >= 1 ? `rgba(255,0,60,0.9)` : "rgba(0,180,200,0.45)";
  ctx.fillText(vis.catastrophePhase >= 2 ? "FAULT" : vis.state, CX, CY+10);

  const frac = Math.min(vis.energyTev/6.8, 1);
  if (frac > 0) {
    ctx.beginPath(); ctx.arc(CX, CY, 52, -Math.PI/2, -Math.PI/2 + frac*Math.PI*2);
    ctx.strokeStyle = `rgba(${catColor},${0.2+frac*0.5})`; ctx.lineWidth = 2.5; ctx.stroke();
  }

  if (vis.luminosity > 0) {
    const lf = Math.min(vis.luminosity / 1.5e34, 1);
    ctx.beginPath(); ctx.arc(CX, CY, 46, -Math.PI/2, -Math.PI/2 + lf*Math.PI*2);
    ctx.strokeStyle = `rgba(0,255,136,${0.15+lf*0.4})`; ctx.lineWidth = 2; ctx.stroke();
  }
}

function drawQuenchWarning() {
  if (vis.quenchRisk < 0.5) return;
  const alpha = (vis.quenchRisk - 0.5) * 2;
  const pulse = Math.sin(vis.frame * 0.2) * 0.5 + 0.5;
  ctx.strokeStyle = `rgba(255,0,60,${alpha * pulse * 0.4})`;
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(CX, CY, RING_R + 18, 0, Math.PI*2); ctx.stroke();
}

function drawCatastropheEffect() {
  if (vis.catastrophePhase < 1) return;

  vis.catastropheTimer += 0.016;

  // Scan lines de falha
  if (vis.catastrophePhase >= 1 && Math.random() < 0.3) {
    const y = Math.random() * canvas.height;
    const h = 1 + Math.random() * 4;
    ctx.fillStyle = `rgba(255,0,60,${0.1 + Math.random() * 0.15})`;
    ctx.fillRect(0, y, canvas.width, h);
  }

  // Ruído de pixel na catástrofe
  if (vis.catastrophePhase >= 2) {
    for (let i = 0; i < 40; i++) {
      const px = Math.random() * canvas.width;
      const py = Math.random() * canvas.height;
      const sz = 1 + Math.random() * 3;
      const colors = ["#ff003c","#ff6b00","#ffffff","#00f5ff"];
      ctx.fillStyle = colors[Math.floor(Math.random()*colors.length)];
      ctx.globalAlpha = Math.random() * 0.6;
      ctx.fillRect(px, py, sz, sz);
      ctx.globalAlpha = 1;
    }
  }
}

// ── Mini gráficos ─────────────────────────────────────────────────────────────
function drawChart(canvasId, data, color, maxVal) {
  const c = document.getElementById(canvasId);
  if (!c || data.length < 2) return;
  const cx = c.getContext("2d");
  const W = c.width, H = c.height;
  cx.clearRect(0, 0, W, H);

  const max = maxVal || Math.max(...data, 1);
  const step = W / (data.length - 1);

  cx.beginPath();
  cx.moveTo(0, H);
  data.forEach((v, i) => cx.lineTo(i*step, H - (v/max)*H*0.9));
  cx.lineTo((data.length-1)*step, H);
  cx.closePath();
  cx.fillStyle = color.replace(")", ",0.08)").replace("rgb","rgba");
  cx.fill();

  cx.beginPath();
  data.forEach((v, i) => {
    const x = i*step, y = H - (v/max)*H*0.9;
    i === 0 ? cx.moveTo(x,y) : cx.lineTo(x,y);
  });
  cx.strokeStyle = color; cx.lineWidth = 1.5; cx.stroke();

  cx.font = "9px 'Share Tech Mono'";
  cx.fillStyle = color; cx.textAlign = "right";
  cx.fillText(data[data.length-1], W-4, 12);
}

// ── Polling ───────────────────────────────────────────────────────────────────
async function pollStatus() {
  try {
    const res  = await fetch("/api/status");
    const data = await res.json();
    applyBackendState(data);
  } catch (e) {
    console.warn("Polling falhou:", e);
  }
  setTimeout(pollStatus, 400);
}

function applyBackendState(d) {
  vis.state          = d.state;
  vis.energyTev      = d.energy_tev;
  vis.magnetT        = d.magnetic_field_t;
  vis.gamma          = d.gamma;
  vis.luminosity     = d.luminosity;
  vis.collisionRate  = d.collision_rate;
  vis.totalCollisions= d.total_collisions;
  vis.nBunches       = d.n_bunches;
  vis.quenchRisk     = d.quench_risk || 0;
  vis.detectors      = d.detectors || {};

  syncParticles(d.n_bunches);
  updateTelemetry(d);
  updateDetectors(d.detectors || {});
  updateLog(d.log || []);
  updateAlarms(d.alarms || []);
  updateStatusDots(d);
  updateCharts(d);
}

// ── Telemetria ────────────────────────────────────────────────────────────────
const fmt  = (v, d=2) => v !== undefined ? Number(v).toFixed(d) : "—";
const fmtB = n => Number(n||0).toLocaleString("pt-BR");
const toSci = n => {
  if (!n || n === 0) return "0";
  const e = Math.floor(Math.log10(n));
  return `${(n/10**e).toFixed(2)}×10^${e}`;
};

function updateTelemetry(d) {
  setMeter("energy",    fmt(d.energy_tev),       d.energy_tev/6.8);
  setMeter("ecm",       fmt(d.energy_tev * 2),   d.energy_tev/6.8);
  setMeter("gamma",     fmt(d.gamma,0),           Math.min(d.gamma/7500,1));
  setMeter("beta",      fmt(d.beta,6),            d.beta);
  setMeter("magnetic",  fmt(d.magnetic_field_t),  d.magnetic_field_t/8.33);
  setMeter("temp",      fmt(d.cryo_temp_k||1.9,3),(Math.min((d.cryo_temp_k||1.9)-1.9,3)/3), "danger");
  setMeter("current",   fmt((d.n_bunches||0)*0.58,1), Math.min((d.n_bunches||0)/2556,1));
  setMeter("synrad",    fmt((d.synchrotron_loss_gev||0)*1e6,1), 0);
  setMeter("lumi",      toSci(d.luminosity),      Math.min((d.luminosity||0)/1.5e34,1));
  setMeter("pileup",    fmt((d.luminosity||0)/1e30,1), 0);
  setMeter("coll",      fmtB(Math.round(d.collision_rate||0)), Math.min((d.collision_rate||0)/9e8,1));
  setMeter("total",     fmtB(d.total_collisions), 0);
  setMeter("intlumi",   fmt(d.integrated_lumi_fb,4), 0);
  setMeter("bunches",   fmtB(d.n_bunches),        Math.min((d.n_bunches||0)/2556,1));
  setMeter("emittance", fmt(d.emittance_um,2),    Math.min((d.emittance_um||3.75)/8,1));
  setMeter("tune",      `${(64.28+(Math.random()-0.5)*0.01).toFixed(2)} / ${(59.32+(Math.random()-0.5)*0.01).toFixed(2)}`, 0);

  const badge = document.getElementById("state-badge");
  if (badge) { badge.textContent = d.state; badge.className = "state-badge state-" + d.state.toLowerCase(); }

  const up = d.uptime_s || 0;
  const upEl = document.getElementById("uptime");
  if (upEl) upEl.textContent = "UP: " + [
    Math.floor(up/3600), Math.floor((up%3600)/60), Math.floor(up%60)
  ].map(n=>String(n).padStart(2,"0")).join(":");

  const fn = document.getElementById("fill-number");
  if (fn) fn.textContent = `FILL #${d.fill_count || 1}`;
}

function setMeter(id, val, frac=0, colorMode="") {
  const vEl = document.getElementById(`m-${id}-val`);
  const bEl = document.getElementById(`m-${id}-bar`);
  if (vEl) vEl.textContent = val;
  if (bEl) {
    bEl.style.width = Math.min(frac*100,100) + "%";
    if (colorMode === "danger") {
      bEl.style.background = frac > 0.7 ? "var(--danger)" : frac > 0.4 ? "var(--hot)" : "var(--accent)";
    } else if (colorMode === "inv") {
      bEl.style.background = frac > 0.7 ? "var(--danger)" : frac > 0.4 ? "var(--hot)" : "var(--green)";
    }
  }
}

// ── Detectores ────────────────────────────────────────────────────────────────
function updateDetectors(dets) {
  ["IP1","IP5","IP2","IP8"].forEach(ip => {
    const card = document.getElementById(`det-${ip}`);
    const name = {IP1:"ATLAS",IP5:"CMS",IP2:"ALICE",IP8:"LHCb"}[ip];
    const d = dets[name] || dets[ip] || {};
    if (card) {
      card.classList.toggle("det-active", !!d.active);
      card.classList.toggle("det-inactive", !d.active);
    }
    const lumiEl = card && card.querySelector(".det-lumi");
    if (lumiEl) lumiEl.textContent = d.active
      ? `L: ${toSci(vis.luminosity / 4)} cm⁻²s⁻¹`
      : "—";
    const pileupEl = card && card.querySelector(".det-pileup");
    if (pileupEl) pileupEl.textContent = d.active
      ? `μ ≈ ${((vis.luminosity||0)/1e30/4).toFixed(1)}`
      : "";
    const intEl = card && card.querySelector(".det-intlumi");
    if (intEl) intEl.textContent = d.integrated_lumi
      ? `∫L = ${d.integrated_lumi.toFixed(4)} fb⁻¹` : "";
  });
}

// ── Log ───────────────────────────────────────────────────────────────────────
let _lastLogLen = 0;
function updateLog(lines) {
  if (lines.length === _lastLogLen) return;
  _lastLogLen = lines.length;
  const c = document.getElementById("log-container");
  if (!c) return;
  c.innerHTML = "";
  lines.slice(-30).reverse().forEach(line => {
    const d = document.createElement("div");
    d.className = "log-line";
    if (line.includes("[CRITICAL]")) d.classList.add("log-critical");
    else if (line.includes("[WARNING]")) d.classList.add("log-warning");
    else if (line.includes("✓") || line.includes("nominal")) d.classList.add("log-ok");
    else d.classList.add("log-info");
    d.textContent = line;
    c.appendChild(d);
  });
}

// ── Alarmes ───────────────────────────────────────────────────────────────────
let _lastAlarmCode = "";
function updateAlarms(alarms) {
  const panel = document.getElementById("alarm-panel");
  const badge = document.getElementById("alarm-count");
  if (!panel) return;

  const active = alarms.filter(a => a.severity !== "INFO");
  if (badge) badge.textContent = active.length > 0 ? active.length : "";

  if (alarms.length === 0) {
    panel.innerHTML = '<div class="alarm-ok">✓ SEM ALARMES ATIVOS</div>';
    return;
  }

  const last5 = alarms.slice(-5).reverse();
  panel.innerHTML = "";
  last5.forEach(a => {
    const el = document.createElement("div");
    el.className = `alarm-item alarm-${a.severity.toLowerCase()}`;
    el.textContent = `[${a.code}] ${a.message}`;
    panel.appendChild(el);
  });
}

// ── Status dots ───────────────────────────────────────────────────────────────
function updateStatusDots(d) {
  setDot("dot-cryo",   true);
  setDot("dot-beam",   d.state !== "IDLE");
  setDot("dot-stable", d.state === "STABLE" || d.state === "COLLIDING");
  setDot("dot-coll",   d.state === "COLLIDING");
  setDot("dot-fault",  d.state === "FAULT" || vis.catastrophePhase >= 2);
}
function setDot(id, on) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = "dot " + (on ? "dot-active" : "dot-inactive");
  if (id === "dot-fault" && on) el.style.background = "var(--danger)";
}

// ── Charts ────────────────────────────────────────────────────────────────────
function updateCharts(d) {
  if (d.energy_history && d.energy_history.length > 1)
    drawChart("energy-chart", d.energy_history, "#00f5ff", 6.8);
  if (d.lumi_history && d.lumi_history.length > 1)
    drawChart("lumi-chart", d.lumi_history, "#00ff88");
}

// ── Detectores toggle ─────────────────────────────────────────────────────────
window.toggleDet = function(ip) {
  fetch(`/api/command/toggle_detector`, {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ip})
  }).catch(() => {});
};

// ── Comandos ─────────────────────────────────────────────────────────────────
async function sendCommand(cmd, body={}) {
  try {
    const r = await fetch(`/api/command/${cmd}`, {
      method: "POST", headers: {"Content-Type":"application/json"},
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!d.success) console.warn(`Comando '${cmd}' falhou:`, d.message);
    return d;
  } catch(e) { console.error("Erro:", e); }
}

window.cmdInject     = () => sendCommand("inject", {n_bunches:2556});
window.cmdAccelerate = () => sendCommand("accelerate");
window.cmdDump       = () => sendCommand("dump");

// ── COLLIDE — dispara sequência catastrófica ──────────────────────────────────
window.cmdCollide = async () => {
  const res = await sendCommand("collide");
  if (res && res.success) {
    // 8 segundos de colisão normal, depois catástrofe
    setTimeout(() => {
      triggerCatastrophe();
    }, 8000);
  }
};

// Atalhos de teclado
document.addEventListener("keydown", e => {
  if (e.key === "1") cmdInject();
  if (e.key === "2") cmdAccelerate();
  if (e.key === "3") cmdCollide();
  if (e.key === "4") cmdDump();
});

// ── Boot ──────────────────────────────────────────────────────────────────────
pollStatus();
render();
