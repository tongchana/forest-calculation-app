import sys
import unittest
from pathlib import Path

import numpy as np
import pandas as pd
from pandas import Timestamp


ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from forest_public_app.backend.app.main import (
    WORKFLOW_CACHE,
    build_biomass_payload,
    build_metrics,
    build_workflow_cache_key,
    get_cached_workflow,
    sanitize_for_json,
    store_cached_workflow,
)


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

    def test_build_biomass_payload_serializes_timestamp_preview_values(self):
        result_sheets = {
            "SUMMARY_ALL": pd.DataFrame(
                [
                    {
                        "sheet_name": "site_a",
                        "n_tree": 2,
                        "shannon_index": 0.75,
                        "observed_at": Timestamp("2026-06-17 10:15:00"),
                    }
                ]
            ),
            "SUMMARY_BIOMASS": pd.DataFrame(),
            "SUMMARY_VOLUME": pd.DataFrame(),
            "SUMMARY_SHANNON": pd.DataFrame(),
            "CHECK_UNMATCHED_SPECIES": pd.DataFrame(),
            "DETAIL_TREE_BIOMASS": pd.DataFrame(),
        }

        payload = build_biomass_payload(
            result_sheets=result_sheets,
            plot_area_ha=0.1,
            rai_per_hectare=6.25,
            sheet_groups=None,
        )

        self.assertEqual(payload["metrics"][0]["label"], "Total tree count")
        self.assertEqual(payload["previews"]["summaryAll"][0]["observed_at"], "2026-06-17T10:15:00")

    def test_sanitize_for_json_converts_numpy_scalars_recursively(self):
        value = {
            "count": np.int64(5),
            "nested": [np.float64(1.5), {"value": np.int32(2)}],
        }

        sanitized = sanitize_for_json(value)

        self.assertEqual(sanitized, {"count": 5, "nested": [1.5, {"value": 2}]})

    def test_workflow_cache_returns_copied_dataframes(self):
        WORKFLOW_CACHE.clear()
        result_sheets = {"SUMMARY_ALL": pd.DataFrame([{"sheet_name": "site_a", "n_tree": 1}])}
        cache_key = build_workflow_cache_key(
            file_bytes=b"workbook",
            plot_area_ha=0.1,
            rai_per_hectare=6.25,
            sheet_groups=[{"name": "Component 1", "sheet_names": ["site_a"]}],
        )

        store_cached_workflow(cache_key, (b"summary", b"detail", None, result_sheets))
        first = get_cached_workflow(cache_key)
        self.assertIsNotNone(first)
        first[3]["SUMMARY_ALL"].loc[0, "n_tree"] = 999
        second = get_cached_workflow(cache_key)

        self.assertEqual(second[3]["SUMMARY_ALL"].loc[0, "n_tree"], 1)


if __name__ == "__main__":
    unittest.main()
