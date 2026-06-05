from __future__ import annotations

import csv
import io
import math
from typing import Any, Optional


def generate_synthetic_dataset(kind: str, name: str, points: int = 64) -> dict[str, Any]:
    """Create deterministic EIS or 2nd-NLEIS-like sample data for local demos."""
    rows: list[dict[str, float]] = []
    for idx in range(points):
        ratio = idx / max(points - 1, 1)
        frequency = 10 ** (6 - 7 * ratio)
        phase = -8 - 62 * ratio + 8 * math.sin(ratio * math.pi * 2)
        if kind == "2nd-NLEIS":
            z_real = 0.02 + 0.18 * ratio + 0.018 * math.sin(ratio * math.pi * 3)
            z_imag = -0.015 - 0.14 * ratio + 0.01 * math.cos(ratio * math.pi * 2)
        else:
            arc = math.sin(ratio * math.pi)
            tail = max(ratio - 0.62, 0) * 18
            z_real = 0.82 + 15.5 * ratio + tail
            z_imag = -0.2 - 7.2 * arc - 13.5 * (ratio**2)
        rows.append(
            {
                "frequency": frequency,
                "z_real": z_real,
                "z_imag": z_imag,
                "z_abs": math.hypot(z_real, z_imag),
                "phase": phase,
            }
        )
    return summarize_dataset(kind, name, rows, source_name=f"{name}.csv")


def parse_table_import(
    text: str,
    *,
    name: str,
    kind: str,
    source_name: str,
    delimiter: Optional[str] = None,
) -> dict[str, Any]:
    """Parse CSV/TSV data with frequency and complex impedance columns."""
    cleaned = text.strip()
    if not cleaned:
        raise ValueError("import text is empty")

    sample = cleaned[:2048]
    dialect = csv.Sniffer().sniff(sample, delimiters=",\t; ") if delimiter is None else csv.excel()
    if delimiter is not None:
        dialect.delimiter = delimiter
    reader = csv.DictReader(io.StringIO(cleaned), dialect=dialect)
    if not reader.fieldnames:
        raise ValueError("table header is required")

    aliases = {
        "frequency": ["frequency", "freq", "f", "freq_hz", "frequency_hz"],
        "z_real": ["z_real", "zreal", "z'", "real", "re", "z_re"],
        "z_imag": ["z_imag", "zimag", "z''", "imag", "im", "z_im"],
    }
    fields = {field.lower().strip(): field for field in reader.fieldnames}
    selected: dict[str, str] = {}
    for target, names in aliases.items():
        for candidate in names:
            if candidate in fields:
                selected[target] = fields[candidate]
                break
        if target not in selected:
            raise ValueError(f"missing required column for {target}")

    rows: list[dict[str, float]] = []
    for raw in reader:
        frequency = float(raw[selected["frequency"]])
        z_real = float(raw[selected["z_real"]])
        z_imag = float(raw[selected["z_imag"]])
        rows.append(
            {
                "frequency": frequency,
                "z_real": z_real,
                "z_imag": z_imag,
                "z_abs": math.hypot(z_real, z_imag),
                "phase": math.degrees(math.atan2(z_imag, z_real)),
            }
        )
    if not rows:
        raise ValueError("table contains no data rows")
    return summarize_dataset(kind, name, rows, source_name=source_name)


def parse_autolab_import(text: str, *, name: str, kind: str, source_name: str) -> dict[str, Any]:
    """Parse a minimal Autolab-style text export.

    The parser intentionally accepts tabular exports with comment/header lines and
    common frequency/Zreal/Zimag column names. It is conservative for v1; broader
    instrument auto-detection can be added behind this same interface.
    """
    data_lines = [
        line
        for line in text.splitlines()
        if line.strip() and not line.lstrip().startswith(("#", "%", ";"))
    ]
    if not data_lines:
        raise ValueError("Autolab import contains no tabular data")
    table = "\n".join(data_lines)
    return parse_table_import(table, name=name, kind=kind, source_name=source_name)


def parse_manuscript_pair(
    frequency_text: str,
    impedance_text: str,
    *,
    name: str,
    kind: str,
    source_name: str,
) -> dict[str, Any]:
    """Parse Part II manuscript data files into averaged complex impedance rows."""
    frequencies = [float(value) for value in frequency_text.split()]
    if not frequencies:
        raise ValueError("frequency file contains no values")

    replicate_rows: list[list[float]] = []
    expected_values = len(frequencies) * 2
    for line in impedance_text.splitlines():
        values = [float(value) for value in line.split()]
        if not values:
            continue
        if len(values) != expected_values:
            raise ValueError(
                f"impedance row has {len(values)} values; expected {expected_values} "
                f"for {len(frequencies)} frequency points"
            )
        replicate_rows.append(values)
    if not replicate_rows:
        raise ValueError("impedance file contains no replicate rows")

    rows: list[dict[str, float]] = []
    for idx, frequency in enumerate(frequencies):
        real = sum(row[idx * 2] for row in replicate_rows) / len(replicate_rows)
        imag = sum(row[idx * 2 + 1] for row in replicate_rows) / len(replicate_rows)
        rows.append(
            {
                "frequency": frequency,
                "z_real": real,
                "z_imag": imag,
                "z_abs": math.hypot(real, imag),
                "phase": math.degrees(math.atan2(imag, real)),
            }
        )

    return summarize_dataset(kind, name, rows, source_name=source_name)


def summarize_dataset(
    kind: str,
    name: str,
    rows: list[dict[str, float]],
    *,
    source_name: str,
) -> dict[str, Any]:
    frequencies = [row["frequency"] for row in rows]
    return {
        "name": name,
        "kind": kind,
        "source_name": source_name,
        "point_count": len(rows),
        "freq_min": min(frequencies),
        "freq_max": max(frequencies),
        "temperature_c": 25,
        "rows": rows,
    }
