from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any, Optional
from urllib.parse import parse_qs, urlparse

from .storage import StudioStore, default_db_path


class StudioHandler(BaseHTTPRequestHandler):
    store: StudioStore

    def do_OPTIONS(self) -> None:
        self._send_json({"ok": True})

    def do_GET(self) -> None:
        try:
            path, query = self._path_query()
            if path == "/health":
                self._send_json(self.store.health())
            elif path == "/projects":
                self._send_json({"projects": self.store.list_projects()})
            elif path == "/datasets":
                self._send_json({"datasets": self.store.list_datasets(_one(query, "project_id"))})
            elif path == "/models":
                self._send_json({"models": self.store.list_models(_one(query, "project_id"))})
            elif path.startswith("/models/") and path.endswith("/export-json"):
                model_id = path.split("/")[2]
                self._send_json({"model_json": self.store.export_model_json(model_id)})
            elif path == "/runs":
                self._send_json({"runs": self.store.list_runs(_one(query, "project_id"))})
            else:
                self._send_json({"error": f"not found: {path}"}, status=404)
        except Exception as exc:
            self._send_json({"error": str(exc)}, status=400)

    def do_POST(self) -> None:
        try:
            path, _query = self._path_query()
            payload = self._read_json()
            if path == "/projects":
                self._send_json({"project": self.store.create_project(payload.get("name", "Untitled Project"))})
            elif path == "/imports":
                self._send_json({"dataset": self.store.import_dataset(payload)})
            elif path == "/circuit-templates/validate":
                self._send_json({"validation": self.store.validate_template(payload)})
            elif path == "/preprocess/joint":
                self._send_json({"preprocessing": self.store.preprocess_joint_data(payload)})
            elif path == "/models":
                self._send_json({"model": self.store.create_model(payload)})
            elif path == "/models/import-json":
                self._send_json({"model": self.store.import_model_json(payload)})
            elif path.startswith("/models/") and path.endswith("/load-as-initial"):
                model_id = path.split("/")[2]
                self._send_json({"model": self.store.load_model_as_initial(model_id)})
            elif path == "/runs/joint-fit":
                self._send_json({"run": self.store.run_joint_fit(payload, batch=False)})
            elif path == "/runs/batch-joint-fit":
                self._send_json({"run": self.store.run_joint_fit(payload, batch=True)})
            else:
                self._send_json({"error": f"not found: {path}"}, status=404)
        except Exception as exc:
            self._send_json({"error": str(exc)}, status=400)

    def do_DELETE(self) -> None:
        try:
            path, _query = self._path_query()
            if path.startswith("/projects/"):
                project_id = path.split("/")[2]
                self._send_json(self.store.delete_project(project_id))
            elif path.startswith("/datasets/"):
                dataset_id = path.split("/")[2]
                self._send_json(self.store.delete_dataset(dataset_id))
            elif path.startswith("/models/"):
                model_id = path.split("/")[2]
                self._send_json(self.store.delete_model(model_id))
            else:
                self._send_json({"error": f"not found: {path}"}, status=404)
        except Exception as exc:
            self._send_json({"error": str(exc)}, status=400)

    def log_message(self, format: str, *args: Any) -> None:
        if os.environ.get("IMPEDANCE_STUDIO_VERBOSE"):
            super().log_message(format, *args)

    def _path_query(self) -> tuple[str, dict[str, list[str]]]:
        parsed = urlparse(self.path)
        return parsed.path.rstrip("/") or "/", parse_qs(parsed.query)

    def _read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        if length == 0:
            return {}
        body = self.rfile.read(length).decode("utf-8")
        return json.loads(body)

    def _send_json(self, payload: dict[str, Any], *, status: int = 200) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)


def create_server(host: str = "127.0.0.1", port: int = 8765, db_path: Optional[str] = None) -> HTTPServer:
    store = StudioStore(db_path or os.environ.get("IMPEDANCE_STUDIO_DB") or default_db_path())
    handler = type("BoundStudioHandler", (StudioHandler,), {"store": store})
    return HTTPServer((host, port), handler)


def main() -> None:
    host = os.environ.get("IMPEDANCE_STUDIO_HOST", "127.0.0.1")
    port = int(os.environ.get("IMPEDANCE_STUDIO_PORT", "8765"))
    server = create_server(host, port)
    print(f"Impedance Studio service listening on http://{host}:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


def _one(query: dict[str, list[str]], key: str) -> Optional[str]:
    values = query.get(key)
    return values[0] if values else None


if __name__ == "__main__":
    main()
