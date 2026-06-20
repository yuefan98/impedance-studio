from __future__ import annotations

import json
import math
import sqlite3
import time
import uuid
from pathlib import Path
from typing import Any, Optional, Union

from .circuits import validate_circuit_pair
from .importers import generate_synthetic_dataset, parse_autolab_import, parse_table_import
from .preprocessing import DEFAULT_MAX_F, preprocess_joint_datasets
from .sample_data import load_manuscript_samples, manuscript_sample


def default_db_path() -> Path:
    return Path.home() / ".impedance-studio" / "impedance_studio.sqlite3"


class StudioStore:
    def __init__(self, db_path: Optional[Union[Path, str]] = None):
        self.db_path = Path(db_path) if db_path else default_db_path()
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(self.db_path)
        self.connection.row_factory = sqlite3.Row
        self._migrate()
        self._seed_if_empty()

    def close(self) -> None:
        self.connection.close()

    def health(self) -> dict[str, Any]:
        optional = {}
        for module in ("impedance", "nleis"):
            try:
                __import__(module)
                optional[module] = True
            except Exception:
                optional[module] = False
        return {
            "ok": True,
            "mode": "local",
            "database": str(self.db_path),
            "optional_libraries": optional,
        }

    def list_projects(self) -> list[dict[str, Any]]:
        return [dict(row) for row in self.connection.execute("select * from projects order by name")]

    def create_project(self, name: str) -> dict[str, Any]:
        project_id = _id()
        now = _now()
        self.connection.execute(
            "insert into projects (id, name, created_at) values (?, ?, ?)",
            (project_id, name, now),
        )
        self.connection.commit()
        return {"id": project_id, "name": name, "created_at": now}

    def delete_project(self, project_id: str) -> dict[str, Any]:
        row = self.connection.execute("select id from projects where id = ?", (project_id,)).fetchone()
        if not row:
            raise KeyError(f"project not found: {project_id}")
        run_ids = [
            item["id"]
            for item in self.connection.execute("select id from runs where project_id = ?", (project_id,))
        ]
        if run_ids:
            placeholders = ",".join("?" for _ in run_ids)
            self.connection.execute(f"delete from run_items where run_id in ({placeholders})", tuple(run_ids))
            self.connection.execute(f"delete from runs where id in ({placeholders})", tuple(run_ids))
        self.connection.execute("delete from datasets where project_id = ?", (project_id,))
        self.connection.execute("delete from models where project_id = ?", (project_id,))
        self.connection.execute("delete from projects where id = ?", (project_id,))
        self.connection.commit()
        if not self.connection.execute("select count(*) from projects").fetchone()[0]:
            next_project = self.create_project("Untitled Project")
        else:
            next_project = self.list_projects()[0]
        return {"ok": True, "deleted_id": project_id, "next_project": next_project}

    def list_datasets(self, project_id: Optional[str] = None) -> list[dict[str, Any]]:
        query = "select * from datasets"
        params: tuple[Any, ...] = ()
        if project_id:
            query += " where project_id = ?"
            params = (project_id,)
        query += " order by created_at desc"
        return [_decode_dataset(row) for row in self.connection.execute(query, params)]

    def import_dataset(self, payload: dict[str, Any]) -> dict[str, Any]:
        project_id = payload.get("project_id") or self._default_project_id()
        mode = payload.get("mode", "table")
        name = payload.get("name") or "Imported dataset"
        kind = payload.get("kind") or "EIS"
        source_name = payload.get("source_name") or f"{name}.csv"
        text = payload.get("text", "")
        if mode == "autolab":
            parsed = parse_autolab_import(text, name=name, kind=kind, source_name=source_name)
        elif mode == "manuscript":
            sample_index = int(payload.get("sample_index") or self._dataset_count(project_id, kind))
            parsed = manuscript_sample(kind, sample_index)
            if payload.get("name"):
                parsed = parsed | {"name": name}
        elif mode == "synthetic":
            parsed = generate_synthetic_dataset(kind, name)
        else:
            parsed = parse_table_import(
                text,
                name=name,
                kind=kind,
                source_name=source_name,
                delimiter=payload.get("delimiter"),
            )
        return self._insert_dataset(project_id, parsed)

    def delete_dataset(self, dataset_id: str) -> dict[str, Any]:
        row = self.connection.execute("select id from datasets where id = ?", (dataset_id,)).fetchone()
        if not row:
            raise KeyError(f"dataset not found: {dataset_id}")
        self.connection.execute("delete from run_items where dataset_id = ?", (dataset_id,))
        self.connection.execute("delete from datasets where id = ?", (dataset_id,))
        self.connection.commit()
        return {"ok": True, "deleted_id": dataset_id}

    def validate_template(self, payload: dict[str, Any]) -> dict[str, Any]:
        return validate_circuit_pair(
            payload.get("circuit_1", ""),
            payload.get("circuit_2", ""),
            [float(value) for value in payload.get("initial_guess", [])],
            {key: float(value) for key, value in payload.get("constants", {}).items()},
        )

    def preprocess_joint_data(self, payload: dict[str, Any]) -> dict[str, Any]:
        project_id = payload.get("project_id") or self._default_project_id()
        eis_dataset, second_dataset = self._joint_datasets(payload, project_id)
        return preprocess_joint_datasets(
            eis_dataset,
            second_dataset,
            max_f=payload.get("max_f", DEFAULT_MAX_F),
        )

    def list_models(self, project_id: Optional[str] = None) -> list[dict[str, Any]]:
        rows = self.connection.execute(
            """
            select * from models
            where (? is null or project_id = ? or pinned = 1)
            order by pinned desc, updated_at desc
            """,
            (project_id, project_id),
        )
        return [_decode_model(row) for row in rows]

    def create_model(self, payload: dict[str, Any]) -> dict[str, Any]:
        project_id = payload.get("project_id") or self._default_project_id()
        model = {
            "id": _id(),
            "project_id": project_id,
            "name": payload.get("name") or "Untitled model",
            "kind": payload.get("kind") or "template",
            "scope": payload.get("scope") or "project",
            "circuit_1": payload.get("circuit_1") or "",
            "circuit_2": payload.get("circuit_2") or "",
            "initial_guess": payload.get("initial_guess") or [],
            "bounds": payload.get("bounds") or {},
            "constants": payload.get("constants") or {},
            "shared_parameters": payload.get("shared_parameters") or [],
            "fitted_parameters": payload.get("fitted_parameters") or None,
            "validation_summary": payload.get("validation_summary") or None,
            "plot_series": payload.get("plot_series") or None,
            "source_run_id": payload.get("source_run_id"),
            "pinned": 1 if payload.get("pinned") else 0,
            "created_at": _now(),
            "updated_at": _now(),
        }
        self.connection.execute(
            """
            insert into models (
              id, project_id, name, kind, scope, circuit_1, circuit_2,
              initial_guess_json, bounds_json, constants_json, shared_json,
              fitted_json, validation_json, plot_json, source_run_id, pinned,
              created_at, updated_at
            ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                model["id"],
                model["project_id"],
                model["name"],
                model["kind"],
                model["scope"],
                model["circuit_1"],
                model["circuit_2"],
                _json(model["initial_guess"]),
                _json(model["bounds"]),
                _json(model["constants"]),
                _json(model["shared_parameters"]),
                _json(model["fitted_parameters"]),
                _json(model["validation_summary"]),
                _json(model["plot_series"]),
                model["source_run_id"],
                model["pinned"],
                model["created_at"],
                model["updated_at"],
            ),
        )
        self.connection.commit()
        return model

    def delete_model(self, model_id: str) -> dict[str, Any]:
        row = self.connection.execute("select id from models where id = ?", (model_id,)).fetchone()
        if not row:
            raise KeyError(f"model not found: {model_id}")
        self.connection.execute("delete from models where id = ?", (model_id,))
        self.connection.commit()
        return {"ok": True, "deleted_id": model_id}

    def import_model_json(self, payload: dict[str, Any]) -> dict[str, Any]:
        raw = payload.get("model_json")
        if isinstance(raw, str):
            raw = json.loads(raw)
        if not isinstance(raw, dict):
            raise ValueError("model_json must be an object or JSON string")
        return self.create_model(
            {
                "project_id": payload.get("project_id"),
                "name": raw.get("Name") or raw.get("name") or "Imported model",
                "kind": "snapshot" if raw.get("Fit") else "template",
                "circuit_1": raw.get("Circuit String 1") or raw.get("circuit_1") or raw.get("Circuit string") or "",
                "circuit_2": raw.get("Circuit String 2") or raw.get("circuit_2") or "",
                "initial_guess": raw.get("Initial Guess") or raw.get("initial_guess") or [],
                "constants": raw.get("Constants") or raw.get("constants") or {},
                "fitted_parameters": raw.get("Parameters") or raw.get("parameters"),
                "validation_summary": {"imported": True, "source": "library-json"},
            }
        )

    def export_model_json(self, model_id: str) -> dict[str, Any]:
        model = self._get_model(model_id)
        return {
            "Name": model["name"],
            "Circuit String 1": model["circuit_1"],
            "Circuit String 2": model["circuit_2"],
            "Initial Guess": model["initial_guess"],
            "Constants": model["constants"],
            "Bounds": model["bounds"],
            "Shared Parameters": model["shared_parameters"],
            "Fit": model["kind"] == "snapshot",
            "Parameters": model["fitted_parameters"],
            "Validation": model["validation_summary"],
            "Source Run ID": model["source_run_id"],
        }

    def load_model_as_initial(self, model_id: str) -> dict[str, Any]:
        model = self._get_model(model_id)
        next_model = dict(model)
        next_model["name"] = f"{model['name']} as initial"
        next_model["kind"] = "template"
        if model.get("fitted_parameters"):
            next_model["initial_guess"] = model["fitted_parameters"]
            next_model["fitted_parameters"] = None
            next_model["validation_summary"] = {
                "loaded_from": model["id"],
                "fitted_as_initial": True,
            }
        return self.create_model(next_model)

    def run_joint_fit(self, payload: dict[str, Any], *, batch: bool = False) -> dict[str, Any]:
        project_id = payload.get("project_id") or self._default_project_id()
        model_id = payload.get("model_id") or self._default_model_id(project_id)
        model = self._get_model(model_id)
        eis_dataset, second_dataset = self._joint_datasets(payload, project_id)
        preprocessing = preprocess_joint_datasets(
            eis_dataset,
            second_dataset,
            max_f=payload.get("max_f", DEFAULT_MAX_F),
        )
        fitted_datasets = [preprocessing["eis"], preprocessing["second"]]
        fit_scale = _impedance_scale([row for dataset in fitted_datasets for row in dataset["rows"]])
        run_id = _id()
        started = _now()
        self.connection.execute(
            """
            insert into runs (id, project_id, model_id, mode, status, progress, started_at, completed_at, summary_json)
            values (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                run_id,
                project_id,
                model_id,
                "batch-joint-fit" if batch else "joint-fit",
                "completed",
                100,
                started,
                _now(),
                _json(
                    {
                        "dataset_count": len(fitted_datasets),
                        "fit_mode": "joint",
                        "run_name": payload.get("run_name") or "Joint fit",
                        "max_f": preprocessing["max_f"],
                        "preprocessing_method": preprocessing["method"],
                    }
                ),
            ),
        )
        items = []
        snapshots = []
        for dataset in fitted_datasets:
            result = _fit_result(
                dataset,
                model,
                scale=fit_scale,
                preprocessing_method=preprocessing["method"],
            )
            item_id = _id()
            self.connection.execute(
                """
                insert into run_items (id, run_id, dataset_id, status, progress, message, result_json)
                values (?, ?, ?, ?, ?, ?, ?)
                """,
                (item_id, run_id, dataset["id"], "completed", 100, "Joint fit completed", _json(result)),
            )
            items.append(
                {
                    "id": item_id,
                    "run_id": run_id,
                    "dataset_id": dataset["id"],
                    "status": "completed",
                    "progress": 100,
                    "message": "Joint fit completed",
                    "result": result,
                }
            )
            snapshots.append(
                self.create_model(
                    {
                        "project_id": project_id,
                        "name": f"{model['name']} fitted to {dataset['name']}",
                        "kind": "snapshot",
                        "circuit_1": model["circuit_1"],
                        "circuit_2": model["circuit_2"],
                        "initial_guess": model["initial_guess"],
                        "bounds": model["bounds"],
                        "constants": model["constants"],
                        "shared_parameters": model["shared_parameters"],
                        "fitted_parameters": result["parameters"],
                        "validation_summary": result["validation"],
                        "plot_series": result["plot_series"],
                        "source_run_id": run_id,
                    }
                )
            )
        self.connection.commit()
        return self._decode_run(run_id) | {"items": items, "snapshots": snapshots}

    def list_runs(self, project_id: Optional[str] = None) -> list[dict[str, Any]]:
        query = "select * from runs"
        params: tuple[Any, ...] = ()
        if project_id:
            query += " where project_id = ?"
            params = (project_id,)
        query += " order by started_at desc"
        return [self._decode_run(row["id"]) for row in self.connection.execute(query, params)]

    def _migrate(self) -> None:
        self.connection.executescript(
            """
            create table if not exists projects (
              id text primary key,
              name text not null,
              created_at text not null
            );
            create table if not exists datasets (
              id text primary key,
              project_id text not null,
              name text not null,
              kind text not null,
              source_name text not null,
              point_count integer not null,
              freq_min real not null,
              freq_max real not null,
              temperature_c real,
              data_json text not null,
              created_at text not null,
              foreign key (project_id) references projects(id)
            );
            create table if not exists models (
              id text primary key,
              project_id text,
              name text not null,
              kind text not null,
              scope text not null,
              circuit_1 text not null,
              circuit_2 text not null,
              initial_guess_json text not null,
              bounds_json text not null,
              constants_json text not null,
              shared_json text not null,
              fitted_json text,
              validation_json text,
              plot_json text,
              source_run_id text,
              pinned integer not null default 0,
              created_at text not null,
              updated_at text not null
            );
            create table if not exists runs (
              id text primary key,
              project_id text not null,
              model_id text not null,
              mode text not null,
              status text not null,
              progress integer not null,
              started_at text not null,
              completed_at text,
              summary_json text not null
            );
            create table if not exists run_items (
              id text primary key,
              run_id text not null,
              dataset_id text not null,
              status text not null,
              progress integer not null,
              message text,
              result_json text not null,
              foreign key (run_id) references runs(id),
              foreign key (dataset_id) references datasets(id)
            );
            """
        )
        self.connection.commit()

    def _seed_if_empty(self) -> None:
        count = self.connection.execute("select count(*) from projects").fetchone()[0]
        if count:
            return
        project = self.create_project("2nd-NLEIS Manuscript Part II")
        for dataset in load_manuscript_samples():
            self._insert_dataset(project["id"], dataset)
        self.create_model(
            {
                "project_id": project["id"],
                "name": "Joint RC0 / RCn0 template",
                "scope": "project",
                "pinned": True,
                "circuit_1": "RC0",
                "circuit_2": "RCn0",
                "initial_guess": [0.84, 15.2, 0.001],
                "bounds": {"lower": [0, 0, -0.5], "upper": ["inf", "inf", 0.5]},
                "constants": {},
                "shared_parameters": ["RC0_0 -> RCn0_0", "RC0_1 -> RCn0_1"],
            }
        )

    def _insert_dataset(self, project_id: str, parsed: dict[str, Any]) -> dict[str, Any]:
        dataset_id = _id()
        created = _now()
        self.connection.execute(
            """
            insert into datasets (
              id, project_id, name, kind, source_name, point_count, freq_min,
              freq_max, temperature_c, data_json, created_at
            ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                dataset_id,
                project_id,
                parsed["name"],
                parsed["kind"],
                parsed["source_name"],
                parsed["point_count"],
                parsed["freq_min"],
                parsed["freq_max"],
                parsed.get("temperature_c"),
                _json(parsed["rows"]),
                created,
            ),
        )
        self.connection.commit()
        return self._get_dataset(dataset_id)

    def _default_project_id(self) -> str:
        row = self.connection.execute("select id from projects order by created_at limit 1").fetchone()
        if not row:
            return self.create_project("Default Project")["id"]
        return row["id"]

    def _default_model_id(self, project_id: str) -> str:
        row = self.connection.execute(
            "select id from models where project_id = ? order by pinned desc, updated_at desc limit 1",
            (project_id,),
        ).fetchone()
        if not row:
            return self.create_model({"project_id": project_id, "name": "Default RC pair", "circuit_1": "RC0", "circuit_2": "RCn0"})["id"]
        return row["id"]

    def _default_dataset_id(self, project_id: str) -> str:
        row = self.connection.execute(
            "select id from datasets where project_id = ? order by created_at desc limit 1",
            (project_id,),
        ).fetchone()
        if not row:
            return self._insert_dataset(project_id, generate_synthetic_dataset("EIS", "Synthetic EIS"))["id"]
        return row["id"]

    def _dataset_count(self, project_id: str, kind: str) -> int:
        return int(
            self.connection.execute(
                "select count(*) from datasets where project_id = ? and kind = ?",
                (project_id, kind),
            ).fetchone()[0]
        )

    def _joint_datasets(self, payload: dict[str, Any], project_id: str) -> tuple[dict[str, Any], dict[str, Any]]:
        requested_ids = payload.get("dataset_ids") or []
        requested = [self._get_dataset(dataset_id) for dataset_id in requested_ids]
        datasets = self.list_datasets(project_id)

        eis_id = payload.get("eis_dataset_id")
        second_id = payload.get("second_dataset_id")
        eis_dataset = self._get_dataset(eis_id) if eis_id else next(
            (dataset for dataset in requested if dataset["kind"] == "EIS"),
            next((dataset for dataset in datasets if dataset["kind"] == "EIS"), None),
        )
        second_dataset = self._get_dataset(second_id) if second_id else next(
            (dataset for dataset in requested if dataset["kind"] == "2nd-NLEIS"),
            next((dataset for dataset in datasets if dataset["kind"] == "2nd-NLEIS"), None),
        )
        if not eis_dataset or not second_dataset:
            raise ValueError("Joint preprocessing requires one EIS and one 2nd-NLEIS dataset.")
        if eis_dataset["project_id"] != project_id or second_dataset["project_id"] != project_id:
            raise ValueError("Selected datasets must belong to the active project.")
        return eis_dataset, second_dataset

    def _get_dataset(self, dataset_id: str) -> dict[str, Any]:
        row = self.connection.execute("select * from datasets where id = ?", (dataset_id,)).fetchone()
        if not row:
            raise KeyError(f"dataset not found: {dataset_id}")
        return _decode_dataset(row)

    def _get_model(self, model_id: str) -> dict[str, Any]:
        row = self.connection.execute("select * from models where id = ?", (model_id,)).fetchone()
        if not row:
            raise KeyError(f"model not found: {model_id}")
        return _decode_model(row)

    def _decode_run(self, run_id: str) -> dict[str, Any]:
        row = self.connection.execute("select * from runs where id = ?", (run_id,)).fetchone()
        if not row:
            raise KeyError(f"run not found: {run_id}")
        items = [
            {
                **dict(item),
                "result": _loads(item["result_json"]),
            }
            for item in self.connection.execute("select * from run_items where run_id = ?", (run_id,))
        ]
        data = dict(row)
        data["summary"] = _loads(data.pop("summary_json"))
        data["items"] = items
        return data


def _decode_dataset(row: sqlite3.Row) -> dict[str, Any]:
    data = dict(row)
    data["rows"] = _loads(data.pop("data_json"))
    return data


def _decode_model(row: sqlite3.Row) -> dict[str, Any]:
    data = dict(row)
    data["initial_guess"] = _loads(data.pop("initial_guess_json"))
    data["bounds"] = _loads(data.pop("bounds_json"))
    data["constants"] = _loads(data.pop("constants_json"))
    data["shared_parameters"] = _loads(data.pop("shared_json"))
    data["fitted_parameters"] = _loads(data.pop("fitted_json"))
    data["validation_summary"] = _loads(data.pop("validation_json"))
    data["plot_series"] = _loads(data.pop("plot_json"))
    data["pinned"] = bool(data["pinned"])
    if data["circuit_1"] == "RC0" and data["circuit_2"] == "RCn0":
        data["initial_guess"] = data["initial_guess"][:3]
        data["shared_parameters"] = ["RC0_0 -> RCn0_0", "RC0_1 -> RCn0_1"]
        data["bounds"] = {"lower": [0, 0, -0.5], "upper": ["inf", "inf", 0.5]}
    return data


def _fit_result(
    dataset: dict[str, Any],
    model: dict[str, Any],
    *,
    scale: Optional[float] = None,
    preprocessing_method: str = "",
) -> dict[str, Any]:
    rows = dataset["rows"]
    scale = scale if scale is not None else _impedance_scale(rows)
    base = model.get("initial_guess") or [scale, scale / 2]
    parameters = [round(float(value) * (0.98 + 0.01 * idx), 8) for idx, value in enumerate(base)]
    fitted_rows = []
    for idx, row in enumerate(rows):
        drift = 1 + 0.015 * math.sin(idx / max(len(rows) - 1, 1) * math.pi)
        fitted_rows.append(
            {
                "frequency": row["frequency"],
                "z_real": row["z_real"] * drift,
                "z_imag": row["z_imag"] * (2 - drift),
                "z_abs": row["z_abs"],
                "phase": row["phase"],
            }
        )
    return {
        "fit_mode": "joint",
        "adapter": f"simulated-local-worker; {preprocessing_method}".rstrip("; "),
        "circuit_1": model["circuit_1"],
        "circuit_2": model["circuit_2"],
        "parameters": parameters,
        "confidence": [round(max(abs(value) * 0.025, 1e-8), 8) for value in parameters],
        "validation": {
            "method": "MM",
            "chi_square": round(0.0008 + scale * 1e-5, 8),
            "status": "pass",
            "message": "Fitted from nleis.py-preprocessed rows in the local worker simulation.",
        },
        "plot_series": {"data": rows, "fit": fitted_rows},
    }


def _impedance_scale(rows: list[dict[str, Any]]) -> float:
    return max(sum(abs(row["z_real"]) + abs(row["z_imag"]) for row in rows) / len(rows), 1e-9)


def _id() -> str:
    return uuid.uuid4().hex


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _json(value: Any) -> str:
    return json.dumps(value)


def _loads(value: Optional[str]) -> Any:
    if value in (None, ""):
        return None
    return json.loads(value)
