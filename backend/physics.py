"""
physics.py — Motor de física do acelerador de partículas
=========================================================

Módulo de física completo com parâmetros reais do LHC Run 3.
Inclui: relatividade especial, óptica de feixes, emitância,
radiação síncrotron, luminosidade por IP e detecção de falhas.
"""

import math
import random


# ── Constantes físicas (SI) ──────────────────────────────────────────────────

SPEED_OF_LIGHT   = 2.99792458e8   # m/s — velocidade exata da luz
PROTON_MASS_KG   = 1.67262192e-27 # kg  — massa de repouso do próton
PROTON_CHARGE    = 1.60217663e-19 # C   — carga elementar
GEV_PER_JOULE    = 6.24150907e9   # conversão: 1 J = 6.242×10⁹ GeV
TEV_PER_GEV      = 1e-3           # 1 TeV = 1000 GeV
ELECTRON_VOLT    = 1.60217663e-19 # J

# Massa de repouso do próton em GeV (E₀ = m₀c²)
PROTON_MASS_GEV  = PROTON_MASS_KG * SPEED_OF_LIGHT**2 * GEV_PER_JOULE  # ≈ 0.938272 GeV

# Raio clássico do próton
PROTON_RADIUS_M  = 8.41e-16  # m (raio de carga)


# ── Parâmetros do LHC (Run 3, valores reais) ────────────────────────────────

LHC_CIRCUMFERENCE_M    = 26_659.0   # circunferência total do LHC (m)
LHC_RING_RADIUS_M      = LHC_CIRCUMFERENCE_M / (2 * math.pi)   # raio médio ≈ 4243 m
LHC_REVOLUTION_FREQ    = SPEED_OF_LIGHT / LHC_CIRCUMFERENCE_M  # Hz ≈ 11245 Hz
LHC_MAX_ENERGY_TEV     = 6.8        # TeV por feixe (Run 3)
LHC_INJECT_ENERGY_TEV  = 0.45       # TeV — energia de injeção do SPS
LHC_PARTICLES_PER_BUNCH = 1.15e11   # prótons por bunch (nominal)
LHC_MAX_BUNCHES        = 2556       # bunches máximos por feixe
LHC_BEAM_SIGMA_M       = 16.7e-6    # tamanho transversal do feixe (μm)
LHC_CROSS_SECTION_MB   = 100.0      # seção de choque pp em ~13 TeV (millibarn)
LHC_CRYOGENIC_TEMP_K   = 1.9        # temperatura He superfluido
LHC_MAX_FIELD_T        = 8.33       # campo máximo dos dipolos NbTi (Tesla)
LHC_RF_FREQUENCY_MHZ   = 400.43     # frequência das cavidades RF (MHz)
LHC_RF_VOLTAGE_MV      = 16.0       # tensão por cavidade RF (MV)
LHC_N_RF_CAVITIES      = 16         # cavidades RF por feixe
LHC_N_DIPOLES          = 1232       # dipolos supercondutores totais
LHC_N_QUADRUPOLES      = 392        # quadrupolos de focalização
LHC_HARMONIC_NUMBER    = 35_640     # número harmônico das RF

# Detectores nos Interaction Points
LHC_DETECTORS = {
    "IP1": {"name": "ATLAS", "angle": 0.0,               "sigma_ip_um": 11.0, "active": True},
    "IP2": {"name": "ALICE", "angle": math.pi / 2,       "sigma_ip_um": 25.0, "active": False},
    "IP5": {"name": "CMS",   "angle": math.pi,           "sigma_ip_um": 11.0, "active": True},
    "IP8": {"name": "LHCb",  "angle": 3 * math.pi / 2,   "sigma_ip_um": 30.0, "active": False},
}

# Seção de choque por experimento (pb)
CROSS_SECTIONS = {
    "ATLAS": 100.0,   # mb (total pp)
    "CMS":   100.0,
    "ALICE": 100.0,
    "LHCb":  100.0,
}


# ── Funções de física relativística ─────────────────────────────────────────

def lorentz_factor(energy_tev: float) -> float:
    """
    Fator de Lorentz γ = E_total / m₀c²

    Args:
        energy_tev: Energia cinética do próton em TeV
    Returns:
        γ — tipicamente ~7461 no LHC a 6.8 TeV
    """
    energy_gev = energy_tev / TEV_PER_GEV
    total_energy_gev = energy_gev + PROTON_MASS_GEV
    return total_energy_gev / PROTON_MASS_GEV


def velocity_fraction(gamma: float) -> float:
    """
    v/c a partir do fator de Lorentz.
    β = √(1 - 1/γ²)
    """
    if gamma <= 1.0:
        return 0.0
    return math.sqrt(1.0 - 1.0 / gamma**2)


def magnetic_field_tesla(energy_tev: float, ring_radius_m: float = LHC_RING_RADIUS_M) -> float:
    """
    Campo B (Tesla) para manter o próton no anel.
    B = p / (q·r)  onde p = γ·m₀·v
    """
    if energy_tev <= 0:
        return 0.0
    gamma = lorentz_factor(energy_tev)
    v = velocity_fraction(gamma) * SPEED_OF_LIGHT
    momentum = gamma * PROTON_MASS_KG * v
    return momentum / (PROTON_CHARGE * ring_radius_m)


def synchrotron_radiation_mev_per_turn(energy_tev: float) -> float:
    """
    Energia perdida por radiação síncrotron por volta (MeV).

    U₀ = C_γ · E⁴ / ρ
    C_γ ≈ 8.85×10⁻² m/GeV³ para prótons

    Esta é pequena (~6.7 keV a 7 TeV) mas real — causa aquecimento.
    """
    if energy_tev <= 0:
        return 0.0
    energy_gev = energy_tev * 1000.0
    C_gamma = 8.85e-5  # m/GeV³
    rho = LHC_RING_RADIUS_M   # raio de curvatura médio
    u0_gev = C_gamma * energy_gev**4 / rho
    return u0_gev * 1000.0   # GeV → MeV


def rf_energy_gain_per_turn_kev(energy_tev: float) -> float:
    """
    Ganho de energia por volta nas cavidades RF (keV).
    Deve compensar a perda síncrotron + fornecer aceleração.
    """
    # Em regime estacionário (STABLE), só compensa a perda síncrotron
    loss_mev = synchrotron_radiation_mev_per_turn(energy_tev)
    return loss_mev * 1000.0  # MeV → keV


def beam_rigidity_tm(energy_tev: float) -> float:
    """
    Rigidez magnética Bρ = p/q (T·m).
    Define quanto campo B é necessário para dobrar o feixe.
    """
    if energy_tev <= 0:
        return 0.0
    gamma = lorentz_factor(energy_tev)
    v = velocity_fraction(gamma) * SPEED_OF_LIGHT
    p = gamma * PROTON_MASS_KG * v   # kg·m/s
    return p / PROTON_CHARGE          # T·m


def normalized_emittance_um(energy_tev: float, beam_sigma_m: float = LHC_BEAM_SIGMA_M) -> float:
    """
    Emitância normalizada εₙ = γ·β·ε (μm·rad).

    A emitância descreve o volume de fase do feixe.
    Conservada pela aceleração adiabática (emitância normalizada).
    LHC nominal: εₙ ≈ 3.75 μm·rad
    """
    if energy_tev <= 0:
        return 0.0
    gamma = lorentz_factor(energy_tev)
    beta = velocity_fraction(gamma)
    beta_function_m = 0.55   # função β nos IPs (β* = 0.55 m no Run 3)
    epsilon_m = beam_sigma_m**2 / beta_function_m
    return gamma * beta * epsilon_m * 1e6   # rad → μm·rad


def tune_values(energy_tev: float) -> tuple:
    """
    Tune do feixe (Qx, Qy) — número de oscilações de betatron por volta.

    No LHC: Qx ≈ 64.31, Qy ≈ 59.32 (valores operacionais).
    Pequenas variações com energia por efeito das aberrações magnéticas.
    """
    # Variação simplificada com energia (efeito de cromatic)
    dq = (energy_tev - LHC_INJECT_ENERGY_TEV) / LHC_MAX_ENERGY_TEV * 0.02
    qx = 64.31 + dq + random.gauss(0, 0.001)
    qy = 59.32 + dq * 0.8 + random.gauss(0, 0.001)
    return round(qx, 4), round(qy, 4)


def chromaticity(energy_tev: float) -> tuple:
    """
    Cromaticidade (Q'x, Q'y) — variação do tune com momento.
    Controlada pelos sextupoles. Alvo operacional: Q' ≈ +2.
    """
    base = 2.0
    spread = 0.3
    return (
        round(base + random.gauss(0, spread), 2),
        round(base + random.gauss(0, spread), 2)
    )


def beam_current_ma(n_bunches: int, particles_per_bunch: float, energy_tev: float) -> float:
    """
    Corrente de feixe (mA).
    I = q · N · n_bunches · f_rev
    """
    if n_bunches <= 0 or energy_tev <= 0:
        return 0.0
    gamma = lorentz_factor(energy_tev)
    beta = velocity_fraction(gamma)
    f_rev = beta * SPEED_OF_LIGHT / LHC_CIRCUMFERENCE_M
    current_a = PROTON_CHARGE * particles_per_bunch * n_bunches * f_rev
    return current_a * 1000.0  # A → mA


def luminosity_per_ip(
    n_bunches: int,
    particles_per_bunch: float,
    energy_tev: float,
    sigma_ip_um: float = 11.0,
    crossing_angle_urad: float = 285.0,
    leveling_factor: float = 1.0
) -> float:
    """
    Luminosidade instantânea num Interaction Point (cm⁻²·s⁻¹).

    L = (f_rev · n_b · N²) / (4π · σ_x · σ_y) · F(θ_c)

    F = fator de redução geométrico pelo ângulo de cruzamento
    """
    if n_bunches <= 0 or energy_tev <= 0:
        return 0.0

    gamma = lorentz_factor(energy_tev)
    beta_val = velocity_fraction(gamma)
    f_rev = beta_val * SPEED_OF_LIGHT / LHC_CIRCUMFERENCE_M

    sigma_m = sigma_ip_um * 1e-6
    sigma_cm = sigma_m * 100.0
    area_cm2 = 4.0 * math.pi * sigma_cm**2

    lumi = (f_rev * n_bunches * particles_per_bunch**2) / area_cm2

    # Fator geométrico pelo ângulo de cruzamento
    theta_c_rad = crossing_angle_urad * 1e-6
    sigma_l_m = 7.55e-2  # comprimento do bunch (m) ≈ 7.55 cm RMS
    phi = theta_c_rad / 2.0 * sigma_l_m / sigma_m
    geometric_factor = 1.0 / math.sqrt(1.0 + phi**2)

    return lumi * geometric_factor * leveling_factor


def luminosity(
    n_bunches: int,
    particles_per_bunch: float,
    revolution_freq_hz: float,
    beam_sigma_m: float
) -> float:
    """Compatibilidade com interface anterior."""
    sigma_cm = beam_sigma_m * 100.0
    area_cm2 = 4.0 * math.pi * sigma_cm**2
    return (revolution_freq_hz * n_bunches * particles_per_bunch**2) / area_cm2


def collision_rate(lumi: float, cross_section_mb: float) -> float:
    """
    Taxa de eventos de colisão por segundo.
    R = L · σ
    """
    cross_section_cm2 = cross_section_mb * 1e-27
    return lumi * cross_section_cm2


def pileup_mu(lumi: float, n_bunches: int, revolution_freq_hz: float) -> float:
    """
    Pileup μ = número médio de interações pp por cruzamento de bunches.
    μ = L · σ_inel / (n_b · f_rev)
    No Run 3: μ ≈ 50-60.
    """
    if n_bunches <= 0:
        return 0.0
    sigma_inel_cm2 = 80e-27   # seção de choque inelástica ≈ 80 mb
    bunch_crossing_rate = n_bunches * revolution_freq_hz
    return (lumi * sigma_inel_cm2) / bunch_crossing_rate


def integrated_luminosity_inv_fb(total_events: int) -> float:
    """
    Luminosidade integrada (fb⁻¹) acumulada.
    L_int = N_eventos / σ
    """
    sigma_cm2 = LHC_CROSS_SECTION_MB * 1e-27
    sigma_inv_fb = 1.0 / (sigma_cm2 * 1e39)  # cm⁻² → fb⁻¹
    return total_events * sigma_inv_fb


def quench_probability(magnetic_field_t: float, temperature_k: float) -> float:
    """
    Probabilidade de quench (perda de supercondutividade) por segundo.

    Os ímãs NbTi do LHC têm campo crítico ~9.5 T a 1.9 K.
    Operamos a 8.33 T — margem de segurança de ~14%.
    """
    if temperature_k <= 0:
        return 0.0
    # Campo crítico do NbTi como função da temperatura (aproximação linear)
    t_c = 9.2      # temperatura crítica do NbTi (K)
    b_c2 = 14.5    # campo crítico superior a 0 K (T)
    b_critical = b_c2 * (1.0 - (temperature_k / t_c)**2)

    if magnetic_field_t <= 0 or b_critical <= 0:
        return 0.0

    # Margem de segurança
    margin = (b_critical - magnetic_field_t) / b_critical
    if margin <= 0:
        return 1.0  # quench certo

    # Probabilidade muito baixa em operação normal, alta perto do limite
    base_rate = 1e-6   # eventos/s em operação normal
    return base_rate * math.exp(-margin * 20.0)


def beam_lifetime_hours(energy_tev: float, luminosity_val: float) -> float:
    """
    Vida útil estimada do feixe (horas).

    Limitada principalmente por: colisões, emitância e varrição de gás.
    Típico no LHC: ~10-20 horas de física.
    """
    if energy_tev <= 0:
        return 0.0
    # Contribuição das colisões (burnoff)
    if luminosity_val > 0:
        sigma_cm2 = LHC_CROSS_SECTION_MB * 1e-27
        n_total = LHC_MAX_BUNCHES * LHC_PARTICLES_PER_BUNCH
        collision_burnoff = luminosity_val * sigma_cm2 * 2.0 / n_total
        # horas de vida por burnoff
        if collision_burnoff > 0:
            tau_burnoff_h = 1.0 / (collision_burnoff * 3600.0)
        else:
            tau_burnoff_h = 1000.0
    else:
        tau_burnoff_h = 1000.0

    # Vida útil total (combinação de efeitos)
    tau_ibs_h = 80.0   # intra-beam scattering
    tau_total = 1.0 / (1.0/tau_burnoff_h + 1.0/tau_ibs_h)
    return round(min(tau_total, 99.9), 1)


def temperature_with_radiation(base_k: float, energy_tev: float, uptime_s: float) -> float:
    """
    Temperatura considerando aquecimento por radiação síncrotron.
    O He superfluido absorve ~3.6 kW por feixe em 7 TeV.
    """
    if energy_tev <= 0:
        return base_k
    u0_mev = synchrotron_radiation_mev_per_turn(energy_tev)
    gamma_val = lorentz_factor(energy_tev)
    beta_val = velocity_fraction(gamma_val)
    f_rev = beta_val * SPEED_OF_LIGHT / LHC_CIRCUMFERENCE_M
    power_w = u0_mev * 1e6 * ELECTRON_VOLT * LHC_MAX_BUNCHES * LHC_PARTICLES_PER_BUNCH * f_rev
    # Aquecimento muito pequeno (o sistema criogênico compensa)
    delta_t = power_w / (500e3 * 4186.0) * min(uptime_s, 3600.0)
    return round(base_k + delta_t * 0.001, 3)


def kinetic_energy_tev(beta: float) -> float:
    """Energia cinética relativística em TeV a partir de v/c."""
    if beta >= 1.0:
        beta = 0.9999999
    gamma = 1.0 / math.sqrt(1.0 - beta**2)
    energy_gev = (gamma - 1.0) * PROTON_MASS_GEV
    return energy_gev * TEV_PER_GEV
