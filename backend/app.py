"""
app.py — Servidor Flask do HADRON v4
=====================================

Rotas:
  GET  /                          → Frontend
  POST /api/command/<cmd>         → Comandos ao acelerador
  POST /api/detector/<ip>/toggle  → Ativa/desativa detector
  GET  /api/stream                → SSE em tempo real
  GET  /api/status                → Snapshot único
"""

import json
import time
import threading
import os
from flask import Flask, render_template, jsonify, request, Response, stream_with_context
from accelerator import Accelerator, AcceleratorState

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)

app = Flask(
    __name__,
    template_folder=os.path.join(_ROOT, "frontend", "templates"),
    static_folder=os.path.join(_ROOT, "frontend", "static"),
)

@app.after_request
def add_cors(response):
    response.headers["Access-Control-Allow-Origin"]  = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response

accel = Accelerator()
accel_lock = threading.Lock()

TICK_INTERVAL = 0.1
SIM_DT        = 0.5


def simulation_loop():
    while True:
        with accel_lock:
            accel.tick(dt=SIM_DT)
        time.sleep(TICK_INTERVAL)

sim_thread = threading.Thread(target=simulation_loop, daemon=True)
sim_thread.start()


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/status")
def api_status():
    with accel_lock:
        return jsonify(accel.status.to_dict())


@app.route("/api/command/<cmd>", methods=["POST"])
def api_command(cmd: str):
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


@app.route("/api/detector/<ip>/toggle", methods=["POST"])
def api_toggle_detector(ip: str):
    """Ativa ou desativa um detector específico durante colisões."""
    with accel_lock:
        result = accel.cmd_activate_detector(ip.upper())
    return jsonify(result)


def _cmd_inject():
    body = request.get_json(silent=True) or {}
    n_bunches = int(body.get("n_bunches", 2556))
    return accel.cmd_inject(n_bunches=n_bunches)


@app.route("/api/stream")
def api_stream():
    def event_generator():
        last_snapshot = None
        while True:
            with accel_lock:
                snapshot = accel.status.to_dict()

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
            "X-Accel-Buffering": "no",
        }
    )


if __name__ == "__main__":
    print("=" * 55)
    print("  HADRON v4 — Particle Accelerator Simulator")
    print("  Servidor rodando em http://localhost:5000")
    print("=" * 55)
    app.run(debug=True, threaded=True, port=5000)
