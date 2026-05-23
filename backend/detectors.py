"""
detectors.py — Os 4 detectores do LHC
=======================================

Cada detector tem física e propósito diferentes:

  ATLAS — detector de uso geral, busca Higgs e nova física
  CMS   — detector de uso geral, câmara de múons compacta
  ALICE — física de íons pesados, plasma quark-gluon
  LHCb  — assimetria matéria/antimatéria (violação CP)

Cada um acumula eventos, luminosidade integrada e
detecta diferentes tipos de partículas.
"""

import math
import random
from dataclasses import dataclass, field, asdict


# ── Tipos de eventos por detector ────────────────────────────────────────────

ATLAS_EVENTS = ["Higgs→γγ", "Higgs→ZZ", "W boson", "Z boson", "Top quark pair", "SUSY candidate"]
CMS_EVENTS   = ["Higgs→bb̄", "Higgs→ττ", "Dimuon", "Dijet", "MET signal", "Graviton candidate"]
ALICE_EVENTS = ["J/ψ", "Υ(1S)", "D meson", "Λc baryon", "Quark-Gluon Plasma", "Charm pair"]
LHCb_EVENTS  = ["B⁰→J/ψK⁰", "Bs→μμ", "CP violation", "B⁺→K⁺μμ", "Rare decay", "D⁰ mixing"]

# Posição angular de cada IP no anel (radianos)
DETECTOR_ANGLES = {
    "ATLAS": 0,
    "CMS":   math.pi,
    "ALICE": math.pi / 2,
    "LHCb":  3 * math.pi / 2,
}

# Seção de choque efetiva relativa de cada detector
DETECTOR_ACCEPTANCE = {
    "ATLAS": 1.00,
    "CMS":   0.95,
    "ALICE": 0.30,   # só fragmento do feixe (IP2)
    "LHCb":  0.15,   # detector forward, ângulo pequeno
}


@dataclass
class Detector:
    """Estado de um único detector."""
    name: str
    angle: float                          # posição no anel (rad)
    acceptance: float                     # fração de eventos capturados
    event_types: list                     # tipos de evento que detecta

    total_events: int = 0                 # eventos acumulados
    integrated_lumi: float = 0.0          # luminosidade integrada (fb⁻¹)
    last_event: str = ""                  # último tipo de evento detectado
    last_event_timer: float = 0.0         # tempo desde último evento (s)
    active: bool = False
    temperature_k: float = 90.0          # temperatura operacional (K)
    # ATLAS e CMS: ~90K; ALICE e LHCb: temperatura ambiente

    # Histórico de taxa de eventos (últimos 60 pontos)
    rate_history: list = field(default_factory=list)
    current_rate: float = 0.0

    def tick(self, collision_rate: float, lumi: float, dt: float):
        """Atualiza o detector a cada tick de simulação."""
        if not self.active or collision_rate <= 0:
            self.current_rate = 0.0
            return

        # Taxa de eventos neste detector
        self.current_rate = collision_rate * self.acceptance

        # Acumula eventos
        new_events = self.current_rate * dt
        self.total_events += int(new_events)

        # Luminosidade integrada em fb⁻¹ (1 fb⁻¹ = 10⁴⁰ cm⁻²)
        self.integrated_lumi += lumi * self.acceptance * dt * 1e-40

        # Sorteia evento notável aleatório
        self.last_event_timer += dt
        if self.last_event_timer > (0.5 / max(self.acceptance, 0.01)):
            if random.random() < 0.3:
                self.last_event = random.choice(self.event_types)
            self.last_event_timer = 0.0

        # Histórico de taxa (1 ponto por segundo)
        self.rate_history.append(round(self.current_rate))
        if len(self.rate_history) > 60:
            self.rate_history.pop(0)

    def to_dict(self) -> dict:
        d = asdict(self)
        d.pop("event_types")   # não serializa a lista de tipos
        return d


class DetectorArray:
    """Gerencia os 4 detectores do LHC."""

    def __init__(self):
        self.detectors = {
            "ATLAS": Detector("ATLAS", DETECTOR_ANGLES["ATLAS"], DETECTOR_ACCEPTANCE["ATLAS"], ATLAS_EVENTS),
            "CMS":   Detector("CMS",   DETECTOR_ANGLES["CMS"],   DETECTOR_ACCEPTANCE["CMS"],   CMS_EVENTS),
            "ALICE": Detector("ALICE", DETECTOR_ANGLES["ALICE"], DETECTOR_ACCEPTANCE["ALICE"], ALICE_EVENTS),
            "LHCb":  Detector("LHCb",  DETECTOR_ANGLES["LHCb"],  DETECTOR_ACCEPTANCE["LHCb"],  LHCb_EVENTS),
        }

    def activate(self):
        for d in self.detectors.values():
            d.active = True

    def deactivate(self):
        for d in self.detectors.values():
            d.active = False
            d.current_rate = 0.0

    def tick(self, collision_rate: float, lumi: float, dt: float):
        for d in self.detectors.values():
            d.tick(collision_rate, lumi, dt)

    def reset(self):
        self.__init__()

    def to_dict(self) -> dict:
        return {name: d.to_dict() for name, d in self.detectors.items()}
