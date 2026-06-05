import unittest

from impedance_studio.importers import parse_autolab_import, parse_manuscript_pair, parse_table_import


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

    def test_parse_manuscript_pair_averages_replicates(self):
        parsed = parse_manuscript_pair(
            "1\n10\n",
            "2 -1 4 -2\n6 -3 8 -4\n",
            name="part_ii",
            kind="EIS",
            source_name="freq.txt + Z1s.txt",
        )

        self.assertEqual(parsed["point_count"], 2)
        self.assertEqual(parsed["rows"][0]["frequency"], 1)
        self.assertEqual(parsed["rows"][0]["z_real"], 4)
        self.assertEqual(parsed["rows"][0]["z_imag"], -2)
        self.assertEqual(parsed["rows"][1]["z_real"], 6)
        self.assertEqual(parsed["rows"][1]["z_imag"], -3)


if __name__ == "__main__":
    unittest.main()
