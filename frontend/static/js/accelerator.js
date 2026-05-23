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
  }
}

function checkCollisions() {
  if (vis.state !== "COLLIDING" || vis.frame % 2 !== 0) return;
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

// ── RENDER ────────────────────────────────────────────────────────────────────
function render() {
  ctx.fillStyle = "rgba(2,4,10,0.80)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  drawRingGlow();
  drawDipoles();
  drawDetectorPoints();
  drawParticles();
  drawSparks();
  drawShockwaves();
  drawFlashes();
  drawCenter();
  drawQuenchWarning();

  checkCollisions();
  vis.frame++;
  requestAnimationFrame(render);
}

function drawRingGlow() {
  const f = Math.min(vis.energyTev / 6.8, 1);
  const a = 0.05 + f * 0.2;
  const g = ctx.createRadialGradient(CX, CY, RING_R-14, CX, CY, RING_R+14);
  g.addColorStop(0,   "rgba(0,245,255,0)");
  g.addColorStop(0.5, `rgba(0,245,255,${a})`);
  g.addColorStop(1,   "rgba(0,245,255,0)");
  ctx.beginPath(); ctx.arc(CX, CY, RING_R, 0, Math.PI*2);
  ctx.strokeStyle = g; ctx.lineWidth = 30; ctx.stroke();

  ctx.beginPath(); ctx.arc(CX, CY, RING_R, 0, Math.PI*2);
  ctx.strokeStyle = f > 0 ? "rgba(0,245,255,0.18)" : "rgba(10,40,60,0.4)";
  ctx.lineWidth = 1.5; ctx.stroke();
}

function drawDipoles() {
  const N = 16, active = vis.energyTev > 0;
  const fieldFrac = Math.min(vis.magnetT / 8.33, 1);
  for (let i = 0; i < N; i++) {
    const a = (i/N) * Math.PI * 2;
    ctx.save();
    ctx.translate(CX + Math.cos(a)*RING_R, CY + Math.sin(a)*RING_R);
    ctx.rotate(a + Math.PI/2);
    ctx.fillStyle   = active ? "rgba(0,50,80,0.92)"  : "rgba(8,20,30,0.6)";
    ctx.strokeStyle = active ? "#0a4a6a" : "#041018";
    ctx.lineWidth   = 0.8;
    ctx.fillRect(-9,-5,18,10); ctx.strokeRect(-9,-5,18,10);
    if (active) {
      ctx.fillStyle = `rgba(0,200,255,${0.1 + fieldFrac*0.45})`;
      ctx.fillRect(-7,-3,14,6);
    }
    ctx.restore();
  }
}

function drawDetectorPoints() {
  Object.entries(DET_ANGLES).forEach(([name, angle]) => {
    const ix = CX + Math.cos(angle)*RING_R;
    const iy = CY + Math.sin(angle)*RING_R;
    const col = DET_COLORS[name];
    const colliding = vis.state === "COLLIDING";

    ctx.beginPath(); ctx.arc(ix, iy, 6, 0, Math.PI*2);
    ctx.fillStyle = colliding ? col : "rgba(20,60,80,0.5)";
    ctx.shadowColor = col; ctx.shadowBlur = colliding ? 12 : 0;
    ctx.fill(); ctx.shadowBlur = 0;

    if (colliding) {
      const pulse = 6 + Math.sin(vis.frame*0.13 + angle)*4;
      ctx.beginPath(); ctx.arc(ix, iy, pulse, 0, Math.PI*2);
      ctx.strokeStyle = col.replace(")", ",0.3)").replace("rgb","rgba");
      ctx.lineWidth = 1.5; ctx.stroke();
    }

    // Label
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
  const speedMult   = 0.5 + f * 9.0;
  const maxTrail    = Math.round(8 + f * 130);
  const coreOpacity = Math.max(0, 1 - (f - 0.55) / 0.45);
  const trailW      = 0.7 + f * 2.8;
  const trailAlpha  = 0.45 + f * 0.55;

  vis.particles.forEach(p => {
    p.angle += p.speed * p.dir * speedMult;
    const px = CX + Math.cos(p.angle)*p.r;
    const py = CY + Math.sin(p.angle)*p.r;
    p.trail.push({x:px, y:py});
    if (p.trail.length > maxTrail) p.trail.shift();

    for (let i = 1; i < p.trail.length; i++) {
      const t = i / p.trail.length;
      ctx.beginPath();
      ctx.moveTo(p.trail[i-1].x, p.trail[i-1].y);
      ctx.lineTo(p.trail[i].x,   p.trail[i].y);
      ctx.strokeStyle = p.color.replace(")", `,${t*trailAlpha})`).replace("rgb","rgba");
      ctx.lineWidth   = trailW * t;
      ctx.stroke();
    }
    if (coreOpacity > 0.02) {
      ctx.beginPath(); ctx.arc(px, py, p.size, 0, Math.PI*2);
      ctx.fillStyle   = p.color.replace(")", `,${coreOpacity})`).replace("rgb","rgba");
      ctx.shadowColor = p.color; ctx.shadowBlur = 10 + vis.energyTev*2;
      ctx.fill(); ctx.shadowBlur = 0;
    }
  });
}

function drawSparks() {
  vis.sparks = vis.sparks.filter(s => s.life > 0);
  vis.sparks.forEach(s => {
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r*s.life, 0, Math.PI*2);
    ctx.fillStyle = s.color.replace(")", `,${s.life})`).replace("rgb","rgba");
    ctx.fill();
    s.x += s.vx; s.y += s.vy; s.vx *= 0.95; s.vy *= 0.95; s.life -= s.decay;
  });
}

function drawShockwaves() {
  vis.shockwaves = vis.shockwaves.filter(s => s.life > 0);
  vis.shockwaves.forEach(s => {
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI*2);
    ctx.strokeStyle = `rgba(255,160,0,${s.life*0.5})`; ctx.lineWidth = 2; ctx.stroke();
    s.r += 5; s.life -= 0.028;
  });
}

function drawFlashes() {
  vis.flashes = vis.flashes.filter(f => f.life > 0);
  vis.flashes.forEach(f => {
    ctx.fillStyle = `rgba(255,200,50,${f.life*0.1})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    f.life -= 0.06;
  });
}

function drawCenter() {
  ctx.beginPath(); ctx.arc(CX, CY, 68, 0, Math.PI*2);
  ctx.fillStyle = "rgba(0,245,255,0.03)"; ctx.fill();
  ctx.strokeStyle = "rgba(0,245,255,0.07)"; ctx.lineWidth = 1; ctx.stroke();

  ctx.font = "bold 22px 'Share Tech Mono'";
  ctx.fillStyle = "rgba(0,245,255,0.3)";
  ctx.textAlign = "center"; ctx.fillText("LHC", CX, CY-6);

  ctx.font = "10px 'Share Tech Mono'";
  ctx.fillStyle = "rgba(0,180,200,0.45)";
  ctx.fillText(vis.state, CX, CY+10);

  // Energia como arco
  const frac = Math.min(vis.energyTev/6.8, 1);
  if (frac > 0) {
    ctx.beginPath(); ctx.arc(CX, CY, 52, -Math.PI/2, -Math.PI/2 + frac*Math.PI*2);
    ctx.strokeStyle = `rgba(0,245,255,${0.2+frac*0.5})`; ctx.lineWidth = 2.5; ctx.stroke();
  }

  // Luminosidade como arco verde
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

// ── Mini gráficos ─────────────────────────────────────────────────────────────
function drawChart(canvasId, data, color, maxVal) {
  const c = document.getElementById(canvasId);
  if (!c || data.length < 2) return;
  const cx = c.getContext("2d");
  const W = c.width, H = c.height;
  cx.clearRect(0, 0, W, H);

  const max = maxVal || Math.max(...data, 1);
  const step = W / (data.length - 1);

  // Área preenchida
  cx.beginPath();
  cx.moveTo(0, H);
  data.forEach((v, i) => cx.lineTo(i*step, H - (v/max)*H*0.9));
  cx.lineTo((data.length-1)*step, H);
  cx.closePath();
  cx.fillStyle = color.replace(")", ",0.08)").replace("rgb","rgba");
  cx.fill();

  // Linha
  cx.beginPath();
  data.forEach((v, i) => {
    const x = i*step, y = H - (v/max)*H*0.9;
    i === 0 ? cx.moveTo(x,y) : cx.lineTo(x,y);
  });
  cx.strokeStyle = color; cx.lineWidth = 1.5; cx.stroke();

  // Valor atual
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
  setMeter("gamma",     fmt(d.gamma,0),           Math.min(d.gamma/7500,1));
  setMeter("beta",      fmt(d.beta,6),            d.beta);
  setMeter("magnetic",  fmt(d.magnetic_field_t),  d.magnetic_field_t/8.33);
  setMeter("rf",        fmt(d.rf_voltage_mv,1),   (d.rf_voltage_mv||0)/16);
  setMeter("emit",      fmt(d.emittance_um,2),    Math.min(d.emittance_um/8,1), "inv");
  setMeter("intensity", `${((d.beam_intensity||1)*100).toFixed(1)}%`, d.beam_intensity||1, "inv");
  setMeter("lifetime",  d.beam_lifetime_h > 0 ? fmt(d.beam_lifetime_h,1) : "—", 0);
  setMeter("lumi",      toSci(d.luminosity),      Math.min((d.luminosity||0)/1.5e34,1));
  setMeter("coll",      fmtB(Math.round(d.collision_rate||0)), Math.min((d.collision_rate||0)/9e8,1));
  setMeter("sigma",     fmt(d.cross_section_mb,1), 0);
  setMeter("intlumi",   fmt(d.integrated_lumi_fb,4), 0);
  setMeter("totlumi",   fmt(d.total_integrated_lumi_fb,4), 0);
  setMeter("total",     fmtB(d.total_collisions), 0);

  // Temperatura
  const tempK = d.cryo_temp_k || 1.9;
  const tempFrac = Math.min((tempK - 1.9) / 3, 1);
  setMeter("temp", fmt(tempK,3), tempFrac, "danger");

  // Quench
  const qr = (d.quench_risk||0) * 100;
  const qEl = document.getElementById("m-quench-val");
  const qBar = document.getElementById("m-quench-bar");
  if (qEl) qEl.textContent = fmt(qr,1) + "%";
  if (qBar) {
    qBar.style.width = Math.min(qr,100) + "%";
    qBar.style.background = qr > 70 ? "var(--danger)" : qr > 40 ? "var(--hot)" : "var(--green)";
  }

  // State badge
  const badge = document.getElementById("state-badge");
  if (badge) { badge.textContent = d.state; badge.className = "state-badge state-" + d.state.toLowerCase(); }

  // Fill e uptime
  const fc = document.getElementById("fill-count");
  if (fc) fc.textContent = d.fill_count || 0;
  const up = d.uptime_s || 0;
  const upEl = document.getElementById("uptime");
  if (upEl) upEl.textContent = [
    Math.floor(up/3600), Math.floor((up%3600)/60), Math.floor(up%60)
  ].map(n=>String(n).padStart(2,"0")).join(":");
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
      // Inverte: mais = pior
      bEl.style.background = frac > 0.7 ? "var(--danger)" : frac > 0.4 ? "var(--hot)" : "var(--green)";
      bEl.style.width = Math.min(frac*100,100) + "%";
    }
  }
}

// ── Detectores ────────────────────────────────────────────────────────────────
function updateDetectors(dets) {
  Object.entries(dets).forEach(([name, d]) => {
    const card = document.getElementById(`det-${name}`);
    if (card) card.classList.toggle("active", d.active);
    const ev = document.getElementById(`det-${name}-events`);
    if (ev) ev.textContent = fmtB(d.total_events);
    const last = document.getElementById(`det-${name}-last`);
    if (last) last.textContent = d.last_event || "—";
    const lumi = document.getElementById(`det-${name}-lumi`);
    if (lumi) lumi.textContent = `${(d.integrated_lumi||0).toFixed(4)} fb⁻¹`;
  });
}

// ── Log ───────────────────────────────────────────────────────────────────────
let _lastLogLen = 0;
function updateLog(lines) {
  if (lines.length === _lastLogLen) return;
  _lastLogLen = lines.length;
  const c = document.getElementById("log-container");
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
  const bar = document.getElementById("alarm-bar");
  if (!bar || alarms.length === 0) { bar && bar.classList.add("hidden"); return; }
  const last = alarms[alarms.length - 1];
  if (last.code === _lastAlarmCode) return;
  _lastAlarmCode = last.code;
  bar.textContent = `⚠ [${last.code}] ${last.message}`;
  bar.className   = "alarm-bar" + (last.severity === "CRITICAL" ? "" : " warn");
  bar.classList.remove("hidden");
  setTimeout(() => bar.classList.add("hidden"), 6000);
}

// ── Status dots ───────────────────────────────────────────────────────────────
function updateStatusDots(d) {
  setDot("dot-cryo",   true);
  setDot("dot-beam",   d.state !== "IDLE");
  setDot("dot-stable", d.state === "STABLE" || d.state === "COLLIDING");
  setDot("dot-coll",   d.state === "COLLIDING");
}
function setDot(id, on) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = "dot " + (on ? "dot-active" : "dot-inactive");
}

// ── Charts ────────────────────────────────────────────────────────────────────
function updateCharts(d) {
  if (d.energy_history && d.energy_history.length > 1)
    drawChart("chart-energy", d.energy_history, "#00f5ff", 6.8);
  if (d.lumi_history && d.lumi_history.length > 1)
    drawChart("chart-lumi", d.lumi_history, "#00ff88");
}

// ── Comandos ─────────────────────────────────────────────────────────────────
async function sendCommand(cmd, body={}) {
  try {
    const r = await fetch(`/api/command/${cmd}`, {
      method: "POST", headers: {"Content-Type":"application/json"},
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!d.success) console.warn(`Comando '${cmd}' falhou:`, d.message);
  } catch(e) { console.error("Erro:", e); }
}

window.cmdInject     = () => sendCommand("inject",     {n_bunches:2556});
window.cmdAccelerate = () => sendCommand("accelerate");
window.cmdCollide    = () => sendCommand("collide");
window.cmdDump       = () => sendCommand("dump");

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
