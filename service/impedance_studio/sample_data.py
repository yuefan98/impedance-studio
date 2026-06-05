from __future__ import annotations

from pathlib import Path
from typing import Any

from .importers import parse_manuscript_pair


MANUSCRIPT_SAMPLE_CONDITIONS = ("10a", "10f", "30a", "30f", "40a", "40f", "50a", "50f", "60a", "60f")
MANUSCRIPT_SAMPLE_SOURCE = "Part II/data"
_SAMPLE_DIR = Path(__file__).resolve().parents[1] / "sample_data" / "manuscript_part_ii"


def load_manuscript_samples() -> list[dict[str, Any]]:
    datasets: list[dict[str, Any]] = []
    for condition in MANUSCRIPT_SAMPLE_CONDITIONS:
        datasets.extend(_load_condition(condition))
    return datasets


def manuscript_sample(kind: str, index: int = 0) -> dict[str, Any]:
    samples = [dataset for dataset in load_manuscript_samples() if dataset["kind"] == kind]
    if not samples:
        raise ValueError(f"no manuscript sample data found for {kind}")
    return samples[index % len(samples)]


def _load_condition(condition: str) -> list[dict[str, Any]]:
    frequency_text = _read_sample_file(f"freq_{condition}.txt")
    return [
        parse_manuscript_pair(
            frequency_text,
            _read_sample_file(f"Z1s_{condition}.txt"),
            name=f"PartII_{condition}_EIS",
            kind="EIS",
            source_name=f"{MANUSCRIPT_SAMPLE_SOURCE}/freq_{condition}.txt + Z1s_{condition}.txt",
        ),
        parse_manuscript_pair(
            frequency_text,
            _read_sample_file(f"Z2s_{condition}.txt"),
            name=f"PartII_{condition}_2nd-NLEIS",
            kind="2nd-NLEIS",
            source_name=f"{MANUSCRIPT_SAMPLE_SOURCE}/freq_{condition}.txt + Z2s_{condition}.txt",
        ),
    ]


def _read_sample_file(filename: str) -> str:
    path = _SAMPLE_DIR / filename
    if not path.exists():
        raise FileNotFoundError(f"missing manuscript sample file: {path}")
    return path.read_text(encoding="utf-8")
