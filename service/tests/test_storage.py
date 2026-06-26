import tempfile
import unittest
import warnings
from pathlib import Path

import numpy as np
from nleis import EISandNLEIS

from impedance_studio.storage import StudioStore


class StorageTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = StudioStore(Path(self.tmp.name) / "studio.sqlite3")

    def tearDown(self):
        self.store.close()
        self.tmp.cleanup()

    def real_fit_fixture(self):
        project = self.store.create_project("Real fit")
        frequencies = np.logspace(4, -2, 24)
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", message="Simulating circuit based on initial parameters")
            source = EISandNLEIS("RC0", "RCn0", initial_guess=[1.0, 2.0, 0.01])
            eis_impedance, second_impedance = source.predict(frequencies, max_f=1e5)

        def parsed(kind, impedance):
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
                "name": kind,
                "kind": kind,
                "source_name": "real-nleis-synthetic",
                "point_count": len(rows),
                "freq_min": float(min(frequencies)),
                "freq_max": float(max(frequencies)),
                "temperature_c": 25,
                "rows": rows,
            }

        eis = self.store._insert_dataset(project["id"], parsed("EIS", eis_impedance))
        second = self.store._insert_dataset(project["id"], parsed("2nd-NLEIS", second_impedance))
        model = self.store.create_model(
            {
                "project_id": project["id"],
                "name": "Real RC fit",
                "circuit_1": "RC0",
                "circuit_2": "RCn0",
                "initial_guess": [0.8, 1.7, 0.008],
                "bounds": {},
                "constants": {},
            }
        )
        return project, eis, second, model

    def test_seeded_store_has_project_datasets_and_model(self):
        projects = self.store.list_projects()
        datasets = self.store.list_datasets(projects[0]["id"])
        models = self.store.list_models(projects[0]["id"])

        self.assertEqual(projects[0]["name"], "2nd-NLEIS Manuscript Part II")
        self.assertEqual(len(datasets), 20)
        self.assertTrue(all("Part II/data" in dataset["source_name"] for dataset in datasets))
        self.assertGreaterEqual(len(models), 1)
        self.assertEqual(models[0]["name"], "Two-electrode TDS joint template")
        self.assertEqual(models[0]["circuit_1"], "L0-R0-TDS0-TDS1")
        self.assertEqual(models[0]["circuit_2"], "d(TDSn0,TDSn1)")
        self.assertEqual(len(models[0]["initial_guess"]), 16)
        self.assertEqual(models[0]["initial_guess"][:2], [1e-7, 1e-3])
        self.assertEqual(models[0]["initial_guess"][-2:], [0, 0])
        self.assertEqual(models[0]["bounds"], {})
        self.assertEqual(models[0]["shared_parameters"][:2], ["TDS0_0 -> TDSn0_0", "TDS0_1 -> TDSn0_1"])

    def test_import_manuscript_sample_cycles_by_kind(self):
        project = self.store.create_project("Sample Import")

        first = self.store.import_dataset(
            {"project_id": project["id"], "mode": "manuscript", "kind": "EIS", "name": "first"}
        )
        second = self.store.import_dataset(
            {"project_id": project["id"], "mode": "manuscript", "kind": "2nd-NLEIS", "name": "second"}
        )

        self.assertEqual(first["kind"], "EIS")
        self.assertEqual(second["kind"], "2nd-NLEIS")
        self.assertEqual(first["point_count"], 66)
        self.assertEqual(second["point_count"], 66)
        self.assertIn("Part II/data", first["source_name"])

    def test_circuit_validation_reports_joint_pair(self):
        validation = self.store.validate_template(
            {
                "circuit_1": "RC0",
                "circuit_2": "RCn0",
                "initial_guess": [1, 2, 3, 4],
                "constants": {},
            }
        )

        self.assertTrue(validation["valid"])
        self.assertIn("RC0", validation["elements_1"])
        self.assertIn("RCn0", validation["elements_2"])
        self.assertEqual(validation["estimated_parameters"], 3)
        self.assertEqual(validation["parameter_names"], ["RC0_0 / RCn0_0", "RC0_1 / RCn0_1", "RCn0_2"])

    def test_circuit_validation_requires_both_joint_circuits(self):
        validation = self.store.validate_template(
            {
                "circuit_1": "R0-p(R1,CPE1)",
                "circuit_2": "",
                "initial_guess": [1, 2, 3, 4],
                "constants": {},
            }
        )

        self.assertFalse(validation["valid"])
        self.assertEqual(validation["elements_1"], ["R0", "R1", "CPE1"])
        self.assertEqual(validation["estimated_parameters"], 4)
        self.assertTrue(any("2nd-NLEIS circuit_2 is required" in message for message in validation["errors"]))

    def test_circuit_validation_rejects_malformed_eis_circuit(self):
        validation = self.store.validate_template(
            {
                "circuit_1": "R0-p(R1,)",
                "circuit_2": "",
                "initial_guess": [1, 2],
                "constants": {},
            }
        )

        self.assertFalse(validation["valid"])
        self.assertTrue(any("empty item" in message for message in validation["errors"]))

    def test_circuit_validation_rejects_wrong_element_family(self):
        eis_validation = self.store.validate_template(
            {
                "circuit_1": "RCn0",
                "circuit_2": "",
                "initial_guess": [1, 2, 3],
                "constants": {},
            }
        )
        second_validation = self.store.validate_template(
            {
                "circuit_1": "",
                "circuit_2": "R0",
                "initial_guess": [1],
                "constants": {},
            }
        )

        self.assertFalse(eis_validation["valid"])
        self.assertIn("RCn0 is not valid in EIS circuit_1", eis_validation["errors"][0])
        self.assertFalse(second_validation["valid"])
        self.assertIn("R0 is not valid in 2nd-NLEIS circuit_2", second_validation["errors"][0])

    def test_circuit_validation_rejects_second_nleis_without_linear_pair(self):
        validation = self.store.validate_template(
            {
                "circuit_1": "",
                "circuit_2": "RCn0",
                "initial_guess": [1, 2, 3],
                "constants": {},
            }
        )

        self.assertFalse(validation["valid"])
        self.assertEqual(validation["elements_1"], [])
        self.assertEqual(validation["elements_2"], ["RCn0"])
        self.assertEqual(validation["parameter_names"], ["RCn0_0", "RCn0_1", "RCn0_2"])
        self.assertTrue(any("EIS circuit_1 is required" in message for message in validation["errors"]))
        self.assertTrue(any("RCn0 requires its matching linear element" in message for message in validation["errors"]))

    def test_circuit_validation_shares_tds_pair_parameters(self):
        validation = self.store.validate_template(
            {
                "circuit_1": "TDS0",
                "circuit_2": "TDSn0",
                "initial_guess": [1, 2, 3, 4, 5, 6, 7],
                "constants": {},
            }
        )

        self.assertTrue(validation["valid"])
        self.assertEqual(validation["estimated_parameters"], 7)
        self.assertEqual(
            validation["parameter_names"],
            [
                "TDS0_0 / TDSn0_0",
                "TDS0_1 / TDSn0_1",
                "TDS0_2 / TDSn0_2",
                "TDS0_3 / TDSn0_3",
                "TDS0_4 / TDSn0_4",
                "TDSn0_5",
                "TDSn0_6",
            ],
        )

    def test_circuit_validation_maps_paper_tdp_tds_pair(self):
        validation = self.store.validate_template(
            {
                "circuit_1": "L0-R0-TDP0-TDS0",
                "circuit_2": "d(TDPn0,TDSn0)",
                "initial_guess": [1] * 16,
                "constants": {},
            }
        )

        self.assertTrue(validation["valid"])
        self.assertEqual(validation["estimated_parameters"], 16)
        self.assertEqual(validation["parameter_names"][:3], ["L0", "R0", "TDP0_0 / TDPn0_0"])
        self.assertEqual(validation["parameter_names"][7:9], ["TDPn0_5", "TDPn0_6"])
        self.assertEqual(validation["parameter_names"][-2:], ["TDSn0_5", "TDSn0_6"])

    def test_circuit_validation_matches_documented_two_electrode_tds_template(self):
        validation = self.store.validate_template(
            {
                "circuit_1": "L0-R0-TDS0-TDS1",
                "circuit_2": "d(TDSn0,TDSn1)",
                "initial_guess": [
                    1e-7,
                    1e-3,
                    5e-3,
                    1e-3,
                    10,
                    1e-2,
                    100,
                    10,
                    0.1,
                    1e-3,
                    1e-3,
                    1e-3,
                    1e-2,
                    1000,
                    0,
                    0,
                ],
                "constants": {},
            }
        )

        self.assertTrue(validation["valid"])
        self.assertEqual(validation["estimated_parameters"], 16)
        self.assertEqual(validation["parameter_names"][:4], ["L0", "R0", "TDS0_0 / TDSn0_0", "TDS0_1 / TDSn0_1"])
        self.assertEqual(validation["parameter_names"][7:9], ["TDSn0_5", "TDSn0_6"])
        self.assertEqual(validation["parameter_names"][-2:], ["TDSn1_5", "TDSn1_6"])

    def test_circuit_validation_supports_documented_rcd_pair(self):
        validation = self.store.validate_template(
            {
                "circuit_1": "RCD0-RCD1",
                "circuit_2": "d(RCDn0,RCDn1)",
                "initial_guess": [1] * 12,
                "constants": {},
            }
        )

        self.assertTrue(validation["valid"])
        self.assertEqual(validation["estimated_parameters"], 12)
        self.assertEqual(validation["parameter_names"][:4], [
            "RCD0_0 / RCDn0_0",
            "RCD0_1 / RCDn0_1",
            "RCD0_2 / RCDn0_2",
            "RCD0_3 / RCDn0_3",
        ])

    def test_circuit_validation_uses_documented_pair_parameter_counts(self):
        pairs = {
            "RC": ("RCn", 6),
            "RCD": ("RCDn", 12),
            "RCS": ("RCSn", 12),
            "TP": ("TPn", 8),
            "TDP": ("TDPn", 14),
            "TDS": ("TDSn", 14),
            "TDC": ("TDCn", 14),
            "TLM": ("TLMn", 16),
            "TLMS": ("TLMSn", 22),
            "TLMD": ("TLMDn", 22),
        }
        for linear, (nonlinear, expected_parameters) in pairs.items():
            with self.subTest(linear=linear):
                validation = self.store.validate_template(
                    {
                        "circuit_1": f"{linear}0-{linear}1",
                        "circuit_2": f"d({nonlinear}0,{nonlinear}1)",
                        "initial_guess": [1] * expected_parameters,
                        "constants": {},
                    }
                )

                self.assertTrue(validation["valid"])
                self.assertEqual(validation["estimated_parameters"], expected_parameters)

    def test_circuit_validation_rejects_unsupported_paper_group(self):
        validation = self.store.validate_template(
            {
                "circuit_1": "L0-R0-TDP0-TDS0",
                "circuit_2": "t(TDPn0,TDSn0)",
                "initial_guess": [1] * 16,
                "constants": {},
            }
        )

        self.assertFalse(validation["valid"])
        self.assertTrue(any("t(...) is not valid" in message for message in validation["errors"]))

    def test_model_json_round_trip_and_fitted_as_initial(self):
        project = self.store.list_projects()[0]
        model = self.store.create_model(
            {
                "project_id": project["id"],
                "name": "Snapshot",
                "kind": "snapshot",
                "circuit_1": "RC0",
                "circuit_2": "RCn0",
                "initial_guess": [1, 2],
                "fitted_parameters": [3, 4],
            }
        )

        exported = self.store.export_model_json(model["id"])
        self.assertEqual(exported["Parameters"], [3, 4])

        loaded = self.store.load_model_as_initial(model["id"])
        self.assertEqual(loaded["kind"], "template")
        self.assertEqual(loaded["initial_guess"], [3, 4])

    def test_batch_joint_fit_persists_run_and_snapshot(self):
        project, eis, second, model = self.real_fit_fixture()

        run = self.store.run_joint_fit(
            {
                "project_id": project["id"],
                "model_id": model["id"],
                "eis_dataset_id": eis["id"],
                "second_dataset_id": second["id"],
                "max_f": 10,
            },
            batch=True,
        )

        self.assertEqual(run["mode"], "batch-joint-fit")
        self.assertEqual(len(run["items"]), 2)
        self.assertEqual(len(run["snapshots"]), 2)
        self.assertEqual(self.store.list_runs(project["id"])[0]["status"], "completed")
        self.assertEqual(run["items"][0]["result"]["adapter"], "nleis.EISandNLEIS")

    def test_batch_joint_fit_runs_all_matched_selected_pairs(self):
        project = self.store.create_project("Batch pairs")
        rows = [
            {"frequency": 10.0, "z_real": 1.0, "z_imag": -0.1, "z_abs": 1.0, "phase": -5.0},
            {"frequency": 1.0, "z_real": 2.0, "z_imag": -0.2, "z_abs": 2.0, "phase": -6.0},
        ]

        def add_dataset(name, kind):
            return self.store._insert_dataset(
                project["id"],
                {
                    "name": name,
                    "kind": kind,
                    "source_name": f"{name}.csv",
                    "point_count": len(rows),
                    "freq_min": 1.0,
                    "freq_max": 10.0,
                    "temperature_c": 25,
                    "rows": rows,
                },
            )

        eis_a = add_dataset("cell_a_EIS", "EIS")
        second_a = add_dataset("cell_a_2nd-NLEIS", "2nd-NLEIS")
        eis_b = add_dataset("cell_b_EIS", "EIS")
        second_b = add_dataset("cell_b_2nd-NLEIS", "2nd-NLEIS")
        model = self.store.create_model(
            {
                "project_id": project["id"],
                "name": "Batch model",
                "circuit_1": "RC0",
                "circuit_2": "RCn0",
                "initial_guess": [1, 2, 3],
            }
        )
        called_pairs = []

        def fake_runner(eis_dataset, second_dataset, model, *, max_f):
            called_pairs.append((eis_dataset["name"], second_dataset["name"]))

            def result(dataset):
                return {
                    "fit_mode": "joint",
                    "adapter": "fake",
                    "circuit_1": model["circuit_1"],
                    "circuit_2": model["circuit_2"],
                    "parameters": [1, 2, 3],
                    "confidence": [0, 0, 0],
                    "validation": {"method": "fake", "chi_square": 0, "status": "pass", "message": "ok"},
                    "plot_series": {"data": dataset["rows"], "fit": dataset["rows"]},
                }

            return {
                "preprocessing": {
                    "max_f": max_f,
                    "method": "fake-preprocessing",
                    "inductance_points_removed": 0,
                    "second_points_removed": 0,
                    "eis": eis_dataset,
                    "second": second_dataset,
                },
                "eis": {"dataset": eis_dataset, "result": result(eis_dataset)},
                "second": {"dataset": second_dataset, "result": result(second_dataset)},
            }

        run = self.store.run_joint_fit(
            {
                "project_id": project["id"],
                "model_id": model["id"],
                "dataset_ids": [eis_a["id"], second_a["id"], eis_b["id"], second_b["id"]],
                "max_f": 10,
            },
            batch=True,
            fit_runner=fake_runner,
        )

        self.assertEqual(called_pairs, [("cell_a_EIS", "cell_a_2nd-NLEIS"), ("cell_b_EIS", "cell_b_2nd-NLEIS")])
        self.assertEqual(run["mode"], "batch-joint-fit")
        self.assertEqual(run["summary"]["pair_count"], 2)
        self.assertEqual(len(run["items"]), 4)
        self.assertEqual(len(run["snapshots"]), 4)

    def test_eis_fit_persists_single_eis_run(self):
        project, eis, _second, model = self.real_fit_fixture()

        def fake_runner(eis_dataset, model):
            return {
                "eis": {
                    "dataset": eis_dataset,
                    "result": {
                        "fit_mode": "eis",
                        "adapter": "impedance.CustomCircuit",
                        "circuit_1": model["circuit_1"],
                        "circuit_2": "",
                        "parameters": [1, 2],
                        "confidence": [0, 0],
                        "validation": {"method": "fake", "chi_square": 0, "status": "pass", "message": "ok"},
                        "plot_series": {"data": eis_dataset["rows"], "fit": eis_dataset["rows"]},
                    },
                }
            }

        run = self.store.run_eis_fit(
            {
                "project_id": project["id"],
                "model_id": model["id"],
                "eis_dataset_id": eis["id"],
            },
            fit_runner=fake_runner,
        )

        self.assertEqual(run["mode"], "eis-fit")
        self.assertEqual(run["summary"]["fit_mode"], "eis")
        self.assertEqual(len(run["items"]), 1)
        self.assertEqual(run["items"][0]["dataset_id"], eis["id"])
        self.assertEqual(run["items"][0]["result"]["adapter"], "impedance.CustomCircuit")

    def test_joint_preprocessing_is_used_for_preview_and_fit(self):
        project, eis, second, model = self.real_fit_fixture()
        payload = {
            "project_id": project["id"],
            "model_id": model["id"],
            "eis_dataset_id": eis["id"],
            "second_dataset_id": second["id"],
            "max_f": 10,
        }

        preprocessing = self.store.preprocess_joint_data(payload)
        run = self.store.run_joint_fit(payload)

        self.assertEqual(preprocessing["max_f"], 10)
        self.assertTrue(all(row["z_imag"] < 0 for row in preprocessing["eis"]["rows"]))
        self.assertTrue(all(row["frequency"] < 10 for row in preprocessing["second"]["rows"]))
        self.assertEqual(run["summary"]["max_f"], 10)
        self.assertEqual(run["items"][0]["result"]["plot_series"]["data"], preprocessing["eis"]["rows"])
        self.assertEqual(run["items"][1]["result"]["plot_series"]["data"], preprocessing["second"]["rows"])
        self.assertEqual(run["items"][0]["result"]["adapter"], "nleis.EISandNLEIS")

    def test_delete_dataset_removes_it_from_project(self):
        project = self.store.list_projects()[0]
        dataset = self.store.list_datasets(project["id"])[0]

        result = self.store.delete_dataset(dataset["id"])

        self.assertTrue(result["ok"])
        self.assertNotIn(dataset["id"], [item["id"] for item in self.store.list_datasets(project["id"])])

    def test_delete_model_removes_template_or_snapshot(self):
        project = self.store.list_projects()[0]
        model = self.store.list_models(project["id"])[0]

        result = self.store.delete_model(model["id"])

        self.assertTrue(result["ok"])
        self.assertNotIn(model["id"], [item["id"] for item in self.store.list_models(project["id"])])

    def test_delete_project_cascades_local_records_and_keeps_a_project(self):
        project, eis, second, model = self.real_fit_fixture()
        self.store.run_joint_fit(
            {
                "project_id": project["id"],
                "model_id": model["id"],
                "dataset_ids": [eis["id"], second["id"]],
                "eis_dataset_id": eis["id"],
                "second_dataset_id": second["id"],
                "max_f": 1e5,
            }
        )

        result = self.store.delete_project(project["id"])
        project_ids = [item["id"] for item in self.store.list_projects()]

        self.assertTrue(result["ok"])
        self.assertNotIn(project["id"], project_ids)
        self.assertGreaterEqual(len(project_ids), 1)


if __name__ == "__main__":
    unittest.main()
