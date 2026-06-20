from __future__ import annotations

import math
from importlib import import_module
from typing import Any, Callable, Optional


DEFAULT_MAX_F = 10.0


def preprocess_joint_datasets(
    eis_dataset: dict[str, Any],
    second_dataset: dict[str, Any],
    *,
    max_f: float = DEFAULT_MAX_F,
) -> dict[str, Any]:
    """Apply nleis.py's joint EIS/2nd-NLEIS truncation to one paired dataset.

    ``data_truncation`` first removes EIS points with non-negative imaginary
    impedance (the high-frequency inductive region), then keeps only second-
    harmonic points where ``f < max_f``. The returned rows, rather than the raw
    stored rows, are the data supplied to the workbench plots and fit adapter.
    """
    max_f = _validate_max_frequency(max_f)
    _validate_dataset_kind(eis_dataset, "EIS")
    _validate_dataset_kind(second_dataset, "2nd-NLEIS")

    frequencies, z1, z2 = _paired_complex_rows(eis_dataset["rows"], second_dataset["rows"])
    truncation = _load_data_truncation()
    if truncation is None:
        processed = _compatible_data_truncation(frequencies, z1, z2, max_f=max_f)
        method = "nleis.data_processing.data_truncation-compatible"
    else:
        import numpy as np

        processed = truncation(
            np.asarray(frequencies, dtype=float),
            np.asarray(z1, dtype=np.complex128),
            np.asarray(z2, dtype=np.complex128),
            max_f=max_f,
        )
        method = "nleis.data_processing.data_truncation"

    processed_f, processed_z1, _processed_z2, truncated_f2, truncated_z2 = processed
    eis_rows = _rows_from_complex(processed_f, processed_z1)
    second_rows = _rows_from_complex(truncated_f2, truncated_z2)
    if not eis_rows:
        raise ValueError("Preprocessing removed every EIS point because Z1'' must be negative.")
    if not second_rows:
        raise ValueError(f"max_f={max_f:g} Hz retains no 2nd-NLEIS points; choose a larger maximum frequency.")

    return {
        "max_f": max_f,
        "method": method,
        "inductance_points_removed": len(frequencies) - len(eis_rows),
        "second_points_removed": len(eis_rows) - len(second_rows),
        "eis": _dataset_with_rows(eis_dataset, eis_rows),
        "second": _dataset_with_rows(second_dataset, second_rows),
    }


def _load_data_truncation() -> Optional[Callable[..., tuple[Any, Any, Any, Any, Any]]]:
    """Load the optional nleis.py helper without making the MVP service import it."""
    try:
        return import_module("nleis.data_processing").data_truncation
    except ModuleNotFoundError as exc:
        if exc.name and not exc.name.startswith("nleis"):
            raise
        return None


def _compatible_data_truncation(
    frequencies: list[float], z1: list[complex], z2: list[complex], *, max_f: float
) -> tuple[list[float], list[complex], list[complex], list[float], list[complex]]:
    """Mirror nleis.py's helper for the dependency-free hosted/demo adapter."""
    filtered = [(f, first, second) for f, first, second in zip(frequencies, z1, z2) if first.imag < 0]
    f, first, second = map(list, zip(*filtered)) if filtered else ([], [], [])
    second_truncated = [(frequency, value) for frequency, value in zip(f, second) if frequency < max_f]
    f2, truncated = map(list, zip(*second_truncated)) if second_truncated else ([], [])
    return f, first, second, f2, truncated


def _paired_complex_rows(
    eis_rows: list[dict[str, Any]], second_rows: list[dict[str, Any]]
) -> tuple[list[float], list[complex], list[complex]]:
    if not eis_rows or not second_rows:
        raise ValueError("Both EIS and 2nd-NLEIS datasets must contain data points.")
    second_by_frequency = _rows_by_frequency(second_rows, "2nd-NLEIS")
    frequencies: list[float] = []
    z1: list[complex] = []
    z2: list[complex] = []
    seen: set[float] = set()
    for row in eis_rows:
        frequency = float(row["frequency"])
        if frequency in seen:
            raise ValueError(f"EIS contains duplicate frequency {frequency:g} Hz.")
        seen.add(frequency)
        if frequency not in second_by_frequency:
            continue
        frequencies.append(frequency)
        z1.append(complex(float(row["z_real"]), float(row["z_imag"])))
        second = second_by_frequency[frequency]
        z2.append(complex(float(second["z_real"]), float(second["z_imag"])))
    if not frequencies:
        raise ValueError("EIS and 2nd-NLEIS must share at least one frequency for joint preprocessing.")
    return frequencies, z1, z2


def _rows_by_frequency(rows: list[dict[str, Any]], label: str) -> dict[float, dict[str, Any]]:
    by_frequency: dict[float, dict[str, Any]] = {}
    for row in rows:
        frequency = float(row["frequency"])
        if frequency in by_frequency:
            raise ValueError(f"{label} contains duplicate frequency {frequency:g} Hz.")
        by_frequency[frequency] = row
    return by_frequency


def _rows_from_complex(frequencies: Any, impedance: Any) -> list[dict[str, float]]:
    rows: list[dict[str, float]] = []
    for frequency, value in zip(frequencies, impedance):
        real = float(value.real)
        imag = float(value.imag)
        rows.append(
            {
                "frequency": float(frequency),
                "z_real": real,
                "z_imag": imag,
                "z_abs": math.hypot(real, imag),
                "phase": math.degrees(math.atan2(imag, real)),
            }
        )
    return rows


def _dataset_with_rows(dataset: dict[str, Any], rows: list[dict[str, float]]) -> dict[str, Any]:
    return {
        **dataset,
        "point_count": len(rows),
        "freq_min": min(row["frequency"] for row in rows),
        "freq_max": max(row["frequency"] for row in rows),
        "rows": rows,
    }


def _validate_max_frequency(max_f: float) -> float:
    value = float(max_f)
    if not math.isfinite(value) or value <= 0:
        raise ValueError("max_f must be a finite positive frequency in Hz.")
    return value


def _validate_dataset_kind(dataset: dict[str, Any], expected: str) -> None:
    if dataset.get("kind") != expected:
        raise ValueError(f"Expected a {expected} dataset, received {dataset.get('kind')!r}.")
