"""
accelerator.py — Máquina de estados do acelerador
==================================================

Gerencia o estado operacional do LHC simulado:
  IDLE → INJECTED → ACCELERATING → STABLE → COLLIDING

Cada transição valida condições físicas e atualiza
os parâmetros do feixe de forma realista.
"""

from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import Optional
import time
import math

from physics import (
    lorentz_factor,
    velocity_fraction,
    magnetic_field_tesla,
    luminosity,
    collision_rate,
)


# ── Parâmetros do LHC (valores reais como referência) ───────────────────────

LHC_RING_RADIUS_M      = 2804.0    # raio médio do LHC em metros
LHC_REVOLUTION_FREQ    = 11_245.0  # Hz — f = c / circunferência
LHC_MAX_ENERGY_TEV     = 6.8       # TeV por feixe (Run 3)
LHC_PARTICLES_PER_BUNCH = 1.15e11  # prótons por bunch
LHC_BEAM_SIGMA_M       = 16.7e-6   # tamanho transversal do feixe (μm)
LHC_CROSS_SECTION_MB   = 100.0     # seção de choque pp em ~13 TeV (millibarn)
LHC_CRYOGENIC_TEMP_K   = 1.9       # temperatura operacional (superfluid He)
LHC_MAX_FIELD_T        = 8.33      # campo máximo dos dipolos (Tesla)


# ── Estados possíveis do acelerador ─────────────────────────────────────────

class AcceleratorState(str, Enum):
    IDLE         = "IDLE"          # sistema em repouso
    INJECTED     = "INJECTED"      # feixe injetado, baixa energia
    ACCELERATING = "ACCELERATING"  # cavidades RF ativas, energia subindo
    STABLE       = "STABLE"        # energia nominal, feixe estável
    COLLIDING    = "COLLIDING"     # pontos de interação ativos
    FAULT        = "FAULT"         # falha — beam dump automático


# ── Dados do feixe ───────────────────────────────────────────────────────────

@dataclass
class BeamData:
    """Parâmetros físicos instantâneos de um único feixe."""
    direction: int       # +1 (horário) ou -1 (anti-horário)
    n_bunches: int = 0
    energy_tev: float = 0.0
    beta: float = 0.0    # v/c
    gamma: float = 1.0   # fator de Lorentz


# ── Estado completo do acelerador ────────────────────────────────────────────

@dataclass
class AcceleratorStatus:
    """
    Snapshot completo do estado do acelerador.
    Esta é a estrutura serializada e enviada ao frontend via JSON.
    """
    state: str = AcceleratorState.IDLE
    energy_tev: float = 0.0          # energia atual por feixe
    target_energy_tev: float = 0.0   # energia alvo da rampa
    magnetic_field_t: float = 0.0    # campo dipolar atual
    temperature_k: float = LHC_CRYOGENIC_TEMP_K
    n_bunches: int = 0               # bunches por feixe
    gamma: float = 1.0               # fator de Lorentz
    beta: float = 0.0                # v/c
    luminosity: float = 0.0          # cm⁻²·s⁻¹
    collision_rate: float = 0.0      # eventos/s
    total_collisions: int = 0        # colisões acumuladas
    uptime_s: float = 0.0            # tempo de operação
    log: list = field(default_factory=list)   # últimas mensagens do sistema

    def to_dict(self) -> dict:
        d = asdict(self)
        d["log"] = self.log[-20:]    # envia só as últimas 20 linhas
        return d


# ── Classe principal ─────────────────────────────────────────────────────────

class Accelerator:
    """
    Simula o ciclo operacional completo de um acelerador de hadrons.

    Responsabilidades:
      - Controlar transições de estado (injeção, aceleração, colisão)
      - Calcular parâmetros físicos a cada tick de simulação
      - Manter log de operação e histórico de colisões
      - Detectar falhas e acionar beam dump automático
    """

    def __init__(self):
        self.status = AcceleratorStatus()
        self._start_time: Optional[float] = None
        self._ramp_rate_tev_per_s = 0.15   # rampa de energia (TeV/s simulado)
        self._collision_accumulator = 0.0   # acumula fração de colisão

    # ── Comandos do operador ─────────────────────────────────────────────────

    def cmd_inject(self, n_bunches: int = 2556) -> dict:
        """
        Injeta prótons no anel vindo do pré-acelerador (SPS).

        Condição: sistema deve estar em IDLE.
        Energia de injeção: 0.45 TeV (valor real do LHC).
        """
        if self.status.state != AcceleratorState.IDLE:
            return self._err("Não é possível injetar: sistema não está em IDLE.")

        self.status.state      = AcceleratorState.INJECTED
        self.status.n_bunches  = n_bunches
        self.status.energy_tev = 0.45           # energia de injeção do SPS
        self.status.target_energy_tev = 0.45
        self._start_time = time.time()
        self._update_beam_params()

        self._log(f"Injeção nominal: 2×{n_bunches} bunches a 0.45 TeV")
        self._log("Fonte: LINAC4 → Booster → PS → SPS → LHC")
        self._log(f"γ = {self.status.gamma:.0f} | β = {self.status.beta:.6f}")
        return self._ok("Feixe injetado com sucesso.")

    def cmd_accelerate(self) -> dict:
        """
        Inicia a rampa de energia via cavidades RF supercondutoras.

        Condição: sistema em INJECTED.
        As cavidades operam em 400 MHz, cada volta ganha ~485 keV.
        """
        if self.status.state != AcceleratorState.INJECTED:
            return self._err("Rampa requer estado INJECTED.")

        self.status.state = AcceleratorState.ACCELERATING
        self.status.target_energy_tev = LHC_MAX_ENERGY_TEV

        self._log("Cavidades RF ativas — 400 MHz, 16 MV/m")
        self._log(f"Rampa: 0.45 → {LHC_MAX_ENERGY_TEV} TeV")
        self._log("Correntes dos dipolos subindo...")
        return self._ok("Aceleração iniciada.")

    def cmd_collide(self) -> dict:
        """
        Ativa colisões nos pontos de interação.

        Condição: energia ≥ 1 TeV e estado STABLE ou ACCELERATING.
        """
        if self.status.energy_tev < 1.0:
            return self._err(f"Energia insuficiente: {self.status.energy_tev:.2f} TeV (mínimo: 1.0 TeV).")

        if self.status.state not in (AcceleratorState.STABLE, AcceleratorState.ACCELERATING):
            return self._err("Colisão requer feixe estável ou em aceleração.")

        self.status.state = AcceleratorState.COLLIDING
        self._log("Ângulo de cruzamento aplicado: ±285 μrad")
        self._log("Pontos de interação ativos: IP1 (ATLAS), IP5 (CMS)")
        self._log("COLISÕES DETECTADAS — modo física ativo")
        return self._ok("Colisões iniciadas.")

    def cmd_dump(self) -> dict:
        """
        Despeja o feixe no absorvedor (beam dump).
        Reseta o sistema para IDLE.
        """
        prev_state = self.status.state
        self._reset()
        self._log(f"BEAM DUMP executado a partir de {prev_state}")
        self._log("Kicker de abort acionado — feixe absorvido")
        self._log("Sistema resetado para IDLE")
        return self._ok("Feixe descartado. Sistema em IDLE.")

    # ── Loop de simulação (chamado a cada tick) ──────────────────────────────

    def tick(self, dt: float = 0.1) -> dict:
        """
        Avança a simulação em `dt` segundos.

        Chamado periodicamente pelo backend (via thread ou SSE).
        Atualiza energia, campo, luminosidade e colisões.

        Args:
            dt: Intervalo de tempo em segundos (simulado)

        Returns:
            Dicionário com o status atual (para enviar ao frontend)
        """
        s = self.status

        if self._start_time:
            s.uptime_s = time.time() - self._start_time

        # Rampa de energia
        if s.state == AcceleratorState.ACCELERATING:
            s.energy_tev = min(
                s.target_energy_tev,
                s.energy_tev + self._ramp_rate_tev_per_s * dt
            )
            if s.energy_tev >= s.target_energy_tev:
                s.state = AcceleratorState.STABLE
                self._log(f"Energia nominal atingida: {s.energy_tev:.2f} TeV ✓")
                self._log("FEIXES ESTÁVEIS — pronto para colisões")

        # Atualiza parâmetros físicos
        if s.state != AcceleratorState.IDLE:
            self._update_beam_params()

        # Calcula colisões
        if s.state == AcceleratorState.COLLIDING:
            lumi = luminosity(
                n_bunches=s.n_bunches,
                particles_per_bunch=LHC_PARTICLES_PER_BUNCH,
                revolution_freq_hz=LHC_REVOLUTION_FREQ,
                beam_sigma_m=LHC_BEAM_SIGMA_M
            )
            rate = collision_rate(lumi, LHC_CROSS_SECTION_MB)

            s.luminosity = lumi
            s.collision_rate = rate

            # Acumula colisões pelo tempo
            self._collision_accumulator += rate * dt
            new_collisions = int(self._collision_accumulator)
            s.total_collisions += new_collisions
            self._collision_accumulator -= new_collisions

            # Log periódico de eventos notáveis
            if new_collisions > 0 and s.total_collisions % 5_000_000 == 0:
                self._log(f"Marco: {s.total_collisions:,} colisões registradas")

        return s.to_dict()

    # ── Métodos internos ─────────────────────────────────────────────────────

    def _update_beam_params(self):
        """Recalcula γ, β e campo magnético com base na energia atual."""
        e = self.status.energy_tev
        if e <= 0:
            return
        self.status.gamma = lorentz_factor(e)
        self.status.beta  = velocity_fraction(self.status.gamma)
        self.status.magnetic_field_t = magnetic_field_tesla(e, LHC_RING_RADIUS_M)

    def _reset(self):
        """Reseta todos os parâmetros para estado inicial."""
        self.status = AcceleratorStatus()
        self._start_time = None
        self._collision_accumulator = 0.0

    def _log(self, msg: str):
        """Adiciona mensagem ao log interno com timestamp."""
        ts = time.strftime("%H:%M:%S")
        self.status.log.append(f"[{ts}] {msg}")
        # Mantém apenas as últimas 100 mensagens em memória
        if len(self.status.log) > 100:
            self.status.log = self.status.log[-100:]

    def _ok(self, msg: str) -> dict:
        return {"success": True, "message": msg}

    def _err(self, msg: str) -> dict:
        self._log(f"ERRO: {msg}")
        return {"success": False, "message": msg}
