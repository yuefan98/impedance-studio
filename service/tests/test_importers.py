import unittest

from impedance_studio.importers import parse_autolab_import, parse_table_import


class ImporterTests(unittest.TestCase):
    def test_parse_csv_table(self):
        parsed = parse_table_import(
            "frequency,z_real,z_imag\n1000,1.0,-0.1\n10,2.0,-0.5\n",
            name="cell_a",
            kind="EIS",
            source_name="cell_a.csv",
        )

        self.assertEqual(parsed["point_count"], 2)
        self.assertEqual(parsed["freq_min"], 10)
        self.assertEqual(parsed["freq_max"], 1000)
        self.assertEqual(parsed["rows"][0]["z_abs"], (1.0**2 + 0.1**2) ** 0.5)

    def test_parse_autolab_skips_comments(self):
        parsed = parse_autolab_import(
            "# exported by instrument\nfreq\tzreal\tzimag\n100\t1\t-2\n",
            name="autolab",
            kind="2nd-NLEIS",
            source_name="autolab.txt",
        )

        self.assertEqual(parsed["kind"], "2nd-NLEIS")
        self.assertEqual(parsed["point_count"], 1)


if __name__ == "__main__":
    unittest.main()
