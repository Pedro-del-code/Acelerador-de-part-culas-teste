"""
app.py — Servidor Flask do Acelerador de Partículas
====================================================

Expõe a API REST e o stream SSE que alimenta o frontend em tempo real.

Rotas:
  GET  /                   → Serve o frontend (index.html)
  POST /api/command/<cmd>  → Envia comandos ao acelerador
  GET  /api/stream         → Stream SSE com status em tempo real
  GET  /api/status         → Snapshot único do estado atual

Para rodar:
  pip install flask flask-cors
  python app.py
"""

import json
import time
import threading
import os
from flask import Flask, render_template, jsonify, request, Response, stream_with_context

from accelerator import Accelerator, AcceleratorState

# ── Caminhos absolutos baseados na localização deste arquivo ─────────────────
# Usando os.path.dirname(__file__) garantimos que os caminhos funcionam
# independente de onde o usuário rodar o comando `python app.py`.
_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)   # pasta hadron/

# ── Inicialização ────────────────────────────────────────────────────────────

app = Flask(
    __name__,
    template_folder=os.path.join(_ROOT, "frontend", "templates"),
    static_folder=os.path.join(_ROOT, "frontend", "static"),
)

# CORS manual — sem dependência de flask-cors
@app.after_request
def add_cors(response):
    response.headers["Access-Control-Allow-Origin"]  = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response

# Instância global do acelerador (compartilhada entre threads)
accel = Accelerator()

# Lock para acesso thread-safe ao acelerador
accel_lock = threading.Lock()

# Tick rate da simulação (segundos entre atualizações)
TICK_INTERVAL = 0.1   # 10 Hz
SIM_DT        = 0.5   # "segundos simulados" por tick (rampa mais rápida na demo)


# ── Thread de simulação ──────────────────────────────────────────────────────

def simulation_loop():
    """
    Roda em background, avançando a física a cada TICK_INTERVAL segundos.
    Separado das rotas HTTP para não bloquear requisições.
    """
    while True:
        with accel_lock:
            accel.tick(dt=SIM_DT)
        time.sleep(TICK_INTERVAL)

sim_thread = threading.Thread(target=simulation_loop, daemon=True)
sim_thread.start()


# ── Rotas ────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    """Serve a página principal do frontend."""
    return render_template("index.html")


@app.route("/api/status")
def api_status():
    """
    Retorna snapshot único do estado atual.
    Útil para inicialização do frontend.
    """
    with accel_lock:
        return jsonify(accel.status.to_dict())


@app.route("/api/command/<cmd>", methods=["POST"])
def api_command(cmd: str):
    """
    Executa um comando no acelerador.

    Comandos válidos:
      inject    — injeta o feixe (opcionalmente recebe n_bunches no body)
      accelerate — inicia rampa de energia
      collide   — ativa colisões
      dump      — descarta o feixe

    Retorna JSON com { success: bool, message: str }
    """
    handlers = {
        "inject":     _cmd_inject,
        "accelerate": lambda: accel.cmd_accelerate(),
        "collide":    lambda: accel.cmd_collide(),
        "dump":       lambda: accel.cmd_dump(),
    }

    if cmd not in handlers:
        return jsonify({"success": False, "message": f"Comando desconhecido: {cmd}"}), 400

    with accel_lock:
        result = handlers[cmd]()

    return jsonify(result)


def _cmd_inject():
    """Extrai parâmetros do body JSON e chama cmd_inject."""
    body = request.get_json(silent=True) or {}
    n_bunches = int(body.get("n_bunches", 2556))
    return accel.cmd_inject(n_bunches=n_bunches)


@app.route("/api/stream")
def api_stream():
    """
    Server-Sent Events — envia o estado do acelerador ao frontend
    continuamente, sem polling.

    O frontend recebe eventos assim:
      data: {"state": "COLLIDING", "energy_tev": 6.8, ...}

    SSE é ideal aqui porque:
      - O servidor empurra dados (não o cliente que pede)
      - Reconexão automática pelo browser
      - Sem overhead de WebSocket para fluxo unidirecional
    """
    def event_generator():
        last_snapshot = None
        while True:
            with accel_lock:
                snapshot = accel.status.to_dict()

            # Só envia se algo mudou (economiza banda)
            if snapshot != last_snapshot:
                payload = json.dumps(snapshot)
                yield f"data: {payload}\n\n"
                last_snapshot = snapshot

            time.sleep(TICK_INTERVAL)

    return Response(
        stream_with_context(event_generator()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",   # desativa buffer do nginx
        }
    )


# ── Entry point ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("=" * 55)
    print("  HADRON — Particle Accelerator Simulator")
    print("  Servidor rodando em http://localhost:5000")
    print("=" * 55)
    app.run(debug=True, threaded=True, port=5000)
