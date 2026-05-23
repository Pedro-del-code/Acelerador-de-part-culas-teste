"""
accelerator.py — Máquina de estados completa do LHC simulado
=============================================================

Implementa o ciclo operacional completo com:
  - Pipeline realista: LINAC4 → Booster → PS → SPS → LHC
  - Estados: IDLE → INJECTED → ACCELERATING → STABLE → COLLIDING
  - Sistema de alarmes (quench, emitância, temperatura, corrente)
  - Detectors independentes por IP (ATLAS, CMS, ALICE, LHCb)
  - Física avançada: emitância, tune, cromaticidade, pileup, beam lifetime
  - Histórico de runs e luminosidade integrada
"""

from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import Optional, List, Dict
import time
import math
import random

from physics import (
    lorentz_factor,
    velocity_fraction,
    magnetic_field_tesla,
    luminosity_per_ip,
    luminosity,
    collision_rate,
    quench_probability,
    beam_current_ma,
    normalized_emittance_um,
    tune_values,
    chromaticity,
    pileup_mu,
    integrated_luminosity_inv_fb,
    temperature_with_radiation,
    synchrotron_radiation_mev_per_turn,
    LHC_MAX_ENERGY_TEV,
    LHC_INJECT_ENERGY_TEV,
    LHC_PARTICLES_PER_BUNCH,
    LHC_BEAM_SIGMA_M,
    LHC_CROSS_SECTION_MB,
    LHC_CRYOGENIC_TEMP_K,
    LHC_MAX_FIELD_T,
    LHC_REVOLUTION_FREQ,
    LHC_DETECTORS,
)


# ── Estados possíveis do acelerador ─────────────────────────────────────────

class AcceleratorState(str, Enum):
    IDLE         = "IDLE"           # sistema em repouso
    PRECOOLING   = "PRECOOLING"     # resfriamento criogênico inicial
    INJECTING    = "INJECTING"      # pipeline de injeção ativo
    INJECTED     = "INJECTED"       # feixe injetado, baixa energia
    ACCELERATING = "ACCELERATING"   # cavidades RF ativas, energia subindo
    STABLE       = "STABLE"         # energia nominal, feixe estável
    COLLIDING    = "COLLIDING"      # pontos de interação ativos
    RAMPING_DOWN = "RAMPING_DOWN"   # desaceleração controlada
    FAULT        = "FAULT"          # falha — beam dump automático
    DUMP         = "DUMP"           # dump em progresso


# ── Severidade de alarmes ────────────────────────────────────────────────────

class AlarmSeverity(str, Enum):
    INFO    = "INFO"
    WARNING = "WARNING"
    ALARM   = "ALARM"
    FAULT   = "FAULT"


# ── Alarm record ─────────────────────────────────────────────────────────────

@dataclass
class Alarm:
    code: str
    message: str
    severity: str
    timestamp: str
    active: bool = True

    def to_dict(self):
        return asdict(self)


# ── Detector status ──────────────────────────────────────────────────────────

@dataclass
class DetectorStatus:
    ip: str
    name: str
    active: bool = False
    luminosity: float = 0.0
    collision_rate: float = 0.0
    pileup: float = 0.0
    integrated_lumi_inv_pb: float = 0.0
    crossing_angle_urad: float = 285.0

    def to_dict(self):
        return asdict(self)


# ── Estado completo do acelerador ────────────────────────────────────────────

@dataclass
class AcceleratorStatus:
    """Snapshot completo — serializado e enviado ao frontend via JSON."""
    state: str = AcceleratorState.IDLE

    # Energia e dinâmica
    energy_tev: float = 0.0
    target_energy_tev: float = 0.0
    magnetic_field_t: float = 0.0
    ramp_rate_tev_s: float = 0.0

    # Sistema criogênico
    temperature_k: float = LHC_CRYOGENIC_TEMP_K
    cryo_stable: bool = True

    # Feixe
    n_bunches: int = 0
    particles_per_bunch: float = LHC_PARTICLES_PER_BUNCH
    beam_current_ma: float = 0.0
    emittance_um: float = 3.75

    # Relatividade
    gamma: float = 1.0
    beta: float = 0.0

    # Óptica
    tune_x: float = 64.31
    tune_y: float = 59.32
    chroma_x: float = 2.0
    chroma_y: float = 2.0

    # Luminosidade total
    luminosity: float = 0.0
    collision_rate: float = 0.0
    total_collisions: int = 0
    pileup: float = 0.0
    integrated_lumi_inv_fb: float = 0.0
    beam_lifetime_h: float = 0.0

    # Radiação síncrotron
    synchrotron_loss_kev: float = 0.0

    # Detectores individuais
    detectors: List[dict] = field(default_factory=list)

    # Alarmes ativos
    alarms: List[dict] = field(default_factory=list)

    # Log de operação
    log: List[str] = field(default_factory=list)

    # Tempo
    uptime_s: float = 0.0
    fill_number: int = 1

    # Pipeline de injeção
    injection_stage: str = ""   # "LINAC4", "BOOSTER", "PS", "SPS", "LHC"
    injection_progress: float = 0.0

    def to_dict(self) -> dict:
        d = asdict(self)
        d["log"] = self.log[-30:]
        return d


# ── Classe principal ─────────────────────────────────────────────────────────

class Accelerator:
    """
    Simula o ciclo operacional completo do LHC.

    Novidades v4:
      - Pipeline de injeção animado (LINAC4 → Booster → PS → SPS → LHC)
      - Sistema de alarmes com severidades
      - Física de emitância e tune
      - Detectores independentes por IP
      - Fault automático por quench/temperatura
      - Ramping down controlado
    """

    def __init__(self):
        self.status = AcceleratorStatus()
        self._start_time: Optional[float] = None
        self._ramp_rate_tev_per_s = 0.12       # TeV/s simulado (realista para demo)
        self._collision_accumulator = 0.0
        self._quench_check_counter = 0
        self._active_alarms: Dict[str, Alarm] = {}
        self._detector_states: Dict[str, DetectorStatus] = {}
        self._injection_timer = 0.0
        self._injection_stages = ["LINAC4", "BOOSTER", "PS", "SPS", "LHC"]
        self._injection_stage_idx = 0
        self._fill_number = 1

        # Inicializa detectores
        for ip, det in LHC_DETECTORS.items():
            self._detector_states[ip] = DetectorStatus(
                ip=ip,
                name=det["name"],
                active=det["active"],
                crossing_angle_urad=285.0 if ip in ("IP1", "IP5") else 150.0,
            )

        # Estado criogênico começa sendo estabelecido
        self.status.temperature_k = LHC_CRYOGENIC_TEMP_K
        self.status.cryo_stable = True

    # ── Comandos do operador ─────────────────────────────────────────────────

    def cmd_inject(self, n_bunches: int = 2556) -> dict:
        """
        Injeta prótons via pipeline: LINAC4 → Booster → PS → SPS → LHC.
        Estado IDLE → INJECTING → INJECTED
        """
        if self.status.state != AcceleratorState.IDLE:
            return self._err("Não é possível injetar: sistema não está em IDLE.")

        if not self.status.cryo_stable:
            return self._err("Sistema criogênico instável. Aguarde estabilização.")

        self.status.state = AcceleratorState.INJECTING
        self.status.n_bunches = 0
        self._injection_stage_idx = 0
        self._injection_timer = 0.0
        self._start_time = time.time()

        self._log(f"Iniciando injeção: {n_bunches} bunches por feixe")
        self._log("LINAC4: acelerando H⁻ a 160 MeV...")
        self.status.injection_stage = "LINAC4"
        self.status.injection_progress = 0.0

        # Armazena n_bunches alvo para usar durante injeção
        self._target_n_bunches = n_bunches
        return self._ok(f"Pipeline de injeção iniciado — {n_bunches} bunches.")

    def cmd_accelerate(self) -> dict:
        """
        Inicia rampa de energia via cavidades RF supercondutoras (400 MHz).
        Estado INJECTED → ACCELERATING
        """
        if self.status.state != AcceleratorState.INJECTED:
            return self._err("Rampa requer estado INJECTED.")

        self.status.state = AcceleratorState.ACCELERATING
        self.status.target_energy_tev = LHC_MAX_ENERGY_TEV
        self.status.ramp_rate_tev_s = self._ramp_rate_tev_per_s

        self._raise_alarm("RF_RAMP", "Cavidades RF ativas — rampa iniciada", AlarmSeverity.INFO)
        self._log(f"Cavidades RF ativas — {16:.0f}×400 MHz, 16 MV/m por cavidade")
        self._log(f"Rampa: {self.status.energy_tev:.2f} → {LHC_MAX_ENERGY_TEV} TeV")
        self._log(f"Taxa de rampa: {self._ramp_rate_tev_per_s:.3f} TeV/s")
        self._log("Correntes dos dipolos subindo (0 → 11850 A)...")
        return self._ok("Aceleração iniciada.")

    def cmd_collide(self) -> dict:
        """
        Ativa colisões nos IPs. Requer energia ≥ 1.0 TeV e feixe STABLE/ACCELERATING.
        """
        if self.status.energy_tev < 1.0:
            return self._err(
                f"Energia insuficiente: {self.status.energy_tev:.2f} TeV (mínimo: 1.0 TeV)."
            )
        if self.status.state not in (AcceleratorState.STABLE, AcceleratorState.ACCELERATING):
            return self._err("Colisão requer feixe estável ou em aceleração.")

        self.status.state = AcceleratorState.COLLIDING
        e_cm = self.status.energy_tev * 2.0

        # Ativa detectores conforme configuração
        active_ips = []
        for ip, det in self._detector_states.items():
            if LHC_DETECTORS[ip]["active"]:
                det.active = True
                active_ips.append(f"{ip} ({det.name})")

        self._clear_alarm("RF_RAMP")
        self._log(f"Ângulo de cruzamento aplicado: ±285 μrad (IP1/5), ±150 μrad (IP2/8)")
        self._log(f"IPs ativos: {', '.join(active_ips)}")
        self._log(f"Energia no centro de massa: √s = {e_cm:.1f} TeV")
        self._log("COLISÕES DETECTADAS — modo física ativo ✓")
        return self._ok("Colisões iniciadas.")

    def cmd_dump(self) -> dict:
        """
        Dump controlado do feixe. Inicia RAMPING_DOWN antes de DUMP.
        """
        if self.status.state == AcceleratorState.IDLE:
            return self._err("Sistema já em IDLE.")

        prev_state = self.status.state
        if self.status.state == AcceleratorState.COLLIDING:
            # Para em colisão: desativa detectores primeiro
            for det in self._detector_states.values():
                det.active = False
            self._log("Detectores desativados.")

        self.status.state = AcceleratorState.DUMP
        self._log(f"BEAM DUMP iniciado a partir de {prev_state}")
        self._log("Kicker de abort acionado (3 μs rise time)")
        self._log("Feixe extraído para o dump block (grafite — 8 toneladas)")
        return self._ok("Dump em progresso...")

    def cmd_activate_detector(self, ip: str) -> dict:
        """Ativa/desativa um detector específico durante COLLIDING."""
        if self.status.state != AcceleratorState.COLLIDING:
            return self._err("Detectores só podem ser ativados durante colisões.")
        if ip not in self._detector_states:
            return self._err(f"IP desconhecido: {ip}")

        det = self._detector_states[ip]
        det.active = not det.active
        status = "ativado" if det.active else "desativado"
        self._log(f"{det.name} ({ip}) {status}")
        return self._ok(f"{det.name} {status}.")

    # ── Loop de simulação ────────────────────────────────────────────────────

    def tick(self, dt: float = 0.1) -> dict:
        """
        Avança a simulação em `dt` segundos simulados.
        """
        s = self.status

        if self._start_time:
            s.uptime_s = time.time() - self._start_time

        # ── Pipeline de injeção animado ──────────────────────────────────────
        if s.state == AcceleratorState.INJECTING:
            self._tick_injection(dt)

        # ── Rampa de energia ─────────────────────────────────────────────────
        elif s.state == AcceleratorState.ACCELERATING:
            delta = self._ramp_rate_tev_per_s * dt
            s.energy_tev = min(s.target_energy_tev, s.energy_tev + delta)
            s.ramp_rate_tev_s = self._ramp_rate_tev_per_s

            if s.energy_tev >= s.target_energy_tev:
                s.state = AcceleratorState.STABLE
                s.ramp_rate_tev_s = 0.0
                self._log(f"Energia nominal atingida: {s.energy_tev:.2f} TeV ✓")
                self._log("FEIXES ESTÁVEIS — pronto para colisões")
                self._clear_alarm("RF_RAMP")

        # ── Dump em progresso ────────────────────────────────────────────────
        elif s.state == AcceleratorState.DUMP:
            s.energy_tev = max(0.0, s.energy_tev - 0.8 * dt)
            if s.energy_tev <= 0.01:
                self._reset()
                self._log("Sistema resetado para IDLE")

        # ── Atualiza física para estados com feixe ──────────────────────────
        if s.state not in (AcceleratorState.IDLE, AcceleratorState.PRECOOLING):
            self._update_beam_params(dt)

        # ── Colisões ─────────────────────────────────────────────────────────
        if s.state == AcceleratorState.COLLIDING:
            self._tick_collisions(dt)

        # ── Verificações de segurança ────────────────────────────────────────
        if s.state not in (AcceleratorState.IDLE, AcceleratorState.FAULT, AcceleratorState.DUMP):
            self._check_faults(dt)

        # ── Monta lista de detectores ────────────────────────────────────────
        s.detectors = [det.to_dict() for det in self._detector_states.values()]
        s.alarms = [a.to_dict() for a in self._active_alarms.values() if a.active]
        s.fill_number = self._fill_number

        return s.to_dict()

    # ── Ticks internos ───────────────────────────────────────────────────────

    def _tick_injection(self, dt: float):
        """Anima o pipeline de injeção passo a passo."""
        s = self.status
        stages = self._injection_stages
        stage_duration = 1.5   # segundos reais por estágio

        self._injection_timer += dt * 0.1  # dt simulado → tempo real mais lento

        progress = self._injection_timer / stage_duration
        s.injection_progress = min(progress % 1.0, 1.0)

        stage_idx = min(int(self._injection_timer / stage_duration), len(stages) - 1)

        if stage_idx != self._injection_stage_idx:
            self._injection_stage_idx = stage_idx
            stage = stages[stage_idx]
            s.injection_stage = stage

            stage_messages = {
                "BOOSTER": "BOOSTER (PSB): 160 MeV → 1.4 GeV | H⁻ → p⁺ (stripping foil)",
                "PS":      "PS (Proton Synchrotron): 1.4 GeV → 25 GeV | formando bunches",
                "SPS":     "SPS: 25 GeV → 450 GeV | feixe pronto para LHC",
                "LHC":     "Injetando no LHC via TI2/TI8 (transfer lines)...",
            }
            if stage in stage_messages:
                self._log(stage_messages[stage])

        # Injeção completa após todos os estágios
        if self._injection_timer >= stage_duration * len(stages):
            n = getattr(self, '_target_n_bunches', 2556)
            s.n_bunches = n
            s.energy_tev = LHC_INJECT_ENERGY_TEV
            s.target_energy_tev = LHC_INJECT_ENERGY_TEV
            s.state = AcceleratorState.INJECTED
            s.injection_stage = ""
            s.injection_progress = 1.0
            self._update_beam_params(dt)
            self._log(f"Injeção concluída: 2×{n} bunches a {LHC_INJECT_ENERGY_TEV} TeV ✓")
            self._log(f"γ = {s.gamma:.0f} | β = {s.beta:.6f}")
            self._log(f"Corrente total: {s.beam_current_ma:.1f} mA por feixe")

    def _tick_collisions(self, dt: float):
        """Atualiza física de colisões para todos os IPs ativos."""
        s = self.status
        total_lumi = 0.0
        total_rate = 0.0

        for ip, det in self._detector_states.items():
            if not det.active:
                det.luminosity = 0.0
                det.collision_rate = 0.0
                det.pileup = 0.0
                continue

            det_info = LHC_DETECTORS[ip]
            lumi = luminosity_per_ip(
                n_bunches=s.n_bunches,
                particles_per_bunch=s.particles_per_bunch,
                energy_tev=s.energy_tev,
                sigma_ip_um=det_info["sigma_ip_um"],
                crossing_angle_urad=det.crossing_angle_urad,
            )
            rate = collision_rate(lumi, LHC_CROSS_SECTION_MB)
            mu = pileup_mu(lumi, s.n_bunches, LHC_REVOLUTION_FREQ)

            det.luminosity = lumi
            det.collision_rate = rate
            det.pileup = mu
            det.integrated_lumi_inv_pb += lumi * dt * 1e-33  # cm⁻²·s⁻¹ → pb⁻¹

            total_lumi += lumi
            total_rate += rate

        s.luminosity = total_lumi
        s.collision_rate = total_rate
        s.pileup = (total_lumi / max(len([d for d in self._detector_states.values() if d.active]), 1))
        s.pileup = pileup_mu(total_lumi / max(1, sum(1 for d in self._detector_states.values() if d.active)),
                             s.n_bunches, LHC_REVOLUTION_FREQ)

        # Acumula colisões
        self._collision_accumulator += total_rate * dt
        new_coll = int(self._collision_accumulator)
        s.total_collisions += new_coll
        self._collision_accumulator -= new_coll
        s.integrated_lumi_inv_fb = integrated_luminosity_inv_fb(s.total_collisions)

        # Marcos de colisões
        milestones = [1_000_000, 10_000_000, 100_000_000, 1_000_000_000]
        for m in milestones:
            if s.total_collisions >= m and (s.total_collisions - new_coll) < m:
                self._log(f"🎯 Marco: {s.total_collisions:,} colisões detectadas!")

    # ── Física do feixe ──────────────────────────────────────────────────────

    def _update_beam_params(self, dt: float = 0.1):
        """Atualiza todos os parâmetros físicos do feixe."""
        s = self.status
        e = s.energy_tev
        if e <= 0:
            return

        s.gamma = lorentz_factor(e)
        s.beta = velocity_fraction(s.gamma)
        s.magnetic_field_t = magnetic_field_tesla(e)
        s.beam_current_ma = beam_current_ma(s.n_bunches, s.particles_per_bunch, e)
        s.emittance_um = max(2.0, normalized_emittance_um(e) + random.gauss(0, 0.02))
        s.synchrotron_loss_kev = synchrotron_radiation_mev_per_turn(e) * 1000.0

        # Tune e cromaticidade (atualiza a cada ~1s simulado)
        if random.random() < dt * 0.5:
            qx, qy = tune_values(e)
            s.tune_x = qx
            s.tune_y = qy
            cx, cy = chromaticity(e)
            s.chroma_x = cx
            s.chroma_y = cy

        # Temperatura
        s.temperature_k = temperature_with_radiation(
            LHC_CRYOGENIC_TEMP_K, e, s.uptime_s
        )

        # Beam lifetime (só durante STABLE/COLLIDING)
        if s.state in (AcceleratorState.STABLE, AcceleratorState.COLLIDING):
            from physics import beam_lifetime_hours
            s.beam_lifetime_h = beam_lifetime_hours(e, s.luminosity)

    # ── Sistema de alarmes e falhas ──────────────────────────────────────────

    def _check_faults(self, dt: float):
        """Verifica condições de falha e emite alarmes."""
        s = self.status

        # Quench detection
        self._quench_check_counter += 1
        if self._quench_check_counter >= 50:  # a cada 5s simulados
            self._quench_check_counter = 0
            prob = quench_probability(s.magnetic_field_t, s.temperature_k)
            if random.random() < prob * dt * 50:
                self._fault("QUENCH", "QUENCH DETECTADO — dipolo perdeu supercondutividade!")
                return

        # Temperatura alta
        if s.temperature_k > 2.5:
            self._raise_alarm("TEMP_HIGH",
                f"Temperatura criogênica elevada: {s.temperature_k:.3f} K (limite: 2.5 K)",
                AlarmSeverity.ALARM)
        elif s.temperature_k > 2.1:
            self._raise_alarm("TEMP_WARN",
                f"Temperatura criogênica: {s.temperature_k:.3f} K",
                AlarmSeverity.WARNING)
        else:
            self._clear_alarm("TEMP_HIGH")
            self._clear_alarm("TEMP_WARN")

        # Campo magnético próximo ao limite
        if s.magnetic_field_t > 8.0:
            self._raise_alarm("FIELD_HIGH",
                f"Campo dipolar: {s.magnetic_field_t:.2f} T (limite nominal: {8.33:.2f} T)",
                AlarmSeverity.WARNING)
        else:
            self._clear_alarm("FIELD_HIGH")

        # Emitância crescente
        if s.emittance_um > 4.5:
            self._raise_alarm("EMIT_GROW",
                f"Emitância crescendo: εₙ = {s.emittance_um:.2f} μm (nominal: 3.75 μm)",
                AlarmSeverity.WARNING)
        else:
            self._clear_alarm("EMIT_GROW")

        # Corrente de feixe
        if s.beam_current_ma > 580:
            self._raise_alarm("CURRENT_HIGH",
                f"Corrente de feixe elevada: {s.beam_current_ma:.1f} mA",
                AlarmSeverity.WARNING)
        else:
            self._clear_alarm("CURRENT_HIGH")

        # Tune próximo de ressonância
        tx_frac = s.tune_x % 1
        ty_frac = s.tune_y % 1
        if abs(tx_frac - 0.333) < 0.01 or abs(tx_frac - 0.25) < 0.01:
            self._raise_alarm("TUNE_RESONANCE",
                f"Tune próximo de ressonância: Qx = {s.tune_x:.4f}",
                AlarmSeverity.ALARM)
        else:
            self._clear_alarm("TUNE_RESONANCE")

    def _fault(self, code: str, message: str):
        """Dispara uma falha crítica — beam dump automático."""
        self._raise_alarm(code, message, AlarmSeverity.FAULT)
        self._log(f"⚠️  FAULT: {message}")
        self._log("Beam dump automático acionado por proteção!")
        self.status.state = AcceleratorState.FAULT
        # Força dump imediato
        self.cmd_dump()

    def _raise_alarm(self, code: str, message: str, severity: AlarmSeverity):
        """Adiciona ou atualiza um alarme ativo."""
        ts = time.strftime("%H:%M:%S")
        alarm = Alarm(code=code, message=message, severity=severity.value,
                      timestamp=ts, active=True)
        if code not in self._active_alarms:
            self._active_alarms[code] = alarm
            if severity in (AlarmSeverity.ALARM, AlarmSeverity.FAULT):
                self._log(f"⚠️  {severity.value}: {message}")
        else:
            self._active_alarms[code].message = message
            self._active_alarms[code].timestamp = ts

    def _clear_alarm(self, code: str):
        """Desativa um alarme."""
        if code in self._active_alarms:
            del self._active_alarms[code]

    # ── Utilitários ──────────────────────────────────────────────────────────

    def _reset(self):
        """Reseta estado para IDLE após dump."""
        self._fill_number += 1
        self.status = AcceleratorStatus()
        self.status.fill_number = self._fill_number
        self.status.cryo_stable = True
        self._start_time = None
        self._collision_accumulator = 0.0
        self._injection_timer = 0.0
        self._injection_stage_idx = 0
        self._active_alarms.clear()

        # Reinicia detectores
        for ip, det in LHC_DETECTORS.items():
            self._detector_states[ip].active = False
            self._detector_states[ip].luminosity = 0.0
            self._detector_states[ip].collision_rate = 0.0
            self._detector_states[ip].pileup = 0.0
            self._detector_states[ip].integrated_lumi_inv_pb = 0.0

    def _log(self, msg: str):
        ts = time.strftime("%H:%M:%S")
        self.status.log.append(f"[{ts}] {msg}")
        if len(self.status.log) > 200:
            self.status.log = self.status.log[-200:]

    def _ok(self, msg: str) -> dict:
        return {"success": True, "message": msg}

    def _err(self, msg: str) -> dict:
        self._log(f"ERRO: {msg}")
        return {"success": False, "message": msg}
