from __future__ import annotations

import json
import os
import sys
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from typing import Any


SERVICE_PATH = Path(__file__).resolve().parents[1] / "service"
if str(SERVICE_PATH) not in sys.path:
    sys.path.insert(0, str(SERVICE_PATH))

# nleis imports matplotlib. Vercel functions have a writable /tmp directory,
# but the default home cache location is not guaranteed to be writable.
matplotlib_cache = Path("/tmp/impedance-studio-matplotlib")
matplotlib_cache.mkdir(parents=True, exist_ok=True)
os.environ.setdefault("MPLCONFIGDIR", str(matplotlib_cache))

from impedance_studio.fitting import fit_eis_dataset, fit_joint_datasets


class handler(BaseHTTPRequestHandler):
    """Vercel Python Function for real nleis.py joint fits."""

    def do_POST(self) -> None:
        try:
            payload = self._read_json()
            if "second_dataset" in payload:
                analysis = fit_joint_datasets(
                    payload["eis_dataset"],
                    payload["second_dataset"],
                    payload["model"],
                    max_f=payload.get("max_f", 10),
                )
            else:
                analysis = fit_eis_dataset(
                    payload["eis_dataset"],
                    payload["model"],
                )
            self._send_json({"analysis": analysis})
        except (KeyError, TypeError, ValueError, RuntimeError) as exc:
            self._send_json({"error": str(exc)}, status=400)
        except Exception as exc:  # pragma: no cover - production guardrail
            self._send_json({"error": f"nleis fitting failed: {exc}"}, status=500)

    def do_OPTIONS(self) -> None:
        self._send_json({"ok": True})

    def _read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            raise ValueError("A JSON fit request body is required.")
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def _send_json(self, payload: dict[str, Any], *, status: int = 200) -> None:
        body = json.dumps(payload, allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)
