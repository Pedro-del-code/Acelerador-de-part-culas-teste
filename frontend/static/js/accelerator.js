/**
 * accelerator.js — Renderizador e cliente SSE do frontend
 * =========================================================
 *
 * Responsabilidades:
 *   1. Conectar ao stream SSE do backend e receber o estado em tempo real
 *   2. Renderizar o anel, partículas, colisões e efeitos no <canvas>
 *   3. Enviar comandos do operador para a API REST
 *   4. Atualizar os painéis de telemetria com os dados recebidos
 *
 * Arquitetura:
 *   ┌─────────────────────────────────────────────────────┐
 *   │  Backend (Python/Flask)                             │
 *   │    Accelerator.tick() → SSE stream → /api/stream   │
 *   └──────────────────┬──────────────────────────────────┘
 *                      │  EventSource (SSE)
 *   ┌──────────────────▼──────────────────────────────────┐
 *   │  Frontend (este arquivo)                            │
 *   │    onSSEMessage() → updateTelemetry() + render()   │
 *   └─────────────────────────────────────────────────────┘
 */

"use strict";

// ── Configuração do canvas ────────────────────────────────────────────────────

const canvas = document.getElementById("ring-canvas");
const ctx    = canvas.getContext("2d");

// Centro e raio visual do anel (em pixels)
const CX = canvas.width  / 2;
const CY = canvas.height / 2;
const RING_R = 200;   // raio do anel no canvas
const RING_W = 10;    // espessura visual do tubo

// ── Estado da visualização ───────────────────────────────────────────────────

/**
 * Estado local de renderização — separado do estado físico do backend.
 * O backend diz "energia = 4.2 TeV", o frontend decide como desenhar isso.
 */
const vis = {
  state:          "IDLE",
  energyTev:      0,
  magnetFieldT:   0,
  gamma:          1,
  luminosity:     0,
  collisionRate:  0,
  totalCollisions:0,
  nBunches:       0,

  // Partículas visuais (não têm física real — são puramente estéticas)
  particles: [],

  // Efeitos de colisão
  sparks:      [],
  shockwaves:  [],
  flashes:     [],

  frame: 0,
};

// ── Partículas visuais ───────────────────────────────────────────────────────

/**
 * Cria uma partícula visual que orbita o anel.
 *
 * @param {number} dir  +1 (horário) ou -1 (anti-horário)
 * @returns {Object}    Objeto de partícula para o loop de render
 */
function makeParticle(dir) {
  return {
    angle: Math.random() * Math.PI * 2,
    speed: 0.012 + Math.random() * 0.005,
    dir,
    trail: [],
    color: dir === 1 ? "#00f5ff" : "#ff6b00",
    r: RING_R + (Math.random() - 0.5) * RING_W * 0.4,
    size: 2.8,
  };
}

/**
 * Sincroniza a quantidade de partículas visuais com o estado do backend.
 * Adiciona ou remove partículas conforme n_bunches muda.
 *
 * @param {number} nBunches  Número de bunches por feixe (vindo do backend)
 */
function syncParticles(nBunches) {
  // Quantidade visual: proporcional ao log de bunches (não 1:1, seria muito)
  const target = nBunches > 0 ? Math.max(8, Math.round(Math.log10(nBunches + 1) * 10)) : 0;
  const currentBeam1 = vis.particles.filter(p => p.dir ===  1).length;
  const currentBeam2 = vis.particles.filter(p => p.dir === -1).length;

  // Adiciona partículas faltantes
  for (let i = currentBeam1; i < target; i++) vis.particles.push(makeParticle( 1));
  for (let i = currentBeam2; i < target; i++) vis.particles.push(makeParticle(-1));

  // Remove excesso (quando beam dump)
  if (nBunches === 0) vis.particles = [];
}

// ── Efeitos de colisão ───────────────────────────────────────────────────────

/**
 * Emite faíscas e ondas de choque em um ponto de colisão.
 *
 * @param {number} x    Coordenada x no canvas
 * @param {number} y    Coordenada y no canvas
 * @param {boolean} big  true = colisão de alta energia (mais efeitos)
 */
function spawnCollision(x, y, big) {
  const count = big ? 70 : 25;

  // Faíscas individuais
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = big ? 1 + Math.random() * 7 : 0.5 + Math.random() * 3;
    vis.sparks.push({
      x, y,
      vx:    Math.cos(angle) * speed,
      vy:    Math.sin(angle) * speed,
      life:  1.0,
      decay: 0.018 + Math.random() * 0.04,
      color: Math.random() < 0.5 ? "#00f5ff" : "#ff6b00",
      r:     big ? 2 + Math.random() * 3 : 1 + Math.random() * 2,
    });
  }

  // Onda de choque circular
  if (big) {
    vis.shockwaves.push({ x, y, r: 0, maxR: 140, life: 1.0 });
    vis.flashes.push({ life: 1.0 });
  }
}

// ── Pontos de interação (IPs) ────────────────────────────────────────────────

/** 4 pontos de colisão uniformemente espaçados ao redor do anel */
const INTERACTION_POINTS = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];

/** Verifica se duas partículas se cruzaram num ponto de interação */
function checkCollisions() {
  if (vis.state !== "COLLIDING") return;
  if (vis.frame % 2 !== 0) return; // só checa em frames pares (performance)

  const beam1 = vis.particles.filter(p => p.dir ===  1);
  const beam2 = vis.particles.filter(p => p.dir === -1);

  for (const a of beam1) {
    const ax = CX + Math.cos(a.angle) * a.r;
    const ay = CY + Math.sin(a.angle) * a.r;

    for (const b of beam2) {
      const bx = CX + Math.cos(b.angle) * b.r;
      const by = CY + Math.sin(b.angle) * b.r;
      const dist = Math.hypot(ax - bx, ay - by);

      if (dist < 14) {
        spawnCollision((ax + bx) / 2, (ay + by) / 2, vis.energyTev > 4);
      }
    }
  }
}

// ── Loop de renderização ─────────────────────────────────────────────────────

/**
 * Função principal de draw — chamada a ~60fps pelo requestAnimationFrame.
 * Limpa o canvas e redesenha tudo do zero a cada frame.
 */
function render() {
  // Fundo com leve trail (não limpa 100% → efeito de rastro)
  ctx.fillStyle = "rgba(2, 4, 10, 0.82)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  drawRingGlow();
  drawDipoleMagnets();
  drawInteractionPoints();
  drawParticles();
  drawSparks();
  drawShockwaves();
  drawFlashes();
  drawCenterLabel();

  checkCollisions();

  vis.frame++;
  requestAnimationFrame(render);
}

// ── Funções de desenho ───────────────────────────────────────────────────────

function drawRingGlow() {
  const energyFrac = Math.min(vis.energyTev / 6.8, 1);
  const alpha = 0.06 + energyFrac * 0.18;

  // Halo externo do anel
  const grad = ctx.createRadialGradient(CX, CY, RING_R - 14, CX, CY, RING_R + 14);
  grad.addColorStop(0,   `rgba(0,245,255,0)`);
  grad.addColorStop(0.5, `rgba(0,245,255,${alpha})`);
  grad.addColorStop(1,   `rgba(0,245,255,0)`);

  ctx.beginPath();
  ctx.arc(CX, CY, RING_R, 0, Math.PI * 2);
  ctx.strokeStyle = grad;
  ctx.lineWidth = 28;
  ctx.stroke();

  // Linha central do anel
  ctx.beginPath();
  ctx.arc(CX, CY, RING_R, 0, Math.PI * 2);
  ctx.strokeStyle = energyFrac > 0 ? "rgba(0,245,255,0.2)" : "rgba(10,40,60,0.5)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function drawDipoleMagnets() {
  /** 16 ímãs dipolares supercondutores distribuídos pelo anel */
  const N = 16;
  const active = vis.energyTev > 0;

  for (let i = 0; i < N; i++) {
    const angle = (i / N) * Math.PI * 2;
    const mx = CX + Math.cos(angle) * RING_R;
    const my = CY + Math.sin(angle) * RING_R;

    ctx.save();
    ctx.translate(mx, my);
    ctx.rotate(angle + Math.PI / 2);

    ctx.fillStyle   = active ? "rgba(0,50,80,0.9)"  : "rgba(8,20,30,0.6)";
    ctx.strokeStyle = active ? "#0a4a6a"             : "#041018";
    ctx.lineWidth   = 0.8;
    ctx.fillRect(-9, -5, 18, 10);
    ctx.strokeRect(-9, -5, 18, 10);

    // Indicador de campo (brilha com a intensidade do campo)
    if (active) {
      const fieldFrac = Math.min(vis.magnetFieldT / 8.33, 1);
      ctx.fillStyle = `rgba(0,200,255,${0.1 + fieldFrac * 0.4})`;
      ctx.fillRect(-7, -3, 14, 6);
    }

    ctx.restore();
  }
}

function drawInteractionPoints() {
  INTERACTION_POINTS.forEach((angle, idx) => {
    const ix = CX + Math.cos(angle) * RING_R;
    const iy = CY + Math.sin(angle) * RING_R;
    const colliding = vis.state === "COLLIDING";

    // Ponto central
    ctx.beginPath();
    ctx.arc(ix, iy, 5, 0, Math.PI * 2);
    ctx.fillStyle = colliding ? "rgba(255,0,60,0.9)" : "rgba(20,60,80,0.5)";
    ctx.fill();

    // Anel pulsante durante colisão
    if (colliding) {
      const pulse = 5 + Math.sin(vis.frame * 0.12 + idx * Math.PI / 2) * 4;
      ctx.beginPath();
      ctx.arc(ix, iy, pulse, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,0,60,0.35)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  });
}

function drawParticles() {
  const speedMult = 0.5 + (vis.energyTev / 6.8) * 1.5;

  vis.particles.forEach(p => {
    // Avança ângulo (proporcional à energia)
    p.angle += p.speed * p.dir * speedMult;

    const px = CX + Math.cos(p.angle) * p.r;
    const py = CY + Math.sin(p.angle) * p.r;

    // Acumula trail
    p.trail.push({ x: px, y: py });
    if (p.trail.length > 30) p.trail.shift();

    // Desenha rastro com fade
    for (let i = 1; i < p.trail.length; i++) {
      const t = i / p.trail.length;
      ctx.beginPath();
      ctx.moveTo(p.trail[i - 1].x, p.trail[i - 1].y);
      ctx.lineTo(p.trail[i].x,     p.trail[i].y);
      ctx.strokeStyle = p.color.replace(")", `,${t * 0.5})`).replace("rgb", "rgba");
      ctx.lineWidth   = p.size * 0.5 * t;
      ctx.stroke();
    }

    // Núcleo da partícula
    ctx.beginPath();
    ctx.arc(px, py, p.size, 0, Math.PI * 2);
    ctx.fillStyle   = p.color;
    ctx.shadowColor = p.color;
    ctx.shadowBlur  = 8 + vis.energyTev * 1.5;
    ctx.fill();
    ctx.shadowBlur  = 0;
  });
}

function drawSparks() {
  vis.sparks = vis.sparks.filter(s => s.life > 0);
  vis.sparks.forEach(s => {
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r * s.life, 0, Math.PI * 2);
    ctx.fillStyle = s.color.replace(")", `,${s.life})`).replace("rgb", "rgba");
    ctx.fill();
    s.x += s.vx;
    s.y += s.vy;
    s.vx *= 0.95;
    s.vy *= 0.95;
    s.life -= s.decay;
  });
}

function drawShockwaves() {
  vis.shockwaves = vis.shockwaves.filter(s => s.life > 0);
  vis.shockwaves.forEach(s => {
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255,160,0,${s.life * 0.5})`;
    ctx.lineWidth = 2;
    ctx.stroke();
    s.r    += 5;
    s.life -= 0.03;
  });
}

function drawFlashes() {
  vis.flashes = vis.flashes.filter(f => f.life > 0);
  vis.flashes.forEach(f => {
    ctx.fillStyle = `rgba(255,200,50,${f.life * 0.12})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    f.life -= 0.07;
  });
}

function drawCenterLabel() {
  // Círculo central
  ctx.beginPath();
  ctx.arc(CX, CY, 72, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,245,255,0.04)";
  ctx.fill();
  ctx.strokeStyle = "rgba(0,245,255,0.08)";
  ctx.lineWidth = 1;
  ctx.stroke();

  // Nome
  ctx.font = "bold 26px 'Share Tech Mono', monospace";
  ctx.fillStyle = "rgba(0,245,255,0.35)";
  ctx.textAlign = "center";
  ctx.fillText("LHC", CX, CY - 6);

  // Estado atual
  ctx.font = "11px 'Share Tech Mono', monospace";
  ctx.fillStyle = "rgba(0,180,200,0.5)";
  ctx.fillText(vis.state, CX, CY + 12);

  // Arco de progresso de energia
  const frac = Math.min(vis.energyTev / 6.8, 1);
  if (frac > 0) {
    ctx.beginPath();
    ctx.arc(CX, CY, 56, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
    ctx.strokeStyle = `rgba(0,245,255,${0.2 + frac * 0.5})`;
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }
}

// ── SSE — recebe estado do backend ───────────────────────────────────────────

/**
 * Conecta ao stream SSE do Flask e atualiza vis + telemetria a cada evento.
 * O browser reconecta automaticamente se a conexão cair.
 */
function connectSSE() {
  const source = new EventSource("/api/stream");

  source.onmessage = (event) => {
    const data = JSON.parse(event.data);
    applyBackendState(data);
  };

  source.onerror = () => {
    console.warn("SSE desconectado. Reconectando...");
    setTimeout(connectSSE, 2000);
  };
}

/**
 * Aplica o estado recebido do backend à visualização e telemetria.
 *
 * @param {Object} data  Objeto JSON com AcceleratorStatus serializado
 */
function applyBackendState(data) {
  // Atualiza estado da visualização
  const prevState = vis.state;
  vis.state           = data.state;
  vis.energyTev       = data.energy_tev;
  vis.magnetFieldT    = data.magnetic_field_t;
  vis.gamma           = data.gamma;
  vis.luminosity      = data.luminosity;
  vis.collisionRate   = data.collision_rate;
  vis.totalCollisions = data.total_collisions;
  vis.nBunches        = data.n_bunches;

  // Sincroniza partículas visuais
  syncParticles(data.n_bunches);

  // Atualiza painéis de telemetria
  updateTelemetry(data);

  // Atualiza log
  updateLog(data.log);

  // Atualiza indicadores de status
  updateStatusDots(data);
}

// ── Telemetria ───────────────────────────────────────────────────────────────

/** Formata número com casas decimais, lidando com undefined */
const fmt = (v, d = 2) => (v !== undefined ? Number(v).toFixed(d) : "—");

/** Atualiza todos os medidores numéricos do painel */
function updateTelemetry(d) {
  setMeter("energy",   fmt(d.energy_tev),      d.energy_tev / 6.8);
  setMeter("magnetic", fmt(d.magnetic_field_t), d.magnetic_field_t / 8.33);
  setMeter("gamma",    fmt(d.gamma, 0),         Math.min(d.gamma / 7500, 1));
  setMeter("beta",     fmt(d.beta, 6),          d.beta);
  setMeter("lumi",     toSci(d.luminosity),     Math.min(d.luminosity / 1e34, 1));
  setMeter("coll",     fmt(d.collision_rate, 0),Math.min(d.collision_rate / 8e8, 1));
  setMeter("total",    fmtBig(d.total_collisions), 0);
  setMeter("bunches",  d.n_bunches,             d.n_bunches / 2556);

  // Temperatura sobe levemente com energia (aquecimento por radiação síncrotron)
  const tempK = 1.9 + d.energy_tev * 0.08;
  setMeter("temp", fmt(tempK, 2), Math.min((tempK - 1.9) / 3, 1), true);

  // Destaca estado atual
  document.getElementById("state-badge").textContent = d.state;
  document.getElementById("state-badge").className   = "state-badge state-" + d.state.toLowerCase();

  // Uptime
  const up = d.uptime_s || 0;
  const h = Math.floor(up / 3600).toString().padStart(2, "0");
  const m = Math.floor((up % 3600) / 60).toString().padStart(2, "0");
  const s = Math.floor(up % 60).toString().padStart(2, "0");
  const el = document.getElementById("uptime");
  if (el) el.textContent = `${h}:${m}:${s}`;
}

/**
 * Atualiza um medidor individual (valor + barra de progresso).
 *
 * @param {string}  id       ID base do elemento (sem sufixo)
 * @param {string}  val      Valor formatado para exibir
 * @param {number}  frac     Fração 0–1 para a barra
 * @param {boolean} danger   Se true, usa cor de alerta na barra
 */
function setMeter(id, val, frac = 0, danger = false) {
  const valEl = document.getElementById(`m-${id}-val`);
  const barEl = document.getElementById(`m-${id}-bar`);
  if (valEl) valEl.textContent = val;
  if (barEl) {
    barEl.style.width = Math.min(frac * 100, 100) + "%";
    if (danger) {
      barEl.style.background = frac > 0.7 ? "var(--danger)" : frac > 0.4 ? "var(--hot)" : "var(--accent)";
    }
  }
}

/** Converte número grande para notação científica legível */
function toSci(n) {
  if (!n || n === 0) return "0";
  const exp = Math.floor(Math.log10(n));
  const man = (n / Math.pow(10, exp)).toFixed(2);
  return `${man}×10^${exp}`;
}

/** Formata números grandes com separador de milhar */
function fmtBig(n) {
  return Number(n || 0).toLocaleString("pt-BR");
}

// ── Log ───────────────────────────────────────────────────────────────────────

let lastLogLength = 0;

/** Atualiza o terminal de log sem redesenhar linhas já existentes */
function updateLog(lines) {
  if (!lines || lines.length === lastLogLength) return;
  lastLogLength = lines.length;

  const container = document.getElementById("log-container");
  container.innerHTML = "";

  lines.slice(-30).reverse().forEach(line => {
    const div = document.createElement("div");
    div.className = "log-line";

    // Coloriza por tipo de mensagem
    if (line.includes("ERRO"))        div.classList.add("log-error");
    else if (line.includes("✓"))      div.classList.add("log-ok");
    else if (line.includes("DUMP") || line.includes("COLISÃO") || line.includes("DETECTED"))
                                      div.classList.add("log-warn");

    div.textContent = line;
    container.appendChild(div);
  });
}

// ── Status dots ───────────────────────────────────────────────────────────────

function updateStatusDots(d) {
  setDot("dot-cryo",   true);
  setDot("dot-beam",   d.state !== "IDLE");
  setDot("dot-stable", d.state === "STABLE" || d.state === "COLLIDING");
  setDot("dot-coll",   d.state === "COLLIDING");
}

function setDot(id, active) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle("dot-active",   active);
  el.classList.toggle("dot-inactive", !active);
}

// ── Comandos ─────────────────────────────────────────────────────────────────

/**
 * Envia um comando à API REST do Flask.
 *
 * @param {string} cmd   Nome do comando (inject, accelerate, collide, dump)
 * @param {Object} body  Payload JSON opcional
 */
async function sendCommand(cmd, body = {}) {
  try {
    const res = await fetch(`/api/command/${cmd}`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body),
    });
    const data = await res.json();
    if (!data.success) {
      console.warn(`Comando '${cmd}' falhou: ${data.message}`);
    }
  } catch (err) {
    console.error("Erro ao enviar comando:", err);
  }
}

// Expõe funções para os botões no HTML
window.cmdInject     = () => sendCommand("inject",     { n_bunches: 2556 });
window.cmdAccelerate = () => sendCommand("accelerate");
window.cmdCollide    = () => sendCommand("collide");
window.cmdDump       = () => sendCommand("dump");

// ── Boot ──────────────────────────────────────────────────────────────────────

connectSSE();
render();
