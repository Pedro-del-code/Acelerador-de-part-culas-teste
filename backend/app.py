"""
app.py — Servidor Flask do Acelerador de Partículas
====================================================

Expõe a API REST e o stream SSE que alimenta o frontend em tempo real.

Rotas:
  GET  /                   → Serve o frontend (index.html)
  POST /api/command/<cmd>  → Envia comandos ao acelerador
  GET  /api/stream         → Stream SSE com status em tempo real
  GET  /api/status         → Snapshot único do estado atual

Para rodar localmente:
  pip install flask gunicorn
  python app.py

Para deploy no Render:
  Build Command:  pip install -r requirements.txt
  Start Command:  gunicorn --chdir backend app:app --bind 0.0.0.0:$PORT --threads 4
"""

import json
import time
import threading
import os
from flask import Flask, render_template, jsonify, request, Response, stream_with_context

from accelerator import Accelerator, AcceleratorState

# ── Caminhos absolutos baseados na localização deste arquivo ─────────────────
# os.path.abspath(__file__) garante que funciona de qualquer diretório,
# inclusive quando o gunicorn sobe via --chdir no Render.
_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)   # pasta hadron/

# ── Inicialização ────────────────────────────────────────────────────────────

app = Flask(
    __name__,
    template_folder=os.path.join(_ROOT, "frontend", "templates"),
    static_folder=os.path.join(_ROOT, "frontend", "static"),
)

# CORS manual — sem dependência externa
@app.after_request
def add_cors(response):
    response.headers["Access-Control-Allow-Origin"]  = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response

# Instância global do acelerador (compartilhada entre threads)
accel = Accelerator()

# Lock para acesso thread-safe ao acelerador
accel_lock = threading.Lock()

# Tick rate da simulação
TICK_INTERVAL = 0.1   # segundos reais entre ticks (10 Hz)
SIM_DT        = 0.5   # "segundos simulados" por tick


# ── Thread de simulação ──────────────────────────────────────────────────────

def simulation_loop():
    """
    Roda em background, avançando a física a cada TICK_INTERVAL segundos.
    Separado das rotas HTTP para não bloquear requisições.
    O gunicorn com --threads compartilha este processo, então o daemon=True
    garante que a thread encerra junto com o worker.
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
    """Snapshot único do estado atual — usado na inicialização do frontend."""
    with accel_lock:
        return jsonify(accel.status.to_dict())


@app.route("/api/command/<cmd>", methods=["POST"])
def api_command(cmd: str):
    """
    Executa um comando no acelerador.

    Comandos válidos:
      inject     — injeta o feixe (body JSON opcional: {"n_bunches": 2556})
      accelerate — inicia rampa de energia via cavidades RF
      collide    — ativa colisões nos pontos de interação
      dump       — descarta o feixe e reseta o sistema

    Retorna: { "success": bool, "message": str }
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
    Server-Sent Events — empurra o estado do acelerador ao frontend em tempo real.

    Por que SSE e não WebSocket?
      - Fluxo unidirecional (servidor → cliente) — SSE é mais simples
      - Reconexão automática pelo browser
      - Funciona nativamente com fetch/EventSource, sem biblioteca

    Notas para produção (Render):
      - O header X-Accel-Buffering: no desativa o buffer do nginx/proxy
      - O timeout de 25s evita que o Render feche conexões inativas
        (o Render tem timeout de 30s em conexões sem atividade)
    """
    def event_generator():
        last_snapshot = None
        last_heartbeat = time.time()

        while True:
            with accel_lock:
                snapshot = accel.status.to_dict()

            now = time.time()

            # Envia dados se algo mudou
            if snapshot != last_snapshot:
                payload = json.dumps(snapshot)
                yield f"data: {payload}\n\n"
                last_snapshot = snapshot
                last_heartbeat = now

            # Heartbeat a cada 25s para manter a conexão viva no Render
            # (o proxy fecha conexões sem atividade após ~30s)
            elif now - last_heartbeat > 25:
                yield ": heartbeat\n\n"
                last_heartbeat = now

            time.sleep(TICK_INTERVAL)

    return Response(
        stream_with_context(event_generator()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control":      "no-cache",
            "X-Accel-Buffering":  "no",    # desativa buffer do nginx/Render proxy
            "Connection":         "keep-alive",
        }
    )


# ── Entry point (desenvolvimento local) ─────────────────────────────────────
# No Render, o gunicorn importa `app` diretamente — este bloco não executa.
# debug=False é obrigatório com gunicorn (o reloader do debug conflita).

if __name__ == "__main__":
    print("=" * 55)
    print("  HADRON — Particle Accelerator Simulator")
    print("  http://localhost:5000")
    print("  Para produção: gunicorn app:app --threads 4")
    print("=" * 55)
    app.run(debug=False, threaded=True, port=5000)
