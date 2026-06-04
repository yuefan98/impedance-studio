# Local Analysis Service

The local service backs Impedance Studio's no-cloud mode. It uses only the Python standard library for the first MVP: HTTP, JSON, SQLite, and deterministic local fitting simulation behind an adapter boundary.

Start it from the repository root:

```bash
PYTHONPATH=service python3 -m impedance_studio.server
```

The service listens on `http://127.0.0.1:8765` by default and stores local state at:

```text
~/.impedance-studio/impedance_studio.sqlite3
```

Override the database path when testing or isolating sensitive projects:

```bash
IMPEDANCE_STUDIO_DB=/path/to/private.sqlite3 PYTHONPATH=service python3 -m impedance_studio.server
```

## Current Endpoints

- `GET /health`
- `GET/POST /projects`
- `POST /imports`
- `GET /datasets`
- `POST /circuit-templates/validate`
- `GET/POST /models`
- `POST /models/import-json`
- `GET /models/{id}/export-json`
- `POST /models/{id}/load-as-initial`
- `POST /runs/joint-fit`
- `POST /runs/batch-joint-fit`
- `GET /runs`

## Adapter Boundary

The MVP stores and validates impedance.py/nleis.py-compatible circuit strings and model JSON. The current local fit path returns deterministic simulated fit output so the workbench can be developed without changing a user's Python environment.

The intended production adapter is:

- EIS only: `impedance.models.circuits.CustomCircuit`
- Joint EIS + 2nd-NLEIS: `nleis.EISandNLEIS`
- Model I/O: library-native `save`, `load`, and `fitted_as_initial`

Keep this boundary server-side. Do not put fitting logic in React components.
