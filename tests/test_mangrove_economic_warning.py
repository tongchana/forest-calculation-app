import unittest

import pandas as pd

from forest_ecosystem_loss import get_wood_product_price_flag
from forest_economics import get_increment_rate
from forest_integration import build_forest_economics_components_from_outputs
from run_forest_calculation import append_grouped_records, calculate_tree_biomass, normalize_forest_type


class MangroveEconomicWarningTests(unittest.TestCase):
    def test_mangrove_is_supported_and_grouped_rows_keep_source_sheet(self):
        self.assertEqual(normalize_forest_type("ชายเลน"), "ป่าชายเลน")
        self.assertAlmostEqual(get_increment_rate("ป่าชายเลน"), 0.022)
        self.assertEqual(get_wood_product_price_flag("ป่าชายเลน"), (0, []))
        self.assertTrue(calculate_tree_biomass(20.0, 10.0, "ป่าชายเลน")["biomass_total"] > 0)

        source = pd.DataFrame(
            [
                {
                    "sheet_name": "Plot 27",
                    "source_sheet_name": "Plot 27",
                    "row_no": 3,
                    "Plot": "27",
                    "forest_type_clean": "ป่าชายเลน",
                    "forest_type_raw": "ชายเลน",
                    "block_type": "Tree",
                    "TQ": "TQ2",
                    "volume_m3": 1.0,
                    "Species_raw": "แสม",
                }
            ]
        )
        groups = [{"name": "พื้นที่ป่าแผ่นดินใหญ่", "internal_name": "พื้นที่ป่าแผ่นดินใหญ่", "sheet_names": ["Plot 27"]}]
        grouped = append_grouped_records(source, groups)
        component_rows = grouped[grouped["sheet_name"] == "พื้นที่ป่าแผ่นดินใหญ่"]
        self.assertEqual(component_rows.iloc[0]["source_sheet_name"], "Plot 27")

        outputs = {
            "DETAIL_TREE_BIOMASS": grouped,
            "DETAIL_VOLUME": grouped,
            "__meta__": {"plot_area_ha": 0.1, "rai_per_hectare": 6.25, "sheet_groups": groups},
        }
        components, warnings = build_forest_economics_components_from_outputs(
            outputs,
            {"พื้นที่ป่าแผ่นดินใหญ่": 10.0},
        )
        self.assertEqual(warnings, ["plot_area_rai derived uniformly from metadata: plot_area_ha=0.1 and rai_per_hectare=6.25"])
        self.assertEqual(components[0].related_plots[0].forest_type, "ป่าชายเลน")


if __name__ == "__main__":
    unittest.main()
