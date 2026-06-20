import unittest
from unittest.mock import patch

from impedance_studio.preprocessing import preprocess_joint_datasets


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


class PreprocessingTests(unittest.TestCase):
    def test_calls_nleis_data_truncation_and_uses_all_returned_series(self):
        eis = dataset("EIS", [row(100, 1, 0.2), row(10, 2, -1), row(1, 3, -2)])
        second = dataset("2nd-NLEIS", [row(100, 10, -1), row(10, 20, -2), row(1, 30, -3)])
        received = {}

        def fake_data_truncation(frequencies, z1, z2, max_f):
            received["frequencies"] = list(frequencies)
            received["z1"] = list(z1)
            received["z2"] = list(z2)
            received["max_f"] = max_f
            return frequencies[1:], z1[1:], z2[1:], frequencies[2:], z2[2:]

        with patch("impedance_studio.preprocessing._load_data_truncation", return_value=fake_data_truncation):
            processed = preprocess_joint_datasets(eis, second, max_f=5)

        self.assertEqual(received["frequencies"], [100.0, 10.0, 1.0])
        self.assertEqual(received["max_f"], 5)
        self.assertEqual(processed["method"], "nleis.data_processing.data_truncation")
        self.assertEqual([row["frequency"] for row in processed["eis"]["rows"]], [10.0, 1.0])
        self.assertEqual([row["frequency"] for row in processed["second"]["rows"]], [1.0])

    def test_aligns_the_pair_on_shared_frequencies(self):
        eis = dataset("EIS", [row(10, 1, -1)])
        second = dataset("2nd-NLEIS", [row(10, 1, -1), row(1, 1, -1)])

        processed = preprocess_joint_datasets(eis, second, max_f=11)

        self.assertEqual([row["frequency"] for row in processed["eis"]["rows"]], [10.0])
        self.assertEqual([row["frequency"] for row in processed["second"]["rows"]], [10.0])

    def test_requires_at_least_one_shared_frequency(self):
        eis = dataset("EIS", [row(10, 1, -1)])
        second = dataset("2nd-NLEIS", [row(1, 1, -1)])

        with self.assertRaisesRegex(ValueError, "share at least one frequency"):
            preprocess_joint_datasets(eis, second, max_f=10)


if __name__ == "__main__":
    unittest.main()
