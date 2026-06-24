import unittest
import warnings

import numpy as np

from impedance_studio.fitting import fit_joint_datasets


def dataset(kind, rows):
    frequencies = [row["frequency"] for row in rows]
    return {
        "id": kind,
        "project_id": "project",
        "name": kind,
        "kind": kind,
        "source_name": "synthetic.csv",
        "point_count": len(rows),
        "freq_min": min(frequencies),
        "freq_max": max(frequencies),
        "temperature_c": 25,
        "rows": rows,
        "created_at": "now",
    }


def rows(frequencies, impedance):
    return [
        {
            "frequency": float(frequency),
            "z_real": float(value.real),
            "z_imag": float(value.imag),
            "z_abs": float(abs(value)),
            "phase": float(np.angle(value, deg=True)),
        }
        for frequency, value in zip(frequencies, impedance)
    ]


class FittingTests(unittest.TestCase):
    def test_real_nleis_fit_recovers_synthetic_joint_rc_parameters(self):
        """Exercise nleis itself; a mock adapter is not accepted for fitting tests."""
        try:
            from nleis import EISandNLEIS
        except ModuleNotFoundError as exc:
            self.fail("nleis==0.3 must be installed in the Python environment used for tests.")

        frequencies = np.logspace(4, -2, 24)
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", message="Simulating circuit based on initial parameters")
            source = EISandNLEIS("RC0", "RCn0", initial_guess=[1.0, 2.0, 0.01])
            eis, second = source.predict(frequencies, max_f=1e5)

        analysis = fit_joint_datasets(
            dataset("EIS", rows(frequencies, eis)),
            dataset("2nd-NLEIS", rows(frequencies, second)),
            {
                "circuit_1": "RC0",
                "circuit_2": "RCn0",
                "initial_guess": [0.8, 1.7, 0.008],
                "constants": {},
                "bounds": {},
            },
            max_f=1e5,
        )

        result = analysis["eis"]["result"]
        self.assertEqual(result["adapter"], "nleis.EISandNLEIS")
        self.assertEqual(len(result["parameters"]), 3)
        np.testing.assert_allclose(result["parameters"], [1.0, 2.0, 0.01], rtol=1e-3, atol=1e-7)
        self.assertGreater(len(result["plot_series"]["fit"]), 0)
        self.assertGreater(len(analysis["second"]["result"]["plot_series"]["fit"]), 0)


if __name__ == "__main__":
    unittest.main()
