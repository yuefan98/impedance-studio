import unittest
from unittest.mock import patch

import numpy as np

from impedance_studio.fitting import fit_joint_datasets


def dataset(kind, rows):
    frequencies = [row["frequency"] for row in rows]
    return {
        "id": kind,
        "project_id": "project",
        "name": kind,
        "kind": kind,
        "source_name": "test.csv",
        "point_count": len(rows),
        "freq_min": min(frequencies),
        "freq_max": max(frequencies),
        "temperature_c": 25,
        "rows": rows,
        "created_at": "now",
    }


def row(frequency, real, imag):
    return {
        "frequency": frequency,
        "z_real": real,
        "z_imag": imag,
        "z_abs": abs(complex(real, imag)),
        "phase": 0,
    }


class FakeCircuit:
    last_fit = None

    def __init__(self, circuit_1, circuit_2, initial_guess, constants):
        self.circuit_1 = circuit_1
        self.circuit_2 = circuit_2
        self.parameters_ = np.asarray(initial_guess, dtype=float)
        self.conf_ = np.asarray([0.1] * len(initial_guess))

    def fit(self, frequencies, z1, z2, **kwargs):
        FakeCircuit.last_fit = {"frequencies": frequencies, "z1": z1, "z2": z2, **kwargs}
        return self

    def predict(self, frequencies, max_f):
        return frequencies.astype(complex), frequencies[frequencies < max_f].astype(complex)


class FittingTests(unittest.TestCase):
    def test_real_fit_adapter_uses_nleis_contract_and_max_frequency(self):
        eis = dataset("EIS", [row(100, 1, 0.1), row(10, 2, -1), row(1, 3, -2)])
        second = dataset("2nd-NLEIS", [row(100, 10, -1), row(10, 20, -2), row(1, 30, -3)])
        model = {"circuit_1": "RC0", "circuit_2": "RCn0", "initial_guess": [1, 2, 3], "constants": {}, "bounds": {}}

        with patch("impedance_studio.fitting._load_nleis", return_value=(FakeCircuit, np)):
            analysis = fit_joint_datasets(eis, second, model, max_f=5)

        self.assertEqual(FakeCircuit.last_fit["max_f"], 5)
        self.assertEqual(list(FakeCircuit.last_fit["frequencies"]), [10.0, 1.0])
        self.assertEqual(analysis["eis"]["result"]["adapter"], "nleis.EISandNLEIS")
        self.assertEqual([row["frequency"] for row in analysis["second"]["result"]["plot_series"]["data"]], [1.0])
        self.assertEqual(analysis["eis"]["result"]["parameters"], [1.0, 2.0, 3.0])


if __name__ == "__main__":
    unittest.main()
