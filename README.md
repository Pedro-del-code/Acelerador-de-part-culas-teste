# HADRON — Particle Accelerator Simulator

Simulador didático de um acelerador de hadrons (inspirado no LHC do CERN),
construído com **Python + Flask** no backend e **HTML/CSS/JS canvas** no frontend.

---

## Estrutura do projeto

```
hadron/
│
├── backend/
│   ├── physics.py        # Motor de física: fórmulas relativísticas puras
│   ├── accelerator.py    # Máquina de estados do acelerador
│   └── app.py            # Servidor Flask: rotas REST + stream SSE
│
├── frontend/
│   ├── templates/
│   │   └── index.html    # Página principal (Jinja2)
│   └── static/
│       ├── css/
│       │   └── style.css         # Visual sci-fi / industrial
│       └── js/
│           └── accelerator.js    # Canvas renderer + cliente SSE
│
├── requirements.txt
└── README.md
```

### Por que essa separação?

| Arquivo | Responsabilidade única |
|---|---|
| `physics.py` | Só fórmulas — nenhuma lógica de estado |
| `accelerator.py` | Só estado — chama physics, não sabe de HTTP |
| `app.py` | Só transporte — não tem física nem estado próprio |
| `accelerator.js` | Só visualização — não calcula física |
| `style.css` | Só aparência — zero lógica |

Cada arquivo pode ser lido, testado e modificado de forma independente.

---

## Como rodar

```bash
# 1. Clonar / entrar na pasta
cd hadron

# 2. Instalar dependências
pip install -r requirements.txt

# 3. Iniciar o servidor
python backend/app.py

# 4. Abrir no browser
# http://localhost:5000
```

---

## Conceitos físicos implementados

### Relatividade especial

O fator de Lorentz γ (gamma) descreve o quanto um próton em alta velocidade
"pesa" a mais e "envelhece" mais devagar:

```
γ = E_total / (m₀c²) = 1 / √(1 - v²/c²)
```

No LHC a 6.8 TeV: **γ ≈ 7461** — o próton viaja a **99.9999991% da velocidade da luz**.

### Equação do ciclotron relativístico

O campo magnético B necessário para curvar o próton num anel de raio r:

```
B = p / (q·r) = γ·m₀·v / (q·r)
```

O LHC usa **8.33 Tesla** — o mais forte campo magnético sustentado em escala industrial,
mantido por ímãs supercondutores a **1.9 Kelvin** (mais frio que o espaço exterior).

### Luminosidade

Mede quantas colisões ocorrem por segundo por área:

```
L = f · nb · N² / (4π·σx·σy)
```

Onde:
- `f` = frequência de revolução (~11.245 Hz)
- `nb` = número de bunches (até 2556)
- `N` = prótons por bunch (~1.15 × 10¹¹)
- `σ` = tamanho transversal do feixe (~16 μm)

### Taxa de colisão

```
R = L · σ_pp
```

A seção de choque (σ_pp) é a "área de alvo" de um próton — em 13 TeV,
vale ~100 millibarn. Isso dá **~800 milhões de colisões por segundo** no LHC real.

---

## Fluxo de dados

```
[Botão HTML]
     │  onclick → sendCommand("inject")
     ▼
[accelerator.js]
     │  POST /api/command/inject
     ▼
[app.py]
     │  cmd_inject()
     ▼
[accelerator.py]
     │  valida estado, atualiza AcceleratorStatus
     ▼
[physics.py]
     │  lorentz_factor(), magnetic_field_tesla()
     ▼
[accelerator.py → app.py]
     │  SSE stream: GET /api/stream
     ▼
[accelerator.js]
     │  applyBackendState() → updateTelemetry() + render()
     ▼
[Canvas HTML]
```

---

## Ciclo de operação

```
IDLE
 │  cmd_inject()    → verifica estado IDLE
 ▼
INJECTED            → 0.45 TeV (energia de injeção do SPS)
 │  cmd_accelerate() → liga cavidades RF 400 MHz
 ▼
ACCELERATING        → rampa de 0.45 → 6.8 TeV
 │  (automático ao atingir 6.8 TeV)
 ▼
STABLE              → feixes estáveis, prontos
 │  cmd_collide()   → aplica ângulo de cruzamento
 ▼
COLLIDING           → colisões nos IPs, luminosidade ativa
 │  cmd_dump()      → qualquer estado
 ▼
IDLE                → beam dump, reset completo
```

---

## Referências

- [CERN — LHC Guide](https://cds.cern.ch/record/2255762)
- [PDG — Particle Data Group](https://pdg.lbl.gov/)
- Griffiths, D. — *Introduction to Electrodynamics* (campo magnético ciclotron)
- Taylor, E. & Wheeler, J. — *Spacetime Physics* (relatividade especial)
