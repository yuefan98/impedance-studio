from __future__ import annotations

import json
import os
import sys
import traceback
from typing import Any


os.environ.setdefault("MPLCONFIGDIR", "/tmp/impedance-studio-matplotlib")


def main() -> None:
    try:
        payload = _read_payload()
        from .fitting import fit_eis_dataset, fit_joint_datasets

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
        _write({"analysis": analysis})
    except Exception as exc:
        _write({"error": str(exc), "traceback": traceback.format_exc()})
        raise SystemExit(1) from exc


def _read_payload() -> dict[str, Any]:
    payload = json.loads(sys.stdin.read())
    if not isinstance(payload, dict):
        raise ValueError("A JSON object fit request is required.")
    return payload


def _write(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, allow_nan=False))


if __name__ == "__main__":
    main()
