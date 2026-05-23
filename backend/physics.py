"""
physics.py — Motor de física do acelerador (v2)
================================================

Física expandida:
  - Relatividade especial (γ, β)
  - Campo magnético do ciclotron
  - Luminosidade e taxa de colisão
  - Radiação síncrotron (perda de energia por volta)
  - Beam lifetime (decaimento natural do feixe)
  - Emittance transversal (qualidade do feixe)
  - Seção de choque pp variável com energia
"""

import math

# ── Constantes físicas ───────────────────────────────────────────────────────
SPEED_OF_LIGHT   = 2.998e8      # m/s
PROTON_MASS_KG   = 1.6726e-27   # kg
PROTON_CHARGE    = 1.602e-19    # C
GEV_PER_JOULE    = 6.242e9
TEV_PER_GEV      = 1e-3
PROTON_MASS_GEV  = PROTON_MASS_KG * SPEED_OF_LIGHT**2 * GEV_PER_JOULE  # 0.938 GeV

# Parâmetros do LHC
LHC_RADIUS_M         = 2804.0
LHC_CIRCUMFERENCE_M  = 2 * math.pi * LHC_RADIUS_M
LHC_REVOLUTION_FREQ  = SPEED_OF_LIGHT / LHC_CIRCUMFERENCE_M   # ~11245 Hz
LHC_MAX_ENERGY_TEV   = 6.8
LHC_PARTICLES_BUNCH  = 1.15e11
LHC_BEAM_SIGMA_M     = 16.7e-6
LHC_MAX_FIELD_T      = 8.33
LHC_CRYO_TEMP_K      = 1.9


def lorentz_factor(energy_tev: float) -> float:
    """γ = E_total / m₀c²"""
    energy_gev = energy_tev / TEV_PER_GEV
    return (energy_gev + PROTON_MASS_GEV) / PROTON_MASS_GEV


def velocity_fraction(gamma: float) -> float:
    """β = v/c = √(1 - 1/γ²)"""
    return math.sqrt(1.0 - 1.0 / gamma**2)


def magnetic_field_tesla(energy_tev: float) -> float:
    """B = γ·m₀·v / (q·r)"""
    if energy_tev <= 0:
        return 0.0
    gamma = lorentz_factor(energy_tev)
    v = velocity_fraction(gamma) * SPEED_OF_LIGHT
    momentum = gamma * PROTON_MASS_KG * v
    return momentum / (PROTON_CHARGE * LHC_RADIUS_M)


def synchrotron_energy_loss_gev(energy_tev: float) -> float:
    """
    Energia perdida por radiação síncrotron por volta (GeV).

    U₀ = (4/3) · (r_p / (m_p c²)³) · E⁴ / R

    Forma simplificada para prótons:
      U₀ [GeV] ≈ C_γ · E⁴ [GeV] / R [m]
      C_γ = 8.85×10⁻⁵ m/GeV³

    No LHC real: ~6.7 keV/volta a 6.5 TeV (muito pequeno).
    """
    # Constante correta para prótons (PDG): C_γ = C_γe × (me/mp)³
    # Calibrada para ~8 keV/volta a 6.8 TeV (valor real do LHC)
    Cgamma = 1.0491e-17      # m GeV⁻³ (para prótons, calibrado para LHC Run 3)
    energy_gev = energy_tev / TEV_PER_GEV
    return Cgamma * energy_gev**4 / LHC_RADIUS_M


def luminosity(n_bunches: int, particles_per_bunch: float,
               beam_sigma_m: float) -> float:
    """L = f · nb · N² / (4π·σ²)  [cm⁻²s⁻¹]"""
    sigma_cm = beam_sigma_m * 100
    area = 4 * math.pi * sigma_cm**2
    return (LHC_REVOLUTION_FREQ * n_bunches * particles_per_bunch**2) / area


def pp_cross_section_mb(energy_tev: float) -> float:
    """
    Seção de choque pp variável com energia (Donnachie-Landshoff).

    σ_pp ≈ 21.7 · s^0.0808 + 56.1 · s^(-0.4525)  [mb]
    onde √s = 2·E (energia do CM em TeV)

    Valores de referência:
      7 TeV  → ~98 mb
      13 TeV → ~111 mb
    """
    sqrt_s = 2 * energy_tev   # energia centro de massa
    if sqrt_s <= 0:
        return 100.0
    s = sqrt_s**2
    return 21.7 * s**0.0808 + 56.1 * s**(-0.4525)


def collision_rate(lumi: float, cross_section_mb: float) -> float:
    """R = L · σ  [eventos/s]"""
    return lumi * cross_section_mb * 1e-27


def beam_lifetime_hours(energy_tev: float, n_bunches: int,
                        emittance_um: float) -> float:
    """
    Tempo de vida do feixe em horas.

    Limitado por:
      - Colisões (burn-off de partículas)
      - Emittance crescente (feixe se alargando)
      - Espalhamento residual de gás

    Aproximação empírica baseada no LHC Run 2:
      τ ≈ 15h × (emittance_nominal / emittance_atual)
    """
    nominal_emittance = 2.5   # μm rad (nominal)
    tau_base = 15.0           # horas (tempo de vida nominal)
    emittance_factor = max(nominal_emittance / max(emittance_um, 0.1), 0.1)
    energy_factor = min(energy_tev / LHC_MAX_ENERGY_TEV, 1.0)
    return tau_base * emittance_factor * energy_factor


def emittance_growth(emittance_um: float, energy_tev: float,
                     dt_s: float) -> float:
    """
    Crescimento da emittance transversal ao longo do tempo.

    Causado por: IBS (Intra-Beam Scattering), noise de RF,
    ressonâncias magnéticas.

    Taxa típica: ~0.5 μm/h no LHC nominal.
    """
    growth_rate = 0.5 / 3600   # μm/s
    # Cresce mais rápido em baixa energia (IBS mais intenso)
    energy_factor = 1.5 - 0.5 * min(energy_tev / LHC_MAX_ENERGY_TEV, 1.0)
    return emittance_um + growth_rate * energy_factor * dt_s


def quench_risk(beam_loss_rate: float, magnet_temp_k: float) -> float:
    """
    Risco de quench (perda de supercondutividade) entre 0 e 1.

    Um quench ocorre quando:
      - Temperatura local > 9.2K (temperatura crítica do NbTi)
      - Perdas de feixe depositam energia no imã
    """
    temp_risk = max(0.0, (magnet_temp_k - 1.9) / (9.2 - 1.9))
    loss_risk = min(beam_loss_rate / 1e8, 1.0)
    return min(temp_risk * 0.7 + loss_risk * 0.3, 1.0)
