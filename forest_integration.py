from __future__ import annotations

import math
from dataclasses import dataclass

import pandas as pd

from forest_ecosystem_loss import (
    EcosystemComponentInput,
    EcosystemLossResult,
    aggregate_ecosystem_group_results,
    calculate_basal_area_percent_from_ba_and_area,
    calculate_ecosystem_loss_for_component,
)
from forest_economics import Component, Plot, TQRecord, calculate_forest_economics
from forest_timber_pricing import timber_price_lookup
from wood_future_value import (
    DEFAULT_INTEREST_RATE,
    DEFAULT_PERIODS_YEARS,
    calculate_wood_future_value,
)


SAPLING_PRICE_BAHT_PER_TREE = 27.0
SEEDLING_PRICE_BAHT_PER_TREE = 6.0


@dataclass(frozen=True)
class EcosystemUserInput:
    component_name: str
    component_area_rai: float
    canopy_cover_percent: float
    canopy_layer_count: float
    soil_depth_m: float
    annual_rainfall_mm: float
    topography_score: float


def normalize_text(value: object) -> str:
    if value is None:
        return ""
    if pd.isna(value):
        return ""
    return str(value).strip()


def get_component_name_maps(outputs: dict[str, pd.DataFrame]) -> tuple[dict[str, str], dict[str, str]]:
    meta = outputs.get("__meta__", {})
    groups = meta.get("sheet_groups", []) if isinstance(meta, dict) else []
    internal_to_display: dict[str, str] = {}
    display_to_internal: dict[str, str] = {}
    for group in groups:
        internal_name = normalize_text(group.get("internal_name"))
        display_name = normalize_text(group.get("name"))
        if internal_name and display_name:
            internal_to_display[internal_name] = display_name
            display_to_internal[display_name] = internal_name
    return internal_to_display, display_to_internal


def get_component_area_lookup(
    component_area_inputs: dict[str, float],
    outputs: dict[str, pd.DataFrame],
) -> dict[str, float]:
    internal_to_display, display_to_internal = get_component_name_maps(outputs)
    lookup: dict[str, float] = {}
    for key, value in component_area_inputs.items():
        normalized_key = normalize_text(key)
        if not normalized_key:
            continue
        lookup[normalized_key] = float(value)
        internal_name = display_to_internal.get(normalized_key)
        if internal_name:
            lookup[internal_name] = float(value)
        display_name = internal_to_display.get(normalized_key)
        if display_name:
            lookup[display_name] = float(value)
    return lookup


def derive_tree_forest_type_map(outputs: dict[str, pd.DataFrame]) -> dict[tuple[str, int, str], str]:
    detail_tree = outputs.get("DETAIL_TREE_BIOMASS", pd.DataFrame())
    if detail_tree.empty:
        return {}
    mapping: dict[tuple[str, int, str], str] = {}
    for _, row in detail_tree.iterrows():
        key = (
            normalize_text(row.get("sheet_name")),
            int(row.get("row_no")),
            normalize_text(row.get("Plot")),
        )
        forest_type = normalize_text(row.get("forest_type_clean") or row.get("forest_type_raw"))
        if key[0] and forest_type:
            mapping[key] = forest_type
    return mapping


def build_forest_economics_components_from_outputs(
    outputs: dict[str, pd.DataFrame],
    component_area_inputs: dict[str, float],
    include_ungrouped_sheets: bool = False,
) -> tuple[list[Component], list[str]]:
    detail_volume = outputs.get("DETAIL_VOLUME", pd.DataFrame())
    if detail_volume.empty:
        return [], ["DETAIL_VOLUME is empty"]

    tree_volume = detail_volume[detail_volume["block_type"] == "Tree"].copy()
    if tree_volume.empty:
        return [], ["DETAIL_VOLUME has no Tree rows"]

    plot_area_ha = float(outputs.get("__meta__", {}).get("plot_area_ha", 0.0))
    rai_per_hectare = float(outputs.get("__meta__", {}).get("rai_per_hectare", 0.0))
    derived_plot_area_rai = plot_area_ha * rai_per_hectare
    if derived_plot_area_rai <= 0:
        return [], ["plot_area_ha or rai_per_hectare metadata is invalid"]

    component_area_lookup = get_component_area_lookup(component_area_inputs, outputs)
    internal_to_display, _ = get_component_name_maps(outputs)
    grouped_internal_names = set(internal_to_display.keys())
    if include_ungrouped_sheets:
        sheet_names = sorted(tree_volume["sheet_name"].dropna().astype(str).unique().tolist())
        component_keys = [name for name in sheet_names if name in grouped_internal_names or name not in grouped_internal_names]
    else:
        component_keys = [name for name in sorted(grouped_internal_names) if name in set(tree_volume["sheet_name"].astype(str))]

    forest_type_map = derive_tree_forest_type_map(outputs)
    warnings = [
        f"plot_area_rai derived uniformly from metadata: plot_area_ha={plot_area_ha} and rai_per_hectare={rai_per_hectare}"
    ]
    components: list[Component] = []

    for component_key in component_keys:
        component_area = component_area_lookup.get(component_key)
        display_name = internal_to_display.get(component_key, component_key)
        if component_area is None:
            warnings.append(f"{display_name}: missing component_area_rai input")
            continue

        component_rows = tree_volume[tree_volume["sheet_name"].astype(str) == component_key].copy()
        if component_rows.empty:
            warnings.append(f"{display_name}: no tree volume rows found")
            continue

        plot_records: dict[tuple[str, str], list[TQRecord]] = {}
        plot_forest_types: dict[tuple[str, str], str] = {}
        for _, row in component_rows.iterrows():
            plot_id = normalize_text(row.get("Plot"))
            if not plot_id:
                warnings.append(f"{display_name}: skipped row with missing plot id")
                continue
            row_no = int(row.get("row_no"))
            forest_type = forest_type_map.get((component_key, row_no, plot_id), "")
            if not forest_type:
                warnings.append(f"{display_name}: missing forest type for plot '{plot_id}', row {row_no}")
                continue
            tq = normalize_text(row.get("TQ"))
            if not tq:
                warnings.append(f"{display_name}: skipped row with missing TQ for plot '{plot_id}'")
                continue
            plot_key = (component_key, plot_id)
            plot_forest_types[plot_key] = forest_type
            plot_records.setdefault(plot_key, []).append(
                TQRecord(
                    tq=tq,
                    volume_m3=float(row.get("volume_m3") or 0.0),
                    species_name=normalize_text(row.get("thai_standard") or row.get("Species_norm") or row.get("Species_raw")) or None,
                    species_volume_m3=float(row.get("volume_m3") or 0.0),
                )
            )

        related_plots: list[Plot] = []
        for plot_key, tq_records in plot_records.items():
            related_plots.append(
                Plot(
                    plot_id=plot_key[1],
                    component_id=component_key,
                    plot_area_rai=derived_plot_area_rai,
                    forest_type=plot_forest_types.get(plot_key, ""),
                    tq_records=tq_records,
                )
            )

        components.append(
            Component(
                component_id=component_key,
                component_name=display_name,
                component_area_rai=float(component_area),
                component_area_m2=float(component_area) * 1600.0,
                component_area_ha=float(component_area) / rai_per_hectare if rai_per_hectare > 0 else None,
                related_plots=related_plots,
            )
        )

    return components, warnings


def build_ecosystem_inputs_from_outputs(
    outputs: dict[str, pd.DataFrame],
    component_user_inputs: list[EcosystemUserInput],
) -> tuple[dict[str, list[EcosystemComponentInput]], list[str]]:
    detail_tree = outputs.get("DETAIL_TREE_BIOMASS", pd.DataFrame())
    if detail_tree.empty:
        return {}, ["DETAIL_TREE_BIOMASS is empty"]

    internal_to_display, display_to_internal = get_component_name_maps(outputs)
    plot_area_ha = float(outputs.get("__meta__", {}).get("plot_area_ha", 0.0))
    rai_per_hectare = float(outputs.get("__meta__", {}).get("rai_per_hectare", 0.0))
    plot_area_m2 = plot_area_ha * 10000.0
    plot_area_rai = plot_area_ha * rai_per_hectare
    warnings = [
        f"ecosystem sample plot area derived uniformly from metadata: plot_area_ha={plot_area_ha} and rai_per_hectare={rai_per_hectare}"
    ]
    grouped_internal_names = set(internal_to_display.keys())
    lookup: dict[str, EcosystemUserInput] = {}
    for item in component_user_inputs:
        internal_name = display_to_internal.get(item.component_name, item.component_name)
        if internal_name not in grouped_internal_names:
            warnings.append(f"ecosystem_loss ignores non-grouped component input '{item.component_name}'")
            continue
        lookup[internal_name] = item

    grouped: dict[str, list[EcosystemComponentInput]] = {}
    for component_key, spec in lookup.items():
        rows = detail_tree[detail_tree["sheet_name"].astype(str) == component_key].copy()
        if rows.empty:
            continue
        rows["forest_type"] = rows["forest_type_clean"].fillna("").astype(str)
        component_rows: list[EcosystemComponentInput] = []
        for forest_type, group in rows.groupby("forest_type", dropna=False):
            forest_label = normalize_text(forest_type)
            if not forest_label:
                warnings.append(f"{spec.component_name}: encountered blank forest_type in ecosystem input builder")
                continue
            dbh_m = pd.to_numeric(group["DBH_cm"], errors="coerce") / 100.0
            ba_m2_total = float((math.pi * (dbh_m.pow(2)) / 4.0).fillna(0).sum())
            n_plots = group["Plot"].astype(str).str.strip().replace("", pd.NA).dropna().nunique()
            if n_plots <= 0:
                warnings.append(f"{spec.component_name}: no valid plots for forest_type '{forest_label}'")
                continue
            sample_area_m2 = n_plots * plot_area_m2
            representative_area_rai = n_plots * plot_area_rai
            basal_area_percent = calculate_basal_area_percent_from_ba_and_area(ba_m2_total, sample_area_m2)
            component_rows.append(
                EcosystemComponentInput(
                    component_id=component_key,
                    component_name=internal_to_display.get(component_key, spec.component_name),
                    forest_type=forest_label,
                    component_area_rai=spec.component_area_rai,
                    representative_area_rai=representative_area_rai,
                    sample_plot_area_rai=representative_area_rai,
                    canopy_cover_percent=spec.canopy_cover_percent,
                    canopy_layer_count=spec.canopy_layer_count,
                    soil_depth_m=spec.soil_depth_m,
                    annual_rainfall_mm=spec.annual_rainfall_mm,
                    topography_score=spec.topography_score,
                    basal_area_percent=basal_area_percent,
                )
            )
        if component_rows:
            grouped[component_key] = component_rows
    return grouped, warnings


def calculate_ecosystem_loss_from_outputs(
    outputs: dict[str, pd.DataFrame],
    component_user_inputs: list[EcosystemUserInput],
) -> tuple[list[EcosystemLossResult], list[dict[str, object]], list[str]]:
    grouped_inputs, warnings = build_ecosystem_inputs_from_outputs(outputs, component_user_inputs)
    group_results: list[EcosystemLossResult] = []
    component_summaries: list[dict[str, object]] = []

    for component_key, component_inputs in grouped_inputs.items():
        per_group_results = [calculate_ecosystem_loss_for_component(item) for item in component_inputs]
        group_results.extend(per_group_results)
        weighted_total, aggregation_warnings = aggregate_ecosystem_group_results(per_group_results)
        warnings.extend(aggregation_warnings)
        first = per_group_results[0]
        component_summaries.append(
            {
                "component_id": component_key,
                "component_name": first.component_name,
                "component_area_rai": first.component_area_rai,
                "forest_types_detected": [row.forest_type for row in per_group_results],
                "total_ecosystem_loss_baht_per_rai_per_year": weighted_total,
                "total_ecosystem_loss_baht_per_year": (
                    weighted_total * first.component_area_rai if first.component_area_rai is not None else None
                ),
                "warnings": [warning for row in per_group_results for warning in row.warnings] + aggregation_warnings,
            }
        )
    return group_results, component_summaries, warnings


def calculate_forest_economics_from_outputs(
    outputs: dict[str, pd.DataFrame],
    component_area_inputs: dict[str, float],
    price_lookup=timber_price_lookup,
):
    components, warnings = build_forest_economics_components_from_outputs(
        outputs=outputs,
        component_area_inputs=component_area_inputs,
        include_ungrouped_sheets=False,
    )
    result = calculate_forest_economics(components, price_lookup=price_lookup)
    merged = result.to_dict()
    merged["warnings"] = warnings + result.warnings
    return merged


def calculate_regeneration_loss_from_outputs(
    outputs: dict[str, pd.DataFrame],
    component_area_inputs: dict[str, float],
) -> dict[str, object]:
    summary_all = outputs.get("SUMMARY_ALL", pd.DataFrame())
    if summary_all.empty:
        return {
            "componentSummaries": [],
            "grandTotal": {
                "sapling_loss_baht": 0.0,
                "seedling_loss_baht": 0.0,
                "total_regeneration_loss_baht": 0.0,
            },
            "warnings": ["SUMMARY_ALL is empty"],
        }

    internal_to_display, _ = get_component_name_maps(outputs)
    grouped_internal_names = set(internal_to_display.keys())
    component_area_lookup = get_component_area_lookup(component_area_inputs, outputs)
    component_summaries: list[dict[str, object]] = []
    warnings: list[str] = []

    for component_key in sorted(grouped_internal_names):
        display_name = internal_to_display.get(component_key, component_key)
        rows = summary_all[summary_all["sheet_name"].astype(str) == component_key]
        if rows.empty:
            warnings.append(f"{display_name}: SUMMARY_ALL has no grouped row for regeneration loss")
            continue
        row = rows.iloc[0]
        sapling_per_rai = pd.to_numeric(pd.Series([row.get("sapling_per_rai")]), errors="coerce").iloc[0]
        seedling_per_rai = pd.to_numeric(pd.Series([row.get("seedling_per_rai")]), errors="coerce").iloc[0]
        sapling_density = 0.0 if pd.isna(sapling_per_rai) else float(sapling_per_rai)
        seedling_density = 0.0 if pd.isna(seedling_per_rai) else float(seedling_per_rai)
        sapling_loss = sapling_density * SAPLING_PRICE_BAHT_PER_TREE
        seedling_loss = seedling_density * SEEDLING_PRICE_BAHT_PER_TREE
        component_summaries.append(
            {
                "component_id": component_key,
                "component_name": display_name,
                "sapling_density_per_rai": sapling_density,
                "seedling_density_per_rai": seedling_density,
                "sapling_price_baht_per_tree": SAPLING_PRICE_BAHT_PER_TREE,
                "seedling_price_baht_per_tree": SEEDLING_PRICE_BAHT_PER_TREE,
                "sapling_loss_baht": sapling_loss,
                "seedling_loss_baht": seedling_loss,
                "total_regeneration_loss_baht": sapling_loss + seedling_loss,
            }
        )

    grand_total = {
        "sapling_loss_baht": sum(item["sapling_loss_baht"] for item in component_summaries),
        "seedling_loss_baht": sum(item["seedling_loss_baht"] for item in component_summaries),
        "total_regeneration_loss_baht": sum(item["total_regeneration_loss_baht"] for item in component_summaries),
    }
    return {
        "componentSummaries": component_summaries,
        "grandTotal": grand_total,
        "warnings": warnings,
    }


def calculate_wood_future_value_from_forest_economics(
    forest_economics_result: dict[str, object],
    interest_rate: float = DEFAULT_INTEREST_RATE,
    periods_years: list[int] | None = None,
) -> dict[str, object]:
    grand_total = forest_economics_result.get("grandTotal", {})
    component_summaries = forest_economics_result.get("componentSummaries", [])
    annual_wood_value = grand_total.get("total_annual_wood_value_baht") if isinstance(grand_total, dict) else None
    component_annual_values = []
    for item in component_summaries if isinstance(component_summaries, list) else []:
        if not isinstance(item, dict):
            continue
        component_annual_values.append(
            {
                "component_id": item.get("component_id"),
                "component_name": item.get("component_name"),
                "annual_wood_value_baht": item.get("total_annual_wood_value_baht"),
            }
        )
    result = calculate_wood_future_value(
        annual_wood_value_baht=annual_wood_value,
        interest_rate=interest_rate,
        periods_years=periods_years or DEFAULT_PERIODS_YEARS,
        component_annual_values=component_annual_values,
    )
    return result.to_dict()


def calculate_forest_valuation_bundle_from_outputs(
    outputs: dict[str, pd.DataFrame],
    component_area_inputs: dict[str, float],
    ecosystem_user_inputs: list[EcosystemUserInput],
    price_lookup=timber_price_lookup,
    future_interest_rate: float = DEFAULT_INTEREST_RATE,
    future_periods_years: list[int] | None = None,
) -> dict[str, object]:
    forest_economics_result = calculate_forest_economics_from_outputs(
        outputs=outputs,
        component_area_inputs=component_area_inputs,
        price_lookup=price_lookup,
    )
    wood_future_value_result = calculate_wood_future_value_from_forest_economics(
        forest_economics_result=forest_economics_result,
        interest_rate=future_interest_rate,
        periods_years=future_periods_years,
    )
    regeneration_loss_result = calculate_regeneration_loss_from_outputs(
        outputs=outputs,
        component_area_inputs=component_area_inputs,
    )
    ecosystem_group_results, ecosystem_component_summaries, ecosystem_warnings = calculate_ecosystem_loss_from_outputs(
        outputs=outputs,
        component_user_inputs=ecosystem_user_inputs,
    )
    return {
        "forest_economics": forest_economics_result,
        "wood_future_value": wood_future_value_result,
        "regeneration_loss": regeneration_loss_result,
        "ecosystem_loss": {
            "groupResults": [row.to_dict() for row in ecosystem_group_results],
            "componentSummaries": ecosystem_component_summaries,
            "warnings": ecosystem_warnings,
        },
        "warnings": (
            forest_economics_result["warnings"]
            + wood_future_value_result["warnings"]
            + regeneration_loss_result["warnings"]
            + ecosystem_warnings
        ),
    }
