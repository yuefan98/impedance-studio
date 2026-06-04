from __future__ import annotations

import re
from typing import Any, Optional


ALLOWED_PREFIXES = (
    "CPE",
    "TDSn",
    "TDPn",
    "TLMQ",
    "TDS",
    "TDP",
    "Wo",
    "Ws",
    "La",
    "RCn",
    "RC",
    "R",
    "C",
    "L",
    "W",
    "T",
    "G",
    "K",
)


def extract_elements(circuit: str) -> list[str]:
    circuit = circuit.replace(" ", "")
    if not circuit:
        return []
    tokens = re.findall(r"[A-Za-z]+_?\d*", circuit)
    return [token for token in tokens if token not in {"p", "d", "s"}]


def validate_circuit_pair(
    circuit_1: str,
    circuit_2: str,
    initial_guess: list[float],
    constants: Optional[dict[str, float]] = None,
) -> dict[str, Any]:
    constants = constants or {}
    elements_1 = extract_elements(circuit_1)
    elements_2 = extract_elements(circuit_2)
    errors: list[str] = []
    warnings: list[str] = []

    if not elements_1:
        errors.append("EIS circuit_1 is required.")
    if not elements_2:
        errors.append("2nd-NLEIS circuit_2 is required for joint fitting.")
    if circuit_2 and "d(" not in circuit_2.replace(" ", ""):
        warnings.append("2nd-NLEIS circuits usually use d(cathode, anode) difference grouping.")

    unknown = [element for element in elements_1 + elements_2 if _prefix(element) is None]
    if unknown:
        errors.append(f"Unknown element prefix: {', '.join(sorted(set(unknown)))}.")

    paired_warnings = _pairing_warnings(elements_1, elements_2)
    warnings.extend(paired_warnings)

    estimated_parameters = _estimate_parameter_count(elements_1, elements_2, constants)
    if initial_guess and len(initial_guess) != estimated_parameters:
        warnings.append(
            "Initial guess count does not match the estimated non-constant parameter count. "
            "The Python adapter will perform authoritative validation at run time."
        )

    return {
        "valid": not errors,
        "errors": errors,
        "warnings": warnings,
        "elements_1": elements_1,
        "elements_2": elements_2,
        "estimated_parameters": estimated_parameters,
        "parameter_names": _parameter_names(elements_1, elements_2, constants),
    }


def _prefix(element: str) -> Optional[str]:
    clean = element.replace("_", "")
    for prefix in ALLOWED_PREFIXES:
        if clean.startswith(prefix):
            return prefix
    return None


def _pairing_warnings(elements_1: list[str], elements_2: list[str]) -> list[str]:
    base_1 = {element.replace("_", "") for element in elements_1}
    warnings: list[str] = []
    for element in elements_2:
        raw = element.replace("_", "")
        if "n" in raw:
            candidate = raw.replace("n", "", 1)
            if candidate not in base_1:
                warnings.append(f"{element} has no obvious paired EIS element in circuit_1.")
    return warnings


def _estimate_parameter_count(
    elements_1: list[str],
    elements_2: list[str],
    constants: dict[str, float],
) -> int:
    names = _parameter_names(elements_1, elements_2, constants)
    return len(names)


def _parameter_names(
    elements_1: list[str],
    elements_2: list[str],
    constants: dict[str, float],
) -> list[str]:
    names: list[str] = []
    seen: set[str] = set()
    for element in elements_1 + elements_2:
        count = _parameter_count(element)
        for idx in range(count):
            name = element if count == 1 else f"{element}_{idx}"
            if name in constants or name in seen:
                continue
            seen.add(name)
            names.append(name)
    return names


def _parameter_count(element: str) -> int:
    prefix = _prefix(element)
    if prefix in {"CPE", "Wo", "Ws", "La", "RC", "RCn"}:
        return 2
    if prefix in {"TDS", "TDP"}:
        return 5
    if prefix in {"TDSn", "TDPn"}:
        return 7
    if prefix == "TLMQ":
        return 4
    return 1
