import tempfile
import unittest
import warnings
from pathlib import Path
from unittest.mock import patch

import numpy as np
from nleis import EISandNLEIS

from impedance_studio.execution import LocalExecutionManager
from impedance_studio.fitting import fit_joint_datasets


def _dataset(kind, frequencies, impedance):
    rows = [
        {
            "frequency": float(frequency),
            "z_real": float(value.real),
            "z_imag": float(value.imag),
            "z_abs": float(abs(value)),
            "phase": float(np.angle(value, deg=True)),
        }
        for frequency, value in zip(frequencies, impedance)
    ]
    return {
        "id": kind,
        "project_id": "project",
        "name": kind,
        "kind": kind,
        "source_name": "synthetic.csv",
        "point_count": len(rows),
        "freq_min": min(row["frequency"] for row in rows),
        "freq_max": max(row["frequency"] for row in rows),
        "temperature_c": 25,
        "rows": rows,
    }


class LocalExecutionTests(unittest.TestCase):
    def test_selected_environment_runs_a_real_joint_fit_in_worker_process(self):
        frequencies = np.logspace(4, -2, 24)
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", message="Simulating circuit based on initial parameters")
            source = EISandNLEIS("RC0", "RCn0", initial_guess=[1.0, 2.0, 0.01])
            eis, second = source.predict(frequencies, max_f=1e5)

        with tempfile.TemporaryDirectory() as directory:
            manager = LocalExecutionManager(settings_path=Path(directory) / "execution.json", conda_command="")
            ready = next(environment for environment in manager.status()["environments"] if environment["ready"])
            selected = manager.select_environment(ready["executable"])
            self.assertEqual(selected["selected_executable"], ready["executable"])

            payload = {
                "eis_dataset": _dataset("EIS", frequencies, eis),
                "second_dataset": _dataset("2nd-NLEIS", frequencies, second),
                "model": {
                    "circuit_1": "RC0",
                    "circuit_2": "RCn0",
                    "initial_guess": [0.8, 1.7, 0.008],
                    "constants": {},
                    "bounds": {},
                },
                "max_f": 1e5,
            }
            with patch("impedance_studio.execution._same_executable", return_value=False):
                analysis = manager.fit(payload, fit_joint_datasets)

        self.assertEqual(analysis["eis"]["result"]["adapter"], "nleis.EISandNLEIS")
        np.testing.assert_allclose(analysis["eis"]["result"]["parameters"], [1.0, 2.0, 0.01], rtol=1e-3, atol=1e-7)


if __name__ == "__main__":
    unittest.main()
