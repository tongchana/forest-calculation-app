import sys
import unittest
from pathlib import Path

import numpy as np
import pandas as pd
from pandas import Timestamp


ROOT_DIR = Path(__file__).resolve().parents[1]
WEB_APPS_DIR = ROOT_DIR / "web_apps"
if str(WEB_APPS_DIR) not in sys.path:
    sys.path.insert(0, str(WEB_APPS_DIR))

from forest_public_app.backend.app.main import (
    WORKFLOW_CACHE,
    build_biomass_payload,
    build_economic_preview,
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

    def test_build_economic_preview_includes_area_scaled_tree_counts(self):
        outputs = {
            "DETAIL_VOLUME": pd.DataFrame(
                [
                    {"sheet_name": "comp_internal", "block_type": "Tree", "Plot": "P1"},
                    {"sheet_name": "comp_internal", "block_type": "Tree", "Plot": "P1"},
                ]
            ),
            "__meta__": {"plot_area_ha": 0.1, "rai_per_hectare": 6.25},
        }
        bundle = {
            "forest_economics": {
                "componentSummaries": [
                    {
                        "component_id": "comp_internal",
                        "component_name": "Component A",
                        "component_area_rai": 10,
                        "forest_types_detected": [],
                        "tq_detected": [],
                        "total_wood_loss_m3": 0,
                        "total_annual_increment_m3_per_year": 0,
                        "total_annual_wood_value_baht": 0,
                        "total_wood_value_baht": 0,
                        "warnings": [],
                    }
                ],
                "grandTotal": {"total_wood_loss_m3": 0},
            },
            "regeneration_loss": {
                "componentSummaries": [
                    {
                        "component_id": "comp_internal",
                        "sapling_estimated_count": 40,
                        "seedling_estimated_count": 100,
                        "sapling_loss_baht": 1080,
                        "seedling_loss_baht": 600,
                        "total_regeneration_loss_baht": 1680,
                    }
                ]
            },
            "ecosystem_loss": {"componentSummaries": [], "groupResults": []},
            "wood_future_value": {"periodRows": [], "componentSummaries": [], "warnings": []},
            "warnings": [],
        }

        preview = build_economic_preview(bundle, outputs)
        row = preview["componentSummaries"][0]

        self.assertAlmostEqual(row["treeDensityPerRai"], 3.2)
        self.assertEqual(row["saplingDensityPerRai"], None)
        self.assertEqual(row["seedlingDensityPerRai"], None)
        self.assertAlmostEqual(row["estimatedTreeCount"], 32)
        self.assertEqual(row["estimatedSaplingCount"], 40)
        self.assertEqual(row["estimatedSeedlingCount"], 100)

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
