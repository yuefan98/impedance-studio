from __future__ import annotations

import math
import warnings
from typing import Any

from .preprocessing import DEFAULT_MAX_F, preprocess_joint_datasets


def fit_joint_datasets(
    eis_dataset: dict[str, Any],
    second_dataset: dict[str, Any],
    model: dict[str, Any],
    *,
    max_f: float = DEFAULT_MAX_F,
) -> dict[str, Any]:
    """Fit a paired spectrum with nleis.py and return JSON-ready plot series.

    The nleis fitter receives the inductance-filtered common frequency grid from
    :func:`data_truncation`. Its ``max_f`` argument then applies the same
    second-harmonic cutoff used by the workbench preview.
    """
    circuit_1 = _required_text(model, "circuit_1")
    circuit_2 = _required_text(model, "circuit_2")
    initial_guess = _float_list(model.get("initial_guess"), "initial_guess")
    if not initial_guess:
        raise ValueError("A real fit requires at least one initial guess.")
    constants = {key: float(value) for key, value in (model.get("constants") or {}).items()}
    EISandNLEIS, np = _load_nleis()
    preprocessing = preprocess_joint_datasets(eis_dataset, second_dataset, max_f=max_f)

    frequencies = np.asarray([row["frequency"] for row in preprocessing["eis"]["rows"]], dtype=float)
    z1 = _complex_array(preprocessing["eis"]["rows"], np)
    z2 = _complex_array(_matching_rows(second_dataset["rows"], frequencies), np)
    bounds = _parse_bounds(model.get("bounds"), np)

    circuit = EISandNLEIS(
        circuit_1,
        circuit_2,
        initial_guess=initial_guess,
        constants=constants or None,
    )
    with warnings.catch_warnings():
        # nleis caps infinite user bounds at 1e10 while normalizing parameters.
        # The conversion is expected and should not be reported as a production error.
        warnings.filterwarnings("ignore", message="inf is detected in the bounds", category=UserWarning)
        circuit.fit(
            frequencies,
            z1,
            z2,
            bounds=bounds,
            opt="max",
            max_f=float(preprocessing["max_f"]),
        )
    fitted_z1, fitted_z2 = circuit.predict(frequencies, max_f=float(preprocessing["max_f"]))
    parameters = _finite_float_list(circuit.parameters_)
    confidence = _finite_float_list(getattr(circuit, "conf_", None), length=len(parameters))
    second_rows = preprocessing["second"]["rows"]
    fitted_eis_rows = _rows_from_complex(frequencies, fitted_z1)
    fitted_second_rows = _rows_from_complex([row["frequency"] for row in second_rows], fitted_z2)
    chi_square = _mean_squared_residual(
        z1,
        fitted_z1,
        _complex_array(second_rows, np),
        fitted_z2,
        np,
    )
    validation = {
        "method": "nleis.EISandNLEIS",
        "chi_square": chi_square,
        "status": "pass",
        "message": "Converged with nleis.EISandNLEIS using the configured 2nd-NLEIS max_f.",
    }
    result = {
        "fit_mode": "joint",
        "adapter": "nleis.EISandNLEIS",
        "circuit_1": circuit_1,
        "circuit_2": circuit_2,
        "parameters": parameters,
        "confidence": confidence,
        "validation": validation,
    }
    return {
        "preprocessing": preprocessing,
        "eis": {"dataset": preprocessing["eis"], "result": result | {"plot_series": {"data": preprocessing["eis"]["rows"], "fit": fitted_eis_rows}}},
        "second": {"dataset": preprocessing["second"], "result": result | {"plot_series": {"data": second_rows, "fit": fitted_second_rows}}},
    }


def _load_nleis() -> tuple[Any, Any]:
    try:
        import numpy as np
        from nleis import EISandNLEIS
    except ModuleNotFoundError as exc:
        raise RuntimeError(
            "Real fitting requires nleis==0.3 and its scientific dependencies. "
            "Install the project requirements or deploy the Vercel Python function."
        ) from exc
    return EISandNLEIS, np


def _required_text(model: dict[str, Any], field: str) -> str:
    value = str(model.get(field) or "").strip()
    if not value:
        raise ValueError(f"{field} is required for a joint fit.")
    return value


def _float_list(values: Any, label: str) -> list[float]:
    if not isinstance(values, list):
        raise ValueError(f"{label} must be an array of finite numbers.")
    result = [float(value) for value in values]
    if not all(math.isfinite(value) for value in result):
        raise ValueError(f"{label} must contain finite numbers.")
    return result


def _matching_rows(rows: list[dict[str, Any]], frequencies: Any) -> list[dict[str, Any]]:
    by_frequency = {float(row["frequency"]): row for row in rows}
    try:
        return [by_frequency[float(frequency)] for frequency in frequencies]
    except KeyError as exc:
        raise ValueError("2nd-NLEIS data does not cover the preprocessed EIS frequency grid.") from exc


def _complex_array(rows: list[dict[str, Any]], np: Any) -> Any:
    return np.asarray([complex(float(row["z_real"]), float(row["z_imag"])) for row in rows], dtype=np.complex128)


def _parse_bounds(value: Any, np: Any) -> Any:
    if not value:
        return None
    if not isinstance(value, dict):
        raise ValueError("bounds must provide lower and upper arrays.")
    lower = _bound_list(value.get("lower"), np)
    upper = _bound_list(value.get("upper"), np)
    if len(lower) != len(upper):
        raise ValueError("bounds lower and upper arrays must be the same length.")
    return lower, upper


def _bound_list(values: Any, np: Any) -> Any:
    if not isinstance(values, list):
        raise ValueError("bounds values must be arrays.")
    parsed = []
    for value in values:
        if isinstance(value, str) and value.lower() == "inf":
            parsed.append(np.inf)
        elif isinstance(value, str) and value.lower() == "-inf":
            parsed.append(-np.inf)
        else:
            parsed.append(float(value))
    return parsed


def _rows_from_complex(frequencies: Any, impedance: Any) -> list[dict[str, float]]:
    rows = []
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


def _finite_float_list(values: Any, *, length: int | None = None) -> list[float]:
    if values is None:
        return [0.0] * (length or 0)
    result = []
    for value in values:
        parsed = float(value)
        result.append(parsed if math.isfinite(parsed) else 0.0)
    return result


def _mean_squared_residual(z1: Any, fit1: Any, z2: Any, fit2: Any, np: Any) -> float:
    residual = np.concatenate((z1 - fit1, z2 - fit2))
    return float(np.mean(np.abs(residual) ** 2))
