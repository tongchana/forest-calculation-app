# Forest Calculation Runner

Run the unified workbook workflow with:

```bash
python run_forest_calculation.py template.xlsx --master species_reference_master_v1.xlsx -o forest_calculation_output.xlsx
```

Optional arguments:

```bash
--plot-area-ha 0.4
--rai-per-hectare 6.25
```

If `-o/--output` is omitted, the script writes:

```text
template_summary_by_site.xlsx
template_details.xlsx
```

What the script does:

- Reads each non-output worksheet in `template.xlsx`
- Uses Tree rows for biomass, volume, and IVI/Shannon
- Uses Sapling rows for volume only
- Uses Seedling rows for count summaries only
- Uses Bamboo rows for culm summaries only
- Writes two new output workbooks without modifying the input file

Running:

```bash
python run_forest_calculation.py template.xlsx --master species_reference_master_v1.xlsx -o forest_calculation_output.xlsx
```

creates:

```text
forest_calculation_output_summary_by_site.xlsx
forest_calculation_output_details.xlsx
```

Summary workbook:

- Contains one worksheet per input worksheet/site
- Each worksheet includes:
  - Overall Summary
  - Biomass Summary
  - Volume Summary
  - Shannon Summary
  - IVI Summary
  - General Tree Stand Summary
  - DBH Class Summary
  - TQ Volume Summary
- Seedling Summary, Bamboo Summary, and Unmatched Species are not shown in the site summary workbook

Detail workbook:

- Contains detailed calculation tables for checking and auditing
- Still keeps seedling, bamboo, and unmatched-species detail/check sheets

Detail workbook sheets:

- `DETAIL_TREE_BIOMASS`
- `DETAIL_VOLUME`
- `DETAIL_IVI`
- `DETAIL_SEEDLING`
- `DETAIL_BAMBOO`
- `CHECK_UNMATCHED_SPECIES`
