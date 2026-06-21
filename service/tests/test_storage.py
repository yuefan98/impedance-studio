import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from impedance_studio.preprocessing import preprocess_joint_datasets
from impedance_studio.storage import StudioStore


def fake_joint_fit(eis, second, model, *, max_f):
    preprocessing = preprocess_joint_datasets(eis, second, max_f=max_f)

    def fitted(dataset):
        result = {
            "fit_mode": "joint",
            "adapter": "test-nleis-adapter",
            "circuit_1": model["circuit_1"],
            "circuit_2": model["circuit_2"],
            "parameters": model["initial_guess"],
            "confidence": [0.0] * len(model["initial_guess"]),
            "validation": {"method": "nleis.EISandNLEIS", "chi_square": 0.0, "status": "pass", "message": "test"},
            "plot_series": {"data": dataset["rows"], "fit": dataset["rows"]},
        }
        return {"dataset": dataset, "result": result}

    return {"preprocessing": preprocessing, "eis": fitted(preprocessing["eis"]), "second": fitted(preprocessing["second"])}


class StorageTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = StudioStore(Path(self.tmp.name) / "studio.sqlite3")
        self.fit_patch = patch("impedance_studio.storage.fit_joint_datasets", side_effect=fake_joint_fit)
        self.fit_patch.start()

    def tearDown(self):
        self.fit_patch.stop()
        self.store.close()
        self.tmp.cleanup()

    def test_seeded_store_has_project_datasets_and_model(self):
        projects = self.store.list_projects()
        datasets = self.store.list_datasets(projects[0]["id"])
        models = self.store.list_models(projects[0]["id"])

        self.assertEqual(projects[0]["name"], "2nd-NLEIS Manuscript Part II")
        self.assertEqual(len(datasets), 20)
        self.assertTrue(all("Part II/data" in dataset["source_name"] for dataset in datasets))
        self.assertGreaterEqual(len(models), 1)
        self.assertEqual(models[0]["initial_guess"], [0.84, 15.2, 0.001])
        self.assertEqual(models[0]["shared_parameters"], ["RC0_0 -> RCn0_0", "RC0_1 -> RCn0_1"])

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

    def test_circuit_validation_accepts_impedance_eis_circuit(self):
        validation = self.store.validate_template(
            {
                "circuit_1": "R0-p(R1,CPE1)",
                "circuit_2": "",
                "initial_guess": [1, 2, 3, 4],
                "constants": {},
            }
        )

        self.assertTrue(validation["valid"])
        self.assertEqual(validation["elements_1"], ["R0", "R1", "CPE1"])
        self.assertEqual(validation["estimated_parameters"], 4)

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

    def test_circuit_validation_accepts_second_nleis_only_circuit(self):
        validation = self.store.validate_template(
            {
                "circuit_1": "",
                "circuit_2": "RCn0",
                "initial_guess": [1, 2, 3],
                "constants": {},
            }
        )

        self.assertTrue(validation["valid"])
        self.assertEqual(validation["elements_1"], [])
        self.assertEqual(validation["elements_2"], ["RCn0"])
        self.assertEqual(validation["parameter_names"], ["RCn0_0", "RCn0_1", "RCn0_2"])

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
        project = self.store.list_projects()[0]
        datasets = self.store.list_datasets(project["id"])
        eis = next(dataset for dataset in datasets if dataset["kind"] == "EIS")
        second = next(dataset for dataset in datasets if dataset["kind"] == "2nd-NLEIS")
        model = self.store.list_models(project["id"])[0]

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

    def test_joint_preprocessing_is_used_for_preview_and_fit(self):
        project = self.store.list_projects()[0]
        datasets = self.store.list_datasets(project["id"])
        eis = next(dataset for dataset in datasets if dataset["kind"] == "EIS")
        second = next(dataset for dataset in datasets if dataset["kind"] == "2nd-NLEIS")
        payload = {
            "project_id": project["id"],
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
        project = self.store.list_projects()[0]
        self.store.run_joint_fit(
            {
                "project_id": project["id"],
                "model_id": self.store.list_models(project["id"])[0]["id"],
                "dataset_ids": [self.store.list_datasets(project["id"])[0]["id"]],
            }
        )

        result = self.store.delete_project(project["id"])
        project_ids = [item["id"] for item in self.store.list_projects()]

        self.assertTrue(result["ok"])
        self.assertNotIn(project["id"], project_ids)
        self.assertGreaterEqual(len(project_ids), 1)


if __name__ == "__main__":
    unittest.main()
