"""
physics.py — Motor de física do acelerador de partículas
=========================================================

Este módulo é o coração da simulação. Ele calcula:
  - Energia relativística das partículas
  - Campo magnético necessário para curvar o feixe
  - Luminosidade do feixe
  - Detecção e estatísticas de colisão

Conceitos físicos usados:
  - Relatividade especial (fator de Lorentz γ)
  - Equação do ciclotron: p = qBr
  - Luminosidade: L = f · n₁ · n₂ / A
"""

import math


# ── Constantes físicas (SI) ──────────────────────────────────────────────────

SPEED_OF_LIGHT = 3e8          # m/s — velocidade da luz
PROTON_MASS_KG = 1.6726e-27   # kg  — massa de repouso do próton
PROTON_CHARGE  = 1.602e-19    # C   — carga elementar
GEV_PER_JOULE  = 6.242e9      # conversão: 1 J = 6.242×10⁹ GeV
TEV_PER_GEV    = 1e-3         # 1 TeV = 1000 GeV

# Massa de repouso do próton em GeV (E₀ = m₀c²)
PROTON_MASS_GEV = PROTON_MASS_KG * SPEED_OF_LIGHT**2 * GEV_PER_JOULE  # ≈ 0.938 GeV


# ── Funções de física relativística ─────────────────────────────────────────

def lorentz_factor(energy_tev: float) -> float:
    """
    Calcula o fator de Lorentz γ (gamma) de um próton.

    γ = E_total / E_repouso = (E_cinética + m₀c²) / m₀c²

    Para altíssimas energias, γ >> 1 significa que o próton
    viaja a fração enorme da velocidade da luz.

    Args:
        energy_tev: Energia cinética do próton em TeV

    Returns:
        γ (adimensional) — tipicamente ~7000 no LHC real
    """
    energy_gev = energy_tev / TEV_PER_GEV          # converte TeV → GeV
    total_energy_gev = energy_gev + PROTON_MASS_GEV # E_total = E_cin + m₀c²
    return total_energy_gev / PROTON_MASS_GEV        # γ = E_total / m₀c²


def velocity_fraction(gamma: float) -> float:
    """
    Calcula v/c a partir do fator de Lorentz.

    Da relatividade: γ = 1/√(1 - v²/c²)
    Isolando:        v/c = √(1 - 1/γ²)

    Args:
        gamma: Fator de Lorentz γ

    Returns:
        v/c — fração da velocidade da luz (0 a 1)
    """
    return math.sqrt(1 - 1 / gamma**2)


def magnetic_field_tesla(energy_tev: float, ring_radius_m: float) -> float:
    """
    Campo magnético necessário para manter o próton no anel.

    Da equação do ciclotron relativístico:
        p = γ·m₀·v  (momento relativístico)
        p = q·B·r   (equilíbrio centrípeto/magnético)
    Logo:
        B = p / (q·r) = γ·m₀·v / (q·r)

    Args:
        energy_tev:    Energia em TeV
        ring_radius_m: Raio do anel em metros

    Returns:
        Campo B em Tesla (LHC real usa ~8.33 T)
    """
    gamma = lorentz_factor(energy_tev)
    v = velocity_fraction(gamma) * SPEED_OF_LIGHT   # velocidade em m/s
    momentum = gamma * PROTON_MASS_KG * v           # momento relativístico (kg·m/s)
    return momentum / (PROTON_CHARGE * ring_radius_m)


def luminosity(
    n_bunches: int,
    particles_per_bunch: float,
    revolution_freq_hz: float,
    beam_sigma_m: float
) -> float:
    """
    Luminosidade instantânea do feixe (cm⁻²·s⁻¹).

    L = f · nb · N² / (4π·σx·σy)

    Onde:
        f   = frequência de revolução
        nb  = número de bunches por feixe
        N   = partículas por bunch
        σ   = tamanho transversal do feixe (assumindo σx = σy)

    Args:
        n_bunches:           Número de bunches por feixe
        particles_per_bunch: Partículas em cada bunch (N)
        revolution_freq_hz:  Frequência de revolução em Hz
        beam_sigma_m:        Tamanho do feixe em metros (σ)

    Returns:
        Luminosidade em cm⁻²·s⁻¹
    """
    sigma_cm = beam_sigma_m * 100                        # m → cm
    area_cm2 = 4 * math.pi * sigma_cm**2                # área efetiva de colisão
    return (revolution_freq_hz * n_bunches * particles_per_bunch**2) / area_cm2


def collision_rate(lumi: float, cross_section_mb: float) -> float:
    """
    Taxa de eventos de colisão por segundo.

    R = L · σ

    Onde σ é a seção de choque (cross section) — probabilidade
    de interação. Para próton-próton em 13 TeV: σ ≈ 100 mb.

    Args:
        lumi:             Luminosidade em cm⁻²·s⁻¹
        cross_section_mb: Seção de choque em millibarn (1 mb = 10⁻²⁷ cm²)

    Returns:
        Taxa de colisões por segundo
    """
    cross_section_cm2 = cross_section_mb * 1e-27   # mb → cm²
    return lumi * cross_section_cm2


def kinetic_energy_tev(beta: float) -> float:
    """
    Energia cinética relativística em TeV a partir de v/c.

    E_cin = (γ - 1) · m₀c²

    Args:
        beta: v/c (velocidade como fração da luz)

    Returns:
        Energia cinética em TeV
    """
    if beta >= 1.0:
        beta = 0.9999999
    gamma = 1 / math.sqrt(1 - beta**2)
    energy_gev = (gamma - 1) * PROTON_MASS_GEV
    return energy_gev * TEV_PER_GEV
