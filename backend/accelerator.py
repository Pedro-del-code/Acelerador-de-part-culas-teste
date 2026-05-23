"""
accelerator.py — Máquina de estados do acelerador (v2)
=======================================================

Melhorias:
  - Radiação síncrotron (perda de energia por volta)
  - Beam lifetime e decaimento natural do feixe
  - Emittance transversal crescente
  - Risco de quench dos ímãs
  - Sistema de alarmes
  - Histórico de fills
  - Integração com DetectorArray
"""

from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import Optional
import time
import math
import random

import physics as ph
from detectors import DetectorArray


# ── Estados do acelerador ────────────────────────────────────────────────────

class AcceleratorState(str, Enum):
    IDLE         = "IDLE"
    INJECTED     = "INJECTED"
    ACCELERATING = "ACCELERATING"
    STABLE       = "STABLE"
    COLLIDING    = "COLLIDING"
    FAULT        = "FAULT"


# ── Alarmes ──────────────────────────────────────────────────────────────────

@dataclass
class Alarm:
    code: str
    message: str
    severity: str   # INFO | WARNING | CRITICAL
    timestamp: str


# ── Status completo ──────────────────────────────────────────────────────────

@dataclass
class AcceleratorStatus:
    state: str = AcceleratorState.IDLE

    # Energia
    energy_tev: float = 0.0
    target_energy_tev: float = 0.0
    synchrotron_loss_gev: float = 0.0   # perda por volta (GeV)

    # Campo e temperatura
    magnetic_field_t: float = 0.0
    cryo_temp_k: float = ph.LHC_CRYO_TEMP_K
    magnet_temp_k: float = ph.LHC_CRYO_TEMP_K
    quench_risk: float = 0.0

    # Feixe
    n_bunches: int = 0
    particles_per_bunch: float = ph.LHC_PARTICLES_BUNCH
    beam_sigma_m: float = ph.LHC_BEAM_SIGMA_M
    emittance_um: float = 2.5          # μm rad (emittance transversal)
    beam_lifetime_h: float = 0.0
    beam_intensity: float = 1.0        # 1.0 = nominal, decai com tempo

    # Relatividade
    gamma: float = 1.0
    beta: float = 0.0

    # Colisões
    luminosity: float = 0.0
    peak_luminosity: float = 0.0
    integrated_lumi_fb: float = 0.0    # fb⁻¹ acumulado no fill
    collision_rate: float = 0.0
    cross_section_mb: float = 100.0
    total_collisions: int = 0

    # Histórico
    energy_history: list = field(default_factory=list)    # últimos 60 pontos
    lumi_history: list = field(default_factory=list)

    # Fills completados
    fill_count: int = 0
    total_integrated_lumi_fb: float = 0.0

    # Sistema
    uptime_s: float = 0.0
    rf_voltage_mv: float = 0.0         # tensão das cavidades RF (MV)
    rf_frequency_mhz: float = 400.0
    beam_loss_rate: float = 0.0

    # Detectores
    detectors: dict = field(default_factory=dict)

    # Alarmes ativos
    alarms: list = field(default_factory=list)
    log: list = field(default_factory=list)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["log"]            = self.log[-30:]
        d["energy_history"] = self.energy_history[-60:]
        d["lumi_history"]   = self.lumi_history[-60:]
        d["alarms"]         = self.alarms[-10:]
        return d


# ── Acelerador ───────────────────────────────────────────────────────────────

class Accelerator:
    def __init__(self):
        self.status = AcceleratorStatus()
        self.detectors = DetectorArray()
        self._start_time: Optional[float] = None
        self._ramp_rate = 0.18           # TeV/s simulado
        self._history_timer = 0.0        # acumula tempo para historico
        self._quench_timer = 0.0

    # ── Comandos ─────────────────────────────────────────────────────────────

    def cmd_inject(self, n_bunches: int = 2556) -> dict:
        if self.status.state != AcceleratorState.IDLE:
            return self._err("Sistema não está em IDLE.")

        self.status.state              = AcceleratorState.INJECTED
        self.status.n_bunches          = n_bunches
        self.status.energy_tev         = 0.45
        self.status.target_energy_tev  = 0.45
        self.status.emittance_um       = 2.5
        self.status.beam_intensity     = 1.0
        self.status.particles_per_bunch = ph.LHC_PARTICLES_BUNCH
        self.status.beam_sigma_m       = ph.LHC_BEAM_SIGMA_M
        self._start_time               = time.time()

        self._update_beam_params()
        self._log(f"Injeção: 2×{n_bunches} bunches @ 0.45 TeV", "INFO")
        self._log("LINAC4 → Booster → PS → SPS → LHC ✓", "INFO")
        self._add_alarm("INJ-01", f"{n_bunches} bunches injetados com sucesso", "INFO")
        return self._ok("Feixe injetado.")

    def cmd_accelerate(self) -> dict:
        if self.status.state != AcceleratorState.INJECTED:
            return self._err("Requer estado INJECTED.")

        self.status.state             = AcceleratorState.ACCELERATING
        self.status.target_energy_tev = ph.LHC_MAX_ENERGY_TEV
        self.status.rf_voltage_mv     = 12.0

        self._log("Cavidades RF ativas: 400 MHz, 12 MV", "INFO")
        self._log(f"Rampa: 0.45 → {ph.LHC_MAX_ENERGY_TEV} TeV", "INFO")
        self._log("Corrente dos dipolos subindo...", "INFO")
        return self._ok("Aceleração iniciada.")

    def cmd_collide(self) -> dict:
        if self.status.energy_tev < 0.45:
            return self._err(f"Energia insuficiente: {self.status.energy_tev:.2f} TeV")
        if self.status.state not in (AcceleratorState.INJECTED, AcceleratorState.ACCELERATING, AcceleratorState.STABLE):
            return self._err("Requer feixe estável ou em aceleração.")

        self.status.state = AcceleratorState.COLLIDING
        self.detectors.activate()

        self._log("Ângulo de cruzamento: ±285 μrad", "INFO")
        self._log("ATLAS (IP1) · CMS (IP5) · ALICE (IP2) · LHCb (IP8)", "INFO")
        self._add_alarm("COL-01", "Colisões iniciadas nos 4 IPs", "INFO")
        return self._ok("Colisões ativas.")

    def cmd_dump(self) -> dict:
        prev = self.status.state

        # Salva luminosidade integrada do fill
        self.status.total_integrated_lumi_fb += self.status.integrated_lumi_fb
        if self.status.integrated_lumi_fb > 0:
            self.status.fill_count += 1

        self.detectors.deactivate()
        fill = self.status.fill_count
        lumi = self.status.total_integrated_lumi_fb

        self._reset()
        self.status.fill_count = fill
        self.status.total_integrated_lumi_fb = lumi

        self._log(f"BEAM DUMP a partir de {prev}", "WARNING")
        self._log(f"Fill #{fill} concluído | Lumi total: {lumi:.3f} fb⁻¹", "INFO")
        return self._ok("Feixe descartado.")

    # ── Tick ─────────────────────────────────────────────────────────────────

    def tick(self, dt: float = 0.1) -> dict:
        s = self.status

        if self._start_time:
            s.uptime_s = time.time() - self._start_time

        # Rampa de energia — continua mesmo em COLLIDING
        # Isso permite: INJECT → COLLIDE → ACCELERATE em paralelo
        if s.state in (AcceleratorState.ACCELERATING, AcceleratorState.COLLIDING) \
                and s.energy_tev < s.target_energy_tev:
            s.energy_tev = min(s.target_energy_tev,
                               s.energy_tev + self._ramp_rate * dt)
            s.rf_voltage_mv = 12.0 + (s.energy_tev / ph.LHC_MAX_ENERGY_TEV) * 4.0

            if s.energy_tev >= s.target_energy_tev:
                self._log(f"Energia nominal: {s.energy_tev:.2f} TeV ✓", "INFO")
                self._log("FEIXES ESTÁVEIS declarados", "INFO")
                self._add_alarm("STB-01", "Stable beams @ 6.8 TeV", "INFO")

        # Física contínua se feixe ativo
        if s.state not in (AcceleratorState.IDLE, AcceleratorState.FAULT):
            self._update_beam_params()
            self._update_synchrotron(dt)
            self._update_beam_decay(dt)
            self._update_magnet_temp(dt)
            self._check_quench(dt)

        # Colisões
        if s.state == AcceleratorState.COLLIDING:
            self._update_collisions(dt)

        # Histórico (1 ponto por segundo simulado)
        self._history_timer += dt
        if self._history_timer >= 1.0:
            s.energy_history.append(round(s.energy_tev, 3))
            s.lumi_history.append(round(s.luminosity, 2) if s.luminosity else 0)
            if len(s.energy_history) > 120:
                s.energy_history.pop(0)
                s.lumi_history.pop(0)
            self._history_timer = 0.0

        # Detectores
        s.detectors = self.detectors.to_dict()

        return s.to_dict()

    # ── Física interna ────────────────────────────────────────────────────────

    def _update_beam_params(self):
        e = self.status.energy_tev
        if e <= 0:
            return
        self.status.gamma            = ph.lorentz_factor(e)
        self.status.beta             = ph.velocity_fraction(self.status.gamma)
        self.status.magnetic_field_t = ph.magnetic_field_tesla(e)
        self.status.cross_section_mb = ph.pp_cross_section_mb(e)
        self.status.synchrotron_loss_gev = ph.synchrotron_energy_loss_gev(e)

    def _update_synchrotron(self, dt: float):
        """
        Radiação síncrotron: prótons perdem energia ao curvar.
        As cavidades RF compensam — mas há aquecimento residual.
        """
        loss = self.status.synchrotron_loss_gev
        # Aquecimento do criostato proporcional à perda por radiação
        self.status.cryo_temp_k = ph.LHC_CRYO_TEMP_K + loss * 0.02

    def _update_beam_decay(self, dt: float):
        """
        Feixe perde intensidade ao longo do tempo:
          - Emittance crescendo (feixe se alargando)
          - Burn-off por colisões
          - Espalhamento por gás residual
        """
        s = self.status
        if s.energy_tev < 0.5:
            return

        # Emittance cresce com o tempo
        s.emittance_um = ph.emittance_growth(s.emittance_um, s.energy_tev, dt)

        # Sigma do feixe cresce com emittance
        s.beam_sigma_m = ph.LHC_BEAM_SIGMA_M * math.sqrt(s.emittance_um / 2.5)

        # Tempo de vida do feixe
        s.beam_lifetime_h = ph.beam_lifetime_hours(
            s.energy_tev, s.n_bunches, s.emittance_um
        )

        # Decaimento exponencial da intensidade
        if s.beam_lifetime_h > 0:
            tau_s = s.beam_lifetime_h * 3600
            decay = math.exp(-dt / tau_s)
            s.beam_intensity  = max(s.beam_intensity * decay, 0.0)
            s.particles_per_bunch = ph.LHC_PARTICLES_BUNCH * s.beam_intensity

        # Alerta se intensidade cair muito
        if s.beam_intensity < 0.5 and s.state == AcceleratorState.COLLIDING:
            self._add_alarm("BLM-02", f"Intensidade do feixe: {s.beam_intensity*100:.0f}% — considere novo fill", "WARNING")

    def _update_magnet_temp(self, dt: float):
        """Temperatura dos ímãs sobe com perdas de feixe."""
        s = self.status
        # Pequena flutuação + aquecimento proporcional à energia
        noise = random.gauss(0, 0.002)
        target = ph.LHC_CRYO_TEMP_K + s.energy_tev * 0.005
        s.magnet_temp_k += (target - s.magnet_temp_k) * 0.1 * dt + noise
        s.magnet_temp_k = max(ph.LHC_CRYO_TEMP_K, s.magnet_temp_k)

    def _check_quench(self, dt: float):
        """Verifica risco de quench e dispara alarme se necessário."""
        s = self.status
        s.quench_risk = ph.quench_risk(s.beam_loss_rate, s.magnet_temp_k)

        if s.quench_risk > 0.8:
            self._quench_timer += dt
            if self._quench_timer > 2.0:
                self._add_alarm("QPS-01", f"QUENCH DETECTADO — temp: {s.magnet_temp_k:.3f} K", "CRITICAL")
                self._log("QUENCH PROTECTION SYSTEM ativo — dump automático", "CRITICAL")
                self.cmd_dump()
                self._quench_timer = 0.0
        else:
            self._quench_timer = 0.0

    def _update_collisions(self, dt: float):
        s = self.status

        # Luminosidade com emittance atual
        lumi = ph.luminosity(s.n_bunches, s.particles_per_bunch, s.beam_sigma_m)
        rate = ph.collision_rate(lumi, s.cross_section_mb)

        s.luminosity      = lumi
        s.collision_rate  = rate
        s.peak_luminosity = max(s.peak_luminosity, lumi)
        s.integrated_lumi_fb += lumi * dt * 1e-40   # cm⁻² → fb⁻¹

        s.total_collisions += int(rate * dt)

        # Beam loss rate para quench check
        s.beam_loss_rate = rate * 1e-6

        # Detectores
        self.detectors.tick(rate, lumi, dt)

        # Log de marcos
        if s.total_collisions > 0 and s.total_collisions % 10_000_000 == 0:
            self._log(f"Marco: {s.total_collisions/1e9:.2f}B colisões | L_int: {s.integrated_lumi_fb:.4f} fb⁻¹", "INFO")

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _reset(self):
        fill = self.status.fill_count
        lumi = self.status.total_integrated_lumi_fb
        log  = self.status.log[-20:]
        self.status = AcceleratorStatus()
        self.status.fill_count = fill
        self.status.total_integrated_lumi_fb = lumi
        self.status.log = log
        self._start_time = None
        self._history_timer = 0.0
        self._quench_timer = 0.0
        self.detectors.reset()

    def _log(self, msg: str, level: str = "INFO"):
        ts = time.strftime("%H:%M:%S")
        self.status.log.append(f"[{ts}] [{level}] {msg}")
        if len(self.status.log) > 200:
            self.status.log = self.status.log[-200:]

    def _add_alarm(self, code: str, msg: str, severity: str):
        ts = time.strftime("%H:%M:%S")
        alarm = {"code": code, "message": msg, "severity": severity, "timestamp": ts}
        self.status.alarms.append(alarm)
        if len(self.status.alarms) > 50:
            self.status.alarms = self.status.alarms[-50:]

    def _ok(self, msg: str)  -> dict: return {"success": True,  "message": msg}
    def _err(self, msg: str) -> dict:
        self._log(f"ERRO: {msg}", "WARNING")
        return {"success": False, "message": msg}
