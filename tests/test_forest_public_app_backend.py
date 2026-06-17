import sys
import unittest
from pathlib import Path

import pandas as pd


ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from forest_public_app.backend.app.main import build_metrics


class ForestPublicAppBackendTests(unittest.TestCase):
    def test_build_metrics_tolerates_missing_summary_columns(self):
        summary_all = pd.DataFrame(
            [
                {
                    "sheet_name": "site_a",
                    "shannon_index": 1.23,
                }
            ]
        )

        metrics = build_metrics(summary_all, pd.DataFrame(), result_sheets={})

        self.assertEqual(len(metrics), 7)
        self.assertEqual(metrics[0].label, "Total tree count")
        self.assertEqual(metrics[0].value, "0")
        self.assertEqual(metrics[5].label, "Shannon index")
        self.assertEqual(metrics[5].value, "1.230000")


if __name__ == "__main__":
    unittest.main()
