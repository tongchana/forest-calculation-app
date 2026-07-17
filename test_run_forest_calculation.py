import math
import unittest

import pandas as pd

import run_forest_calculation as calc


class ForestCalculationLogicTests(unittest.TestCase):
    def test_component_name_can_match_existing_sheet_name(self):
        groups = calc.normalize_sheet_groups(
            [{"name": "SiteA", "sheet_names": ["SiteA", "SiteB"]}],
            ["SiteA", "SiteB"],
        )
        self.assertEqual(groups[0]["name"], "SiteA")
        self.assertNotEqual(groups[0]["internal_name"], "SiteA")

    def test_grouped_records_use_internal_component_name_when_display_name_conflicts(self):
        frame = pd.DataFrame(
            [
                {"sheet_name": "SiteA", "Species": "A"},
                {"sheet_name": "SiteB", "Species": "B"},
            ]
        )
        groups = calc.normalize_sheet_groups(
            [{"name": "SiteA", "sheet_names": ["SiteA", "SiteB"]}],
            ["SiteA", "SiteB"],
        )
        grouped = calc.append_grouped_records(frame, groups)
        internal_name = groups[0]["internal_name"]
        self.assertEqual(len(grouped[grouped["sheet_name"] == "SiteA"]), 1)
        self.assertEqual(len(grouped[grouped["sheet_name"] == internal_name]), 2)

    def test_ivi_uses_total_sampled_area_and_correct_frequency(self):
        rows = [
            {"sheet_name": "SiteA", "Species": "A", "DBH (cm)": 10.0, "Girth (cm)": None, "Plot": "P1"},
            {"sheet_name": "SiteA", "Species": "A", "DBH (cm)": 20.0, "Girth (cm)": None, "Plot": "P1"},
            {"sheet_name": "SiteA", "Species": "A", "DBH (cm)": 10.0, "Girth (cm)": None, "Plot": "P1"},
            {"sheet_name": "SiteA", "Species": "A", "DBH (cm)": 20.0, "Girth (cm)": None, "Plot": "P2"},
            {"sheet_name": "SiteA", "Species": "A", "DBH (cm)": 10.0, "Girth (cm)": None, "Plot": "P2"},
        ]
        for idx in range(3, 11):
            rows.append(
                {
                    "sheet_name": "SiteA",
                    "Species": "B",
                    "DBH (cm)": 10.0,
                    "Girth (cm)": None,
                    "Plot": f"P{idx}",
                }
            )
        tree_df = pd.DataFrame(rows)

        detail, summary = calc.build_ivi_outputs(tree_df, plot_area_ha=0.1, rai_per_hectare=6.25)
        self.assertEqual(int(summary.loc[0, "n_tree"]), 13)

        species_a = detail[detail["Species"] == "A"].iloc[0]
        expected_density_ha = 5 / (10 * 0.1)
        expected_density_rai = expected_density_ha / 6.25
        expected_frequency = 2 / 10 * 100

        ba_expected = sum(math.pi * ((dbh / 100.0) ** 2) / 4.0 for dbh in [10.0, 20.0, 10.0, 20.0, 10.0])
        dominance_expected = ba_expected / (10 * 0.1)

        self.assertAlmostEqual(species_a["Density (tree/ha)"], expected_density_ha)
        self.assertAlmostEqual(species_a["Density (tree/rai)"], expected_density_rai)
        self.assertAlmostEqual(species_a["Frequency"], expected_frequency)
        self.assertAlmostEqual(species_a["BA (m2)"], ba_expected)
        self.assertAlmostEqual(species_a["Dominance"], dominance_expected)

        total_density = detail["Density (tree/rai)"].sum()
        total_frequency = detail["Frequency"].sum()
        total_dominance = detail["Dominance"].sum()
        self.assertAlmostEqual(species_a["RDensity"], species_a["Density (tree/rai)"] / total_density * 100)
        self.assertAlmostEqual(species_a["RFrequency"], species_a["Frequency"] / total_frequency * 100)
        self.assertAlmostEqual(species_a["RDominance"], species_a["Dominance"] / total_dominance * 100)
        self.assertAlmostEqual(
            species_a["IVI"],
            species_a["RDensity"] + species_a["RFrequency"] + species_a["RDominance"],
        )

    def test_shannon_formula_unchanged(self):
        tree_df = pd.DataFrame(
            [
                {"sheet_name": "SiteA", "Species": "A", "DBH (cm)": 10.0, "Girth (cm)": None, "Plot": "P1"},
                {"sheet_name": "SiteA", "Species": "A", "DBH (cm)": 12.0, "Girth (cm)": None, "Plot": "P2"},
                {"sheet_name": "SiteA", "Species": "B", "DBH (cm)": 14.0, "Girth (cm)": None, "Plot": "P3"},
            ]
        )
        detail, summary = calc.build_ivi_outputs(tree_df, plot_area_ha=0.1, rai_per_hectare=6.25)
        expected = -(2 / 3) * math.log(2 / 3) - (1 / 3) * math.log(1 / 3)
        self.assertAlmostEqual(float(summary.loc[0, "Shannon_index"]), expected)
        self.assertAlmostEqual(float(detail["Shannon contribution"].sum()), expected)

    def test_sapling_volume_ignores_number_and_uses_one_record_per_stem(self):
        sapling_df = pd.DataFrame(
            [
                {
                    "sheet_name": "SiteA",
                    "row_no": 3,
                    "No.": 1,
                    "Species": "SapA",
                    "Girth (cm)": 31.4159265359,
                    "Height (m)": 2.0,
                    "Number": 5,
                    "Plot": "P1",
                    "TQ": None,
                }
            ]
        )
        detail, summary, _ = calc.build_volume_outputs(
            tree_df=pd.DataFrame(),
            sapling_df=sapling_df,
            ref_map={"sapa": {"thai_standard": "SapA", "scientific_name": None, "group_id": 7}},
        )
        per_stem = calc.calculate_volume_from_dbh(10.0, 7)
        self.assertAlmostEqual(float(detail.loc[0, "volume_m3"]), per_stem)
        self.assertAlmostEqual(float(summary.loc[0, "total_volume_m3"]), per_stem)

    def test_unmatched_species_fall_back_to_group_7_volume(self):
        tree_df = pd.DataFrame(
            [
                {
                    "sheet_name": "SiteA",
                    "row_no": 3,
                    "No.": 1,
                    "Species": "Unknown species",
                    "DBH (cm)": 20.0,
                    "Girth (cm)": None,
                    "Height (m)": 8.0,
                    "Plot": "P1",
                    "TQ": 2,
                }
            ]
        )
        detail, summary, unmatched = calc.build_volume_outputs(
            tree_df=tree_df,
            sapling_df=pd.DataFrame(),
            ref_map={},
        )
        expected = calc.calculate_volume_from_dbh(20.0, 7)
        self.assertFalse(bool(detail.loc[0, "matched"]))
        self.assertEqual(int(detail.loc[0, "group_id"]), 7)
        self.assertAlmostEqual(float(detail.loc[0, "volume_m3"]), expected)
        self.assertAlmostEqual(float(summary.loc[0, "total_volume_m3"]), expected)
        self.assertEqual(len(unmatched), 1)

    def test_build_summary_all_uses_passed_area_values(self):
        sapling_df = pd.DataFrame(
            [
                {"sheet_name": "SiteA", "Plot": "P1", "Number": 10},
                {"sheet_name": "SiteA", "Plot": "P2", "Number": 10},
            ]
        )
        seedling_df = pd.DataFrame(
            [
                {"sheet_name": "SiteA", "Plot": "P1", "Number": 4},
                {"sheet_name": "SiteA", "Plot": "P2", "Number": 6},
            ]
        )
        summary_all = calc.build_summary_all(
            tree_df=pd.DataFrame(columns=["sheet_name"]),
            sapling_df=sapling_df,
            seedling_df=seedling_df,
            bamboo_df=pd.DataFrame(columns=["sheet_name", "Culm"]),
            biomass_summary=pd.DataFrame(columns=["sheet_name", "biomass_total_sum"]),
            volume_summary=pd.DataFrame(columns=["sheet_name", "block_type", "n_records", "total_volume_m3"]),
            shannon_summary=pd.DataFrame(columns=["sheet_name", "Shannon_index"]),
            unmatched_df=pd.DataFrame(columns=["sheet_name", "block_type"]),
            plot_area_ha=0.2,
            rai_per_hectare=5.0,
        )
        row = summary_all.iloc[0]
        total_area_rai = 2 * 0.2 * 5.0
        self.assertAlmostEqual(row["sapling_per_rai"], 2 / total_area_rai)
        self.assertAlmostEqual(row["seedling_per_rai"], 10 / total_area_rai)

    def test_sapling_dbh_summary_uses_dbh_boundaries_and_counts_rows(self):
        sheets = {
            "DETAIL_VOLUME": pd.DataFrame(
                [
                    {
                        "sheet_name": "SiteA",
                        "block_type": "Sapling",
                        "DBH_cm": 29.9,
                        "Girth_cm": 100.0,
                        "Plot": "P1",
                        "Number": 99,
                    },
                    {
                        "sheet_name": "SiteA",
                        "block_type": "Sapling",
                        "DBH_cm": 30.0,
                        "Girth_cm": 1.0,
                        "Plot": "P2",
                        "Number": None,
                    },
                    {
                        "sheet_name": "SiteA",
                        "block_type": "Sapling",
                        "DBH_cm": 60.0,
                        "Girth_cm": 1.0,
                        "Plot": "P2",
                        "Number": 50,
                    },
                    {
                        "sheet_name": "SiteA",
                        "block_type": "Sapling",
                        "DBH_cm": 60.1,
                        "Girth_cm": 1.0,
                        "Plot": "P2",
                        "Number": 50,
                    },
                ]
            ),
            "DETAIL_SEEDLING": pd.DataFrame(columns=["sheet_name", "Plot", "Number"]),
        }
        summary = calc.build_dbh_class_summary("SiteA", sheets, plot_area_ha=0.2, rai_per_hectare=5.0)
        sapling_rows = summary[summary["Block"] == "Sapling"].reset_index(drop=True)

        self.assertEqual(sapling_rows.loc[0, "DBH Class"], "dbh < 30")
        self.assertEqual(float(sapling_rows.loc[0, "Total"]), 1.0)
        self.assertEqual(float(sapling_rows.loc[1, "Total"]), 2.0)
        self.assertEqual(float(sapling_rows.loc[2, "Total"]), 1.0)
        self.assertEqual(float(sapling_rows.loc[3, "Total"]), 4.0)


if __name__ == "__main__":
    unittest.main()
