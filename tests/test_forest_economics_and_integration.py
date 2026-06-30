import sys
import unittest
from pathlib import Path

import pandas as pd


ROOT_DIR = Path(__file__).resolve().parents[1]
WEB_APPS_DIR = ROOT_DIR / "web_apps"
if str(WEB_APPS_DIR) not in sys.path:
    sys.path.insert(0, str(WEB_APPS_DIR))

from forest_economics import Component, Plot, PriceResult, TQRecord, calculate_forest_economics
from forest_integration import (
    EcosystemUserInput,
    build_ecosystem_inputs_from_outputs,
    build_forest_economics_components_from_outputs,
    calculate_forest_valuation_bundle_from_outputs,
)


class ForestEconomicsAndIntegrationTests(unittest.TestCase):
    def test_forest_economics_calculates_species_level_and_tq_totals(self):
        component = Component(
            component_id="comp_a",
            component_name="Component A",
            component_area_rai=10,
            related_plots=[
                Plot(
                    plot_id="P1",
                    component_id="comp_a",
                    plot_area_rai=1,
                    forest_type="ป่าเบญจพรรณ",
                    tq_records=[
                        TQRecord(tq="1", volume_m3=2, species_name="สัก", species_volume_m3=2),
                        TQRecord(tq="1", volume_m3=1, species_name="ประดู่", species_volume_m3=1),
                        TQRecord(tq="2", volume_m3=1, species_name="แดง", species_volume_m3=1),
                    ],
                ),
                Plot(
                    plot_id="P2",
                    component_id="comp_a",
                    plot_area_rai=1,
                    forest_type="ป่าเบญจพรรณ",
                    tq_records=[
                        TQRecord(tq="1", volume_m3=2, species_name="สัก", species_volume_m3=2),
                        TQRecord(tq="2", volume_m3=3, species_name="แดง", species_volume_m3=3),
                    ],
                ),
            ],
        )

        def resolver(payload):
            species_name = payload["species_name"]
            if species_name == "สัก":
                return PriceResult(status="CALCULATED", price_per_m3=16630, notes="teak default")
            if species_name == "ประดู่":
                return PriceResult(status="CALCULATED", price_per_m3=18437, notes="direct B3")
            if species_name == "แดง":
                return PriceResult(status="CALCULATED", price_per_m3=18437, notes="direct B3")
            return PriceResult(status="MISSING_PRICE", notes="unknown species")

        result = calculate_forest_economics([component], price_lookup=resolver)

        self.assertEqual(len(result.species_detail_rows), 3)
        self.assertEqual(len(result.detail_rows), 2)

        tq1 = next(row for row in result.detail_rows if row.tq == "TQ1")
        self.assertAlmostEqual(tq1.volume_m3, 5.0)
        self.assertAlmostEqual(tq1.volume_per_rai_m3, 2.5)
        self.assertAlmostEqual(tq1.wood_loss_m3, 25.0)
        self.assertAlmostEqual(tq1.annual_increment_m3_per_year, 0.5)
        self.assertAlmostEqual(tq1.wood_price_per_m3, ((20 * 16630) + (5 * 18437)) / 25)
        self.assertAlmostEqual(tq1.wood_value_baht, (20 * 16630) + (5 * 18437))
        self.assertAlmostEqual(tq1.annual_wood_value_baht, 8495.7)
        self.assertEqual(tq1.price_status, "CALCULATED")
        self.assertIsNotNone(tq1.wood_value_baht)

        summary = result.component_summaries[0]
        self.assertEqual(summary.calculation_status, "CALCULATED")
        self.assertAlmostEqual(summary.total_wood_loss_m3, 45.0)
        self.assertAlmostEqual(summary.total_annual_increment_m3_per_year, 0.9)
        self.assertAlmostEqual(summary.total_annual_wood_value_baht, 15870.5)
        self.assertAlmostEqual(result.grand_total.total_wood_loss_m3, 45.0)
        self.assertAlmostEqual(result.grand_total.total_annual_wood_value_baht, 15870.5)

    def test_build_forest_economics_components_from_outputs_joins_forest_type(self):
        outputs = {
            "DETAIL_VOLUME": pd.DataFrame(
                [
                    {
                        "sheet_name": "comp_internal",
                        "block_type": "Tree",
                        "row_no": 3,
                        "Plot": "P1",
                        "TQ": 1,
                        "volume_m3": 2.0,
                        "thai_standard": "สัก",
                        "Species_norm": "สัก",
                        "Species_raw": "สัก",
                    },
                    {
                        "sheet_name": "comp_internal",
                        "block_type": "Tree",
                        "row_no": 4,
                        "Plot": "P2",
                        "TQ": 2,
                        "volume_m3": 3.0,
                        "thai_standard": "แดง",
                        "Species_norm": "แดง",
                        "Species_raw": "แดง",
                    },
                ]
            ),
            "DETAIL_TREE_BIOMASS": pd.DataFrame(
                [
                    {
                        "sheet_name": "comp_internal",
                        "row_no": 3,
                        "Plot": "P1",
                        "DBH_cm": 20.0,
                        "forest_type_clean": "ป่าเบญจพรรณ",
                        "forest_type_raw": "เบญจพรรณ",
                    },
                    {
                        "sheet_name": "comp_internal",
                        "row_no": 4,
                        "Plot": "P2",
                        "DBH_cm": 25.0,
                        "forest_type_clean": "ป่าเต็งรัง",
                        "forest_type_raw": "เต็งรัง",
                    },
                ]
            ),
            "__meta__": {
                "plot_area_ha": 0.1,
                "rai_per_hectare": 6.25,
                "sheet_groups": [
                    {"internal_name": "comp_internal", "name": "Component A", "sheet_names": ["S1", "S2"]}
                ],
            },
        }

        components, warnings = build_forest_economics_components_from_outputs(
            outputs=outputs,
            component_area_inputs={"Component A": 10},
        )

        self.assertEqual(len(components), 1)
        component = components[0]
        self.assertEqual(component.component_name, "Component A")
        self.assertEqual(component.component_area_rai, 10)
        self.assertEqual(len(component.related_plots), 2)
        self.assertEqual({plot.forest_type for plot in component.related_plots}, {"ป่าเบญจพรรณ", "ป่าเต็งรัง"})
        self.assertTrue(warnings)

    def test_build_ecosystem_inputs_from_outputs_derives_basal_area_percent_by_forest_type(self):
        outputs = {
            "DETAIL_TREE_BIOMASS": pd.DataFrame(
                [
                    {
                        "sheet_name": "comp_internal",
                        "row_no": 3,
                        "Plot": "P1",
                        "DBH_cm": 20.0,
                        "forest_type_clean": "ป่าเบญจพรรณ",
                        "forest_type_raw": "เบญจพรรณ",
                    },
                    {
                        "sheet_name": "comp_internal",
                        "row_no": 4,
                        "Plot": "P1",
                        "DBH_cm": 20.0,
                        "forest_type_clean": "ป่าเบญจพรรณ",
                        "forest_type_raw": "เบญจพรรณ",
                    },
                    {
                        "sheet_name": "comp_internal",
                        "row_no": 5,
                        "Plot": "P2",
                        "DBH_cm": 10.0,
                        "forest_type_clean": "ป่าเต็งรัง",
                        "forest_type_raw": "เต็งรัง",
                    },
                ]
            ),
            "__meta__": {
                "plot_area_ha": 0.1,
                "rai_per_hectare": 6.25,
                "sheet_groups": [
                    {"internal_name": "comp_internal", "name": "Component A", "sheet_names": ["S1", "S2"]}
                ],
            },
        }

        grouped_inputs, warnings = build_ecosystem_inputs_from_outputs(
            outputs=outputs,
            component_user_inputs=[
                EcosystemUserInput(
                    component_name="Component A",
                    component_area_rai=10,
                    canopy_cover_percent=60,
                    canopy_layer_count=2,
                    soil_depth_m=0.3,
                    annual_rainfall_mm=1320,
                    topography_score=16,
                )
            ],
        )

        self.assertIn("comp_internal", grouped_inputs)
        component_inputs = grouped_inputs["comp_internal"]
        self.assertEqual(len(component_inputs), 2)
        ba_lookup = {item.forest_type: item.basal_area_percent for item in component_inputs}
        self.assertGreater(ba_lookup["ป่าเบญจพรรณ"], ba_lookup["ป่าเต็งรัง"])
        self.assertTrue(warnings)

    def test_grouped_components_only_and_bundle_outputs(self):
        outputs = {
            "DETAIL_VOLUME": pd.DataFrame(
                [
                    {
                        "sheet_name": "comp_internal",
                        "block_type": "Tree",
                        "row_no": 3,
                        "Plot": "P1",
                        "TQ": 1,
                        "volume_m3": 2.0,
                        "thai_standard": "ประดู่",
                        "Species_norm": "ประดู่",
                        "Species_raw": "ประดู่บ้าน",
                    },
                    {
                        "sheet_name": "plain_sheet",
                        "block_type": "Tree",
                        "row_no": 3,
                        "Plot": "P1",
                        "TQ": 1,
                        "volume_m3": 4.0,
                        "thai_standard": "สัก",
                        "Species_norm": "สัก",
                        "Species_raw": "ไม้สัก",
                    },
                ]
            ),
            "DETAIL_TREE_BIOMASS": pd.DataFrame(
                [
                    {
                        "sheet_name": "comp_internal",
                        "row_no": 3,
                        "Plot": "P1",
                        "DBH_cm": 20.0,
                        "forest_type_clean": "ป่าเบญจพรรณ",
                        "forest_type_raw": "เบญจพรรณ",
                    },
                    {
                        "sheet_name": "plain_sheet",
                        "row_no": 3,
                        "Plot": "P1",
                        "DBH_cm": 20.0,
                        "forest_type_clean": "ป่าดิบแล้ง",
                        "forest_type_raw": "ดิบแล้ง",
                    },
                ]
            ),
            "__meta__": {
                "plot_area_ha": 0.1,
                "rai_per_hectare": 6.25,
                "sheet_groups": [
                    {"internal_name": "comp_internal", "name": "Component A", "sheet_names": ["S1"]}
                ],
            },
        }

        components, _warnings = build_forest_economics_components_from_outputs(
            outputs=outputs,
            component_area_inputs={"Component A": 10, "plain_sheet": 20},
        )
        self.assertEqual(len(components), 1)
        self.assertEqual(components[0].component_id, "comp_internal")

        bundle = calculate_forest_valuation_bundle_from_outputs(
            outputs=outputs,
            component_area_inputs={"Component A": 10},
            ecosystem_user_inputs=[
                EcosystemUserInput(
                    component_name="Component A",
                    component_area_rai=10,
                    canopy_cover_percent=60,
                    canopy_layer_count=2,
                    soil_depth_m=0.3,
                    annual_rainfall_mm=1320,
                    topography_score=16,
                )
            ],
        )
        self.assertIn("forest_economics", bundle)
        self.assertIn("wood_future_value", bundle)
        self.assertIn("regeneration_loss", bundle)
        self.assertIn("ecosystem_loss", bundle)
        self.assertEqual(len(bundle["forest_economics"]["componentSummaries"]), 1)
        self.assertEqual(bundle["forest_economics"]["componentSummaries"][0]["component_name"], "Component A")
        self.assertEqual(len(bundle["wood_future_value"]["periodRows"]), 6)
        self.assertEqual(len(bundle["ecosystem_loss"]["componentSummaries"]), 1)

    def test_bundle_calculates_regeneration_loss_from_summary_all(self):
        outputs = {
            "DETAIL_VOLUME": pd.DataFrame(
                [
                    {
                        "sheet_name": "comp_internal",
                        "block_type": "Tree",
                        "row_no": 3,
                        "Plot": "P1",
                        "TQ": 1,
                        "volume_m3": 2.0,
                        "thai_standard": "à¸›à¸£à¸°à¸”à¸¹à¹ˆ",
                        "Species_norm": "à¸›à¸£à¸°à¸”à¸¹à¹ˆ",
                        "Species_raw": "à¸›à¸£à¸°à¸”à¸¹à¹ˆ",
                    },
                ]
            ),
            "DETAIL_TREE_BIOMASS": pd.DataFrame(
                [
                    {
                        "sheet_name": "comp_internal",
                        "row_no": 3,
                        "Plot": "P1",
                        "DBH_cm": 20.0,
                        "forest_type_clean": "à¸›à¹ˆà¸²à¹€à¸šà¸à¸ˆà¸žà¸£à¸£à¸“",
                        "forest_type_raw": "à¹€à¸šà¸à¸ˆà¸žà¸£à¸£à¸“",
                    },
                ]
            ),
            "SUMMARY_ALL": pd.DataFrame(
                [
                    {
                        "sheet_name": "comp_internal",
                        "sapling_per_rai": 4.0,
                        "seedling_per_rai": 10.0,
                    }
                ]
            ),
            "__meta__": {
                "plot_area_ha": 0.1,
                "rai_per_hectare": 6.25,
                "sheet_groups": [
                    {"internal_name": "comp_internal", "name": "Component A", "sheet_names": ["S1"]}
                ],
            },
        }
        bundle = calculate_forest_valuation_bundle_from_outputs(
            outputs=outputs,
            component_area_inputs={"Component A": 10},
            ecosystem_user_inputs=[
                EcosystemUserInput(
                    component_name="Component A",
                    component_area_rai=10,
                    canopy_cover_percent=60,
                    canopy_layer_count=2,
                    soil_depth_m=0.3,
                    annual_rainfall_mm=1320,
                    topography_score=16,
                )
            ],
        )
        summary = bundle["regeneration_loss"]["componentSummaries"][0]
        self.assertAlmostEqual(summary["sapling_estimated_count"], 40.0)
        self.assertAlmostEqual(summary["seedling_estimated_count"], 100.0)
        self.assertAlmostEqual(summary["sapling_loss_baht"], 1080.0)
        self.assertAlmostEqual(summary["seedling_loss_baht"], 600.0)
        self.assertAlmostEqual(summary["total_regeneration_loss_baht"], 1680.0)

    def test_ecosystem_loss_ignores_non_grouped_component_inputs(self):
        outputs = {
            "DETAIL_TREE_BIOMASS": pd.DataFrame(
                [
                    {
                        "sheet_name": "comp_internal",
                        "row_no": 3,
                        "Plot": "P1",
                        "DBH_cm": 20.0,
                        "forest_type_clean": "ป่าเบญจพรรณ",
                        "forest_type_raw": "เบญจพรรณ",
                    },
                ]
            ),
            "__meta__": {
                "plot_area_ha": 0.1,
                "rai_per_hectare": 6.25,
                "sheet_groups": [
                    {"internal_name": "comp_internal", "name": "Component A", "sheet_names": ["S1"]}
                ],
            },
        }
        grouped_inputs, warnings = build_ecosystem_inputs_from_outputs(
            outputs=outputs,
            component_user_inputs=[
                EcosystemUserInput(
                    component_name="plain_sheet",
                    component_area_rai=10,
                    canopy_cover_percent=60,
                    canopy_layer_count=2,
                    soil_depth_m=0.3,
                    annual_rainfall_mm=1320,
                    topography_score=16,
                )
            ],
        )
        self.assertEqual(grouped_inputs, {})
        self.assertTrue(any("ignores non-grouped component input" in warning for warning in warnings))


if __name__ == "__main__":
    unittest.main()
