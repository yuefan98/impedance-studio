import tempfile
import unittest
from pathlib import Path

from impedance_studio.storage import StudioStore


class StorageTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = StudioStore(Path(self.tmp.name) / "studio.sqlite3")

    def tearDown(self):
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
        datasets = self.store.list_datasets(project["id"])[:2]
        model = self.store.list_models(project["id"])[0]

        run = self.store.run_joint_fit(
            {
                "project_id": project["id"],
                "model_id": model["id"],
                "dataset_ids": [dataset["id"] for dataset in datasets],
            },
            batch=True,
        )

        self.assertEqual(run["mode"], "batch-joint-fit")
        self.assertEqual(len(run["items"]), 2)
        self.assertEqual(len(run["snapshots"]), 2)
        self.assertEqual(self.store.list_runs(project["id"])[0]["status"], "completed")

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
