from __future__ import annotations

import argparse
import json
from pathlib import Path

from forest_integration import (
    EcosystemUserInput,
    calculate_forest_valuation_bundle_from_outputs,
)
from forest_economic_report import write_forest_economic_report
from run_forest_calculation import process_workbook


def parse_component_area(value: str) -> tuple[str, float]:
    if "=" not in value:
        raise argparse.ArgumentTypeError("component area must use NAME=AREA_RAI format")
    name, area_text = value.split("=", 1)
    name = name.strip()
    if not name:
        raise argparse.ArgumentTypeError("component area name must not be empty")
    try:
        area_rai = float(area_text)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f"invalid component area: {value}") from exc
    return name, area_rai


def parse_ecosystem_input(value: str) -> EcosystemUserInput:
    parts = [part.strip() for part in value.split("|")]
    if len(parts) != 7:
        raise argparse.ArgumentTypeError(
            "ecosystem input must use COMPONENT|AREA_RAI|CANOPY_COVER|CANOPY_LAYERS|SOIL_DEPTH_M|RAINFALL_MM|TOPOGRAPHY_SCORE"
        )
    try:
        return EcosystemUserInput(
            component_name=parts[0],
            component_area_rai=float(parts[1]),
            canopy_cover_percent=float(parts[2]),
            canopy_layer_count=float(parts[3]),
            soil_depth_m=float(parts[4]),
            annual_rainfall_mm=float(parts[5]),
            topography_score=float(parts[6]),
        )
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f"invalid ecosystem input: {value}") from exc


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Example helper that runs biomass/IVI processing and then calculates forest economics, wood future value, regeneration loss, and ecosystem loss."
    )
    parser.add_argument("input_file", help="Path to the survey workbook")
    parser.add_argument("--master", required=True, help="Path to species_reference_master_v1.xlsx")
    parser.add_argument("--plot-area-ha", type=float, default=0.1, help="Plot area in hectares")
    parser.add_argument("--rai-per-hectare", type=float, default=6.25, help="Rai per hectare conversion factor")
    parser.add_argument(
        "--component-area",
        action="append",
        default=[],
        type=parse_component_area,
        metavar="NAME=AREA_RAI",
        help="Grouped component area for forest economics, repeatable",
    )
    parser.add_argument(
        "--ecosystem-input",
        action="append",
        default=[],
        type=parse_ecosystem_input,
        metavar="COMP|AREA|COVER|LAYERS|SOIL|RAIN|TOPO",
        help="Grouped component ecosystem input, repeatable",
    )
    parser.add_argument(
        "--json-out",
        default=None,
        help="Optional output path for the combined JSON result",
    )
    parser.add_argument(
        "--report-xlsx-out",
        default=None,
        help="Optional output path for the formatted Excel report workbook",
    )
    parser.add_argument(
        "--future-interest-rate",
        type=float,
        default=0.01,
        help="Discount/compound rate used by the wood future value module",
    )
    parser.add_argument(
        "--future-period",
        action="append",
        type=int,
        default=[],
        metavar="YEARS",
        help="Future value period in years, repeatable. Defaults to 1,10,20,30,40,50",
    )
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    outputs = process_workbook(
        input_file=Path(args.input_file),
        master_file=Path(args.master),
        plot_area_ha=args.plot_area_ha,
        rai_per_hectare=args.rai_per_hectare,
    )

    component_area_inputs = dict(args.component_area)
    ecosystem_user_inputs = list(args.ecosystem_input)

    bundle = calculate_forest_valuation_bundle_from_outputs(
        outputs=outputs,
        component_area_inputs=component_area_inputs,
        ecosystem_user_inputs=ecosystem_user_inputs,
        future_interest_rate=args.future_interest_rate,
        future_periods_years=args.future_period or None,
    )

    rendered = json.dumps(bundle, ensure_ascii=False, indent=2)
    if args.json_out:
        Path(args.json_out).write_text(rendered, encoding="utf-8")
    else:
        print(rendered)
    if args.report_xlsx_out:
        write_forest_economic_report(
            report_file=Path(args.report_xlsx_out),
            outputs=outputs,
            bundle=bundle,
        )


if __name__ == "__main__":
    main()
