from __future__ import annotations

import base64
import copy
import hashlib
import json
import logging
import os
import sys
import tempfile
import threading
import time
from collections import OrderedDict
from io import BytesIO
from pathlib import Path
from typing import Any
from zipfile import ZIP_DEFLATED, ZipFile

import numpy as np
import pandas as pd
from fastapi.encoders import jsonable_encoder
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.responses import FileResponse
from openpyxl import load_workbook
from pydantic import BaseModel

ROOT_DIR = Path(__file__).resolve().parents[3]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))
WORKSPACE_DIR = ROOT_DIR if (ROOT_DIR / "cal_EIA").exists() else ROOT_DIR.parent

import run_forest_calculation as calc
from cal_EIA.generate_profile_realistic import render_freeform_sprite_experiment
PROFILE_SCRIPT_DIR = WORKSPACE_DIR / "cal_EIA" / "05_profile_scripts"
if not PROFILE_SCRIPT_DIR.exists():
    PROFILE_SCRIPT_DIR = WORKSPACE_DIR / "cal_EIA"
if str(PROFILE_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(PROFILE_SCRIPT_DIR))
from profile_diagram_lib import (
    audit_profile_sheet,
    create_profile_template,
    list_profile_sheets,
    render_workbook_profile_map,
)
from forest_economic_report import (
    ECOSYSTEM_TOTAL_KEYS,
    _estimated_tree_count_from_density,
    _sum_ecosystem_detail,
    write_forest_economic_report,
)
from forest_ecosystem_loss import build_ecosystem_loss_detail_rows
from forest_integration import EcosystemUserInput, calculate_forest_valuation_bundle_from_outputs

TEMPLATE_FILE = ROOT_DIR / "template.xlsx"
MASTER_FILE = ROOT_DIR / "species_reference_master_v1.xlsx"
COMPONENT_TEMPLATE_FILE = ROOT_DIR / "forest_component_7.xlsx"
PROFILE_SOURCE_FILE = ROOT_DIR / "cal_EIA" / "profile.xlsx"
PROFILE_TEMPLATE_FILE = ROOT_DIR / "cal_EIA" / "profile_template.xlsx"
OUTPUT_BASE_FILENAME = "forest_calculation_output.xlsx"
SUMMARY_OUTPUT_FILENAME = "forest_calculation_output_summary_by_site.xlsx"
DETAIL_OUTPUT_FILENAME = "forest_calculation_output_details.xlsx"
COMPONENT_OUTPUT_FILENAME = "forest_component_summary.xlsx"
PROFILE_OUTPUT_FILENAME = "profile_diagram_outputs.zip"
PROFILE_REALISTIC_OUTPUT_FILENAME = "profile_diagram_realistic_outputs.zip"
ECONOMIC_OUTPUT_FILENAME = "forest_economic_report.xlsx"
ECONOMIC_JSON_FILENAME = "forest_economic_report.json"
WORKFLOW_CACHE_TTL_SECONDS = int(os.getenv("WORKFLOW_CACHE_TTL_SECONDS", "3600"))
WORKFLOW_CACHE_MAX_ENTRIES = int(os.getenv("WORKFLOW_CACHE_MAX_ENTRIES", "8"))
LOG = logging.getLogger(__name__)

WorkflowCacheValue = tuple[bytes, bytes, bytes | None, dict[str, pd.DataFrame]]
WORKFLOW_CACHE: OrderedDict[str, tuple[float, WorkflowCacheValue]] = OrderedDict()
WORKFLOW_CACHE_LOCK = threading.RLock()


def parse_cors_origins() -> list[str]:
    raw_value = os.getenv("CORS_ORIGINS", "*").strip()
    if not raw_value or raw_value == "*":
        return ["*"]
    return [origin.strip() for origin in raw_value.split(",") if origin.strip()]


class MetricCard(BaseModel):
    label: str
    value: str
    help_text: str


def normalize_text(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and pd.isna(value):
        return ""
    return str(value).strip()


def format_metric_value(value: object, decimals: int = 2) -> str:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return "-"
    if isinstance(value, (int, float)):
        return f"{value:,.{decimals}f}" if isinstance(value, float) or decimals else f"{int(value):,}"
    return str(value)


def sanitize_for_json(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): sanitize_for_json(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [sanitize_for_json(item) for item in value]
    if isinstance(value, pd.Timestamp):
        return value.isoformat()
    if isinstance(value, np.generic):
        return sanitize_for_json(value.item())
    return value


def canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def build_workflow_cache_key(
    file_bytes: bytes,
    plot_area_ha: float,
    rai_per_hectare: float,
    sheet_groups: list[dict[str, object]] | None,
) -> str:
    fingerprint = {
        "file_sha256": hashlib.sha256(file_bytes).hexdigest(),
        "plot_area_ha": float(plot_area_ha),
        "rai_per_hectare": float(rai_per_hectare),
        "sheet_groups": sheet_groups or [],
    }
    return hashlib.sha256(canonical_json(fingerprint).encode("utf-8")).hexdigest()


def copy_result_sheets(result_sheets: dict[str, Any]) -> dict[str, Any]:
    copied: dict[str, Any] = {}
    for sheet_name, frame in result_sheets.items():
        if isinstance(frame, pd.DataFrame):
            copied[sheet_name] = frame.copy(deep=True)
        else:
            copied[sheet_name] = copy.deepcopy(frame)
    return copied


def copy_workflow_cache_value(value: WorkflowCacheValue) -> WorkflowCacheValue:
    summary_bytes, detail_bytes, component_bytes, result_sheets = value
    return summary_bytes, detail_bytes, component_bytes, copy_result_sheets(result_sheets)


def get_cached_workflow(cache_key: str) -> WorkflowCacheValue | None:
    if WORKFLOW_CACHE_TTL_SECONDS <= 0 or WORKFLOW_CACHE_MAX_ENTRIES <= 0:
        return None
    now = time.monotonic()
    with WORKFLOW_CACHE_LOCK:
        cached = WORKFLOW_CACHE.get(cache_key)
        if cached is None:
            return None
        created_at, value = cached
        if now - created_at > WORKFLOW_CACHE_TTL_SECONDS:
            WORKFLOW_CACHE.pop(cache_key, None)
            return None
        WORKFLOW_CACHE.move_to_end(cache_key)
        return copy_workflow_cache_value(value)


def store_cached_workflow(cache_key: str, value: WorkflowCacheValue) -> None:
    if WORKFLOW_CACHE_TTL_SECONDS <= 0 or WORKFLOW_CACHE_MAX_ENTRIES <= 0:
        return
    with WORKFLOW_CACHE_LOCK:
        WORKFLOW_CACHE[cache_key] = (time.monotonic(), copy_workflow_cache_value(value))
        WORKFLOW_CACHE.move_to_end(cache_key)
        while len(WORKFLOW_CACHE) > WORKFLOW_CACHE_MAX_ENTRIES:
            WORKFLOW_CACHE.popitem(last=False)


def filter_primary_rows(frame: pd.DataFrame, result_sheets: dict[str, pd.DataFrame]) -> pd.DataFrame:
    if frame.empty:
        return frame
    component_names = calc.get_component_sheet_names(result_sheets)
    return calc.filter_out_component_rows(frame, component_names)


def count_unmatched_species(unmatched: pd.DataFrame) -> int:
    if unmatched.empty:
        return 0

    for column_name in ("Species_norm", "Species_raw"):
        if column_name in unmatched.columns:
            series = unmatched[column_name].astype(str).str.strip().replace("", pd.NA).dropna()
            if not series.empty:
                return int(series.nunique())

    return int(len(unmatched.index))


def get_numeric_series(frame: pd.DataFrame, column_name: str) -> pd.Series:
    if frame.empty or column_name not in frame.columns:
        return pd.Series(dtype=float)
    return pd.to_numeric(frame[column_name], errors="coerce").fillna(0)


def build_metrics(
    summary_all: pd.DataFrame,
    unmatched: pd.DataFrame,
    result_sheets: dict[str, pd.DataFrame],
) -> list[MetricCard]:
    if summary_all.empty:
        return []

    filtered_summary = filter_primary_rows(summary_all, result_sheets)
    filtered_unmatched = filter_primary_rows(unmatched, result_sheets)
    if filtered_summary.empty:
        return []

    total_tree = get_numeric_series(filtered_summary, "n_tree").sum()
    total_sapling = get_numeric_series(filtered_summary, "n_sapling").sum()
    total_tree_biomass = get_numeric_series(filtered_summary, "total_tree_biomass").sum()
    total_tree_volume = get_numeric_series(filtered_summary, "total_tree_volume_m3").sum()
    total_sapling_volume = get_numeric_series(filtered_summary, "total_sapling_volume_m3").sum()

    shannon_series = get_numeric_series(filtered_summary, "shannon_index")
    shannon_value = shannon_series.mean() if not shannon_series.empty else None
    unmatched_count = count_unmatched_species(filtered_unmatched)

    return [
        MetricCard(label="Total tree count", value=format_metric_value(total_tree, 0), help_text="Across all processed worksheets"),
        MetricCard(label="Total sapling count", value=format_metric_value(total_sapling, 0), help_text="Sapling records included in volume"),
        MetricCard(label="Total tree biomass", value=format_metric_value(total_tree_biomass, 2), help_text="Tree biomass only"),
        MetricCard(label="Total tree volume", value=format_metric_value(total_tree_volume, 3), help_text="Tree block volume"),
        MetricCard(label="Total sapling volume", value=format_metric_value(total_sapling_volume, 3), help_text="Sapling block volume"),
        MetricCard(label="Shannon index", value=format_metric_value(shannon_value, 6), help_text="Average across available sites"),
        MetricCard(label="Unmatched species", value=format_metric_value(unmatched_count, 0), help_text="Unique unmatched species still reviewed in the QA sheet"),
    ]


def dataframe_records(frame: pd.DataFrame, limit: int = 250) -> list[dict[str, Any]]:
    if frame.empty:
        return []
    sample = frame.head(limit).copy()
    sample = sample.where(pd.notna(sample), None)
    return jsonable_encoder(sanitize_for_json(sample.to_dict(orient="records")))


def build_biomass_payload(
    result_sheets: dict[str, pd.DataFrame],
    plot_area_ha: float,
    rai_per_hectare: float,
    sheet_groups: list[dict[str, object]] | None,
) -> dict[str, Any]:
    summary_all = result_sheets.get("SUMMARY_ALL", pd.DataFrame())
    summary_biomass = result_sheets.get("SUMMARY_BIOMASS", pd.DataFrame())
    summary_volume = result_sheets.get("SUMMARY_VOLUME", pd.DataFrame())
    summary_shannon = result_sheets.get("SUMMARY_SHANNON", pd.DataFrame())
    unmatched = result_sheets.get("CHECK_UNMATCHED_SPECIES", pd.DataFrame())

    try:
        metrics = [metric.model_dump() for metric in build_metrics(summary_all, unmatched, result_sheets)]
    except Exception:  # noqa: BLE001
        LOG.exception("Failed to build biomass metrics.")
        metrics = []

    try:
        component_summaries = build_component_biomass_summary(
            result_sheets=result_sheets,
            sheet_groups=sheet_groups,
            plot_area_ha=plot_area_ha,
            rai_per_hectare=rai_per_hectare,
        )
    except Exception:  # noqa: BLE001
        LOG.exception("Failed to build biomass component summaries.")
        component_summaries = []

    previews: dict[str, list[dict[str, Any]]] = {}
    preview_frames = {
        "summaryAll": summary_all,
        "summaryBiomass": summary_biomass,
        "summaryVolume": summary_volume,
        "summaryShannon": summary_shannon,
        "unmatchedSpecies": unmatched,
    }
    for preview_key, frame in preview_frames.items():
        try:
            previews[preview_key] = dataframe_records(frame)
        except Exception:  # noqa: BLE001
            LOG.exception("Failed to serialize biomass preview '%s'.", preview_key)
            previews[preview_key] = []

    return {
        "metrics": metrics,
        "componentSummaries": component_summaries,
        "previews": previews,
    }


def serialize_download_payload(filename: str, content: bytes) -> dict[str, str]:
    return {
        "filename": filename,
        "contentBase64": base64.b64encode(content).decode("ascii"),
    }


def get_uploaded_sheet_names(file_bytes: bytes) -> list[str]:
    workbook = load_workbook(filename=BytesIO(file_bytes), read_only=True, data_only=True)
    try:
        return list(workbook.sheetnames)
    finally:
        workbook.close()


def ensure_profile_template() -> Path:
    if not PROFILE_SOURCE_FILE.exists():
        raise HTTPException(status_code=500, detail="Profile source workbook is missing.")
    if not PROFILE_TEMPLATE_FILE.exists():
        create_profile_template(PROFILE_SOURCE_FILE, PROFILE_TEMPLATE_FILE)
    return PROFILE_TEMPLATE_FILE


def build_profile_outputs(
    uploaded_filename: str,
    file_bytes: bytes,
    render_mode: str,
) -> tuple[list[dict[str, str]], bytes, str, list[dict[str, object]]]:
    with tempfile.TemporaryDirectory() as tmp_dir:
        temp_dir = Path(tmp_dir)
        uploaded_path = temp_dir / uploaded_filename
        uploaded_path.write_bytes(file_bytes)

        output_dir = temp_dir / "profile_images"
        sheet_names = list_profile_sheets(uploaded_path)
        # Validate every named tree before drawing any output. This prevents a
        # malformed row from being silently excluded from a generated profile.
        validation = [audit_profile_sheet(uploaded_path, sheet_name) for sheet_name in sheet_names]
        if render_mode == "realistic":
            rendered_items = [
                (sheet_name, render_freeform_sprite_experiment(uploaded_path, sheet_name, output_dir))
                for sheet_name in sheet_names
            ]
            output_filename = PROFILE_REALISTIC_OUTPUT_FILENAME
        else:
            rendered_items = render_workbook_profile_map(uploaded_path, output_dir)
            output_filename = PROFILE_OUTPUT_FILENAME
        payloads: list[dict[str, str]] = []
        image_paths: list[Path] = []
        for sheet_name, image_path in rendered_items:
            image_paths.append(image_path)
            payloads.append(
                {
                    "sheetName": sheet_name,
                    "filename": image_path.name,
                    "contentBase64": base64.b64encode(image_path.read_bytes()).decode("ascii"),
                }
            )

        zip_path = temp_dir / output_filename
        with ZipFile(zip_path, "w", compression=ZIP_DEFLATED) as zip_file:
            for image_path in image_paths:
                zip_file.write(image_path, arcname=image_path.name)
        return payloads, zip_path.read_bytes(), output_filename, validation


def parse_sheet_groups(sheet_groups_raw: str | None) -> list[dict[str, object]] | None:
    if not sheet_groups_raw:
        return None
    try:
        parsed = json.loads(sheet_groups_raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid sheet_groups JSON: {exc}") from exc
    if not isinstance(parsed, list):
        raise HTTPException(status_code=400, detail="sheet_groups must be a JSON array.")
    return parsed


def parse_future_periods(raw_value: str | None) -> list[int] | None:
    if not raw_value:
        return None
    try:
        parsed = json.loads(raw_value)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid future_periods JSON: {exc}") from exc
    if not isinstance(parsed, list) or not all(isinstance(item, int) for item in parsed):
        raise HTTPException(status_code=400, detail="future_periods must be a JSON array of integers.")
    return parsed


def parse_economic_inputs(
    economic_inputs_raw: str | None,
    sheet_groups: list[dict[str, object]] | None,
) -> tuple[dict[str, float], list[EcosystemUserInput]]:
    if not economic_inputs_raw:
        return {}, []
    try:
        parsed = json.loads(economic_inputs_raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid economic_inputs JSON: {exc}") from exc
    if not isinstance(parsed, list):
        raise HTTPException(status_code=400, detail="economic_inputs must be a JSON array.")

    component_area_inputs: dict[str, float] = {}
    ecosystem_inputs: list[EcosystemUserInput] = []
    group_names = {normalize_text(group.get("name")) for group in sheet_groups or [] if normalize_text(group.get("name"))}
    for item in parsed:
        if not isinstance(item, dict):
            raise HTTPException(status_code=400, detail="Each economic input must be an object.")
        component_name = normalize_text(item.get("component_name"))
        if not component_name:
            raise HTTPException(status_code=400, detail="Each economic input must include component_name.")
        if group_names and component_name not in group_names:
            raise HTTPException(status_code=400, detail=f"Economic input component '{component_name}' is not in grouped components.")
        try:
            component_area_rai = float(item.get("component_area_rai"))
            canopy_cover_percent = float(item.get("canopy_cover_percent"))
            canopy_layer_count = float(item.get("canopy_layer_count"))
            soil_depth_m = float(item.get("soil_depth_m"))
            annual_rainfall_mm = float(item.get("annual_rainfall_mm"))
            topography_score = float(item.get("topography_score"))
        except (TypeError, ValueError) as exc:
            raise HTTPException(status_code=400, detail=f"Invalid numeric economic input for component '{component_name}'.") from exc
        if component_area_rai <= 0 or not 0 <= canopy_cover_percent <= 100 or canopy_layer_count <= 0 or soil_depth_m <= 0 or annual_rainfall_mm < 0 or topography_score <= 0:
            raise HTTPException(status_code=400, detail=f"Economic input values are out of range for component '{component_name}'.")
        component_area_inputs[component_name] = component_area_rai
        ecosystem_inputs.append(
            EcosystemUserInput(
                component_name=component_name,
                component_area_rai=component_area_rai,
                canopy_cover_percent=canopy_cover_percent,
                canopy_layer_count=canopy_layer_count,
                soil_depth_m=soil_depth_m,
                annual_rainfall_mm=annual_rainfall_mm,
                topography_score=topography_score,
            )
        )

    missing_groups = sorted(group_names - set(component_area_inputs.keys()))
    if missing_groups:
        raise HTTPException(
            status_code=400,
            detail=f"Missing economic inputs for grouped component(s): {', '.join(missing_groups)}",
        )
    return component_area_inputs, ecosystem_inputs


def build_component_biomass_summary(
    result_sheets: dict[str, pd.DataFrame],
    sheet_groups: list[dict[str, object]] | None,
    plot_area_ha: float,
    rai_per_hectare: float,
) -> list[dict[str, Any]]:
    summary_all = result_sheets.get("SUMMARY_ALL", pd.DataFrame())
    detail_tree = result_sheets.get("DETAIL_TREE_BIOMASS", pd.DataFrame())
    if summary_all.empty or "sheet_name" not in summary_all.columns:
        return []
    component_display_map = calc.get_component_display_name_map(result_sheets)
    component_names = calc.get_component_group_names_in_order(result_sheets)
    if sheet_groups:
        ordered_names = component_names
    else:
        ordered_names = filter_primary_rows(summary_all, result_sheets).get("sheet_name", pd.Series(dtype=object)).dropna().astype(str).tolist()

    rows: list[dict[str, Any]] = []
    for component_name in ordered_names:
        matching_summary = summary_all[summary_all["sheet_name"].astype(str) == component_name]
        if matching_summary.empty:
            continue
        summary_row = matching_summary.iloc[0]
        matching_tree = detail_tree[detail_tree["sheet_name"].astype(str) == component_name] if not detail_tree.empty else pd.DataFrame()
        forest_types = sorted(
            {
                normalize_text(value)
                for value in matching_tree.get("forest_type_clean", pd.Series(dtype=object)).dropna().tolist()
                if normalize_text(value)
            }
        )
        plot_count = (
            matching_tree["Plot"].astype(str).str.strip().replace("", pd.NA).dropna().nunique()
            if not matching_tree.empty and "Plot" in matching_tree.columns
            else 0
        )
        rows.append(
            {
                "componentName": component_display_map.get(component_name, component_name),
                "internalName": component_name,
                "includedSheets": next(
                    (
                        [normalize_text(sheet_name) for sheet_name in group.get("sheet_names", []) if normalize_text(sheet_name)]
                        for group in sheet_groups or []
                        if normalize_text(group.get("internal_name")) == component_name or normalize_text(group.get("name")) == component_display_map.get(component_name, component_name)
                    ),
                    [component_name],
                ),
                "forestTypes": forest_types,
                "plotCount": plot_count,
                "sampleAreaRai": plot_count * plot_area_ha * rai_per_hectare if plot_count else None,
                "totalBiomass": summary_row.get("total_tree_biomass"),
                "totalWoodVolume": summary_row.get("total_tree_volume_m3"),
                "treeCount": summary_row.get("n_tree"),
                "saplingCount": summary_row.get("n_sapling"),
                "shannonIndex": summary_row.get("shannon_index"),
            }
        )
    return rows


def build_economic_preview(bundle: dict[str, object], outputs: dict[str, pd.DataFrame]) -> dict[str, Any]:
    component_rows: list[dict[str, Any]] = []
    ecosystem_component_lookup = {
        normalize_text(row.get("component_id")): row
        for row in bundle.get("ecosystem_loss", {}).get("componentSummaries", [])
        if normalize_text(row.get("component_id"))
    }
    regeneration_lookup = {
        normalize_text(row.get("component_id")): row
        for row in bundle.get("regeneration_loss", {}).get("componentSummaries", [])
        if normalize_text(row.get("component_id"))
    }
    for row in bundle.get("forest_economics", {}).get("componentSummaries", []):
        component_id = normalize_text(row.get("component_id"))
        eco_row = ecosystem_component_lookup.get(component_id, {})
        regen_row = regeneration_lookup.get(component_id, {})
        report_ecosystem_total = sum(
            float(value)
            for value in (_sum_ecosystem_detail(bundle, component_id, impact_key) for impact_key in ECOSYSTEM_TOTAL_KEYS)
            if isinstance(value, (int, float))
        )
        report_total_loss_values = [
            row.get("total_wood_value_baht"),
            regen_row.get("sapling_loss_baht"),
            regen_row.get("seedling_loss_baht"),
            report_ecosystem_total,
        ]
        report_total_loss = sum(float(value) for value in report_total_loss_values if isinstance(value, (int, float)))
        component_rows.append(
            {
                "componentId": component_id,
                "componentName": row.get("component_name"),
                "componentAreaRai": row.get("component_area_rai"),
                "estimatedTreeCount": _estimated_tree_count_from_density(outputs, component_id, row.get("component_area_rai")),
                "estimatedSaplingCount": regen_row.get("sapling_estimated_count"),
                "estimatedSeedlingCount": regen_row.get("seedling_estimated_count"),
                "forestTypes": row.get("forest_types_detected", []),
                "tqs": row.get("tq_detected", []),
                "totalWoodLossM3": row.get("total_wood_loss_m3"),
                "totalAnnualIncrementM3PerYear": row.get("total_annual_increment_m3_per_year"),
                "totalAnnualWoodValueBaht": row.get("total_annual_wood_value_baht"),
                "totalWoodValueBaht": row.get("total_wood_value_baht"),
                "totalRegenerationLossBaht": regen_row.get("total_regeneration_loss_baht"),
                "totalEcosystemLossBahtPerYear": report_ecosystem_total,
                "moduleEcosystemLossBahtPerYear": eco_row.get("total_ecosystem_loss_baht_per_year"),
                "totalReportLossBaht": report_total_loss,
                "warnings": row.get("warnings", []),
            }
        )

    impact_rows: list[dict[str, Any]] = []
    for row in bundle.get("ecosystem_loss", {}).get("groupResults", []):
        proxy = type("EcosystemProxy", (), row)
        for detail in build_ecosystem_loss_detail_rows(proxy):
            impact_rows.append(
                {
                    "componentId": row.get("component_id"),
                    "componentName": row.get("component_name"),
                    "forestType": row.get("forest_type"),
                    "impactKey": detail.get("impact_key"),
                    "impactNameTh": detail.get("impact_name_th"),
                    "quantity": detail.get("quantity"),
                    "quantityUnit": detail.get("quantity_unit"),
                    "unitPrice": detail.get("unit_price"),
                    "unitPriceUnit": detail.get("unit_price_unit"),
                    "valueBahtPerRaiPerYear": detail.get("value_baht_per_rai_per_year"),
                }
            )

    grand_total = bundle.get("forest_economics", {}).get("grandTotal", {})
    economic_metrics = [
        MetricCard(label="Economic components", value=format_metric_value(len(component_rows), 0), help_text="Grouped components included in the economic run"),
        MetricCard(label="Total wood loss", value=format_metric_value(grand_total.get("total_wood_loss_m3"), 3), help_text="Combined wood stock loss across grouped components"),
        MetricCard(
            label="Total loss in report",
            value=format_metric_value(
                sum(
                    float(row.get("totalReportLossBaht"))
                    for row in component_rows
                    if isinstance(row.get("totalReportLossBaht"), (int, float))
                ),
                2,
            ),
            help_text="Matches the MASTER_SUMMARY total row after scaling survey density and TQ volume per rai to project area",
        ),
        MetricCard(
            label="Ecosystem loss / year",
            value=format_metric_value(
                sum(
                    float(row.get("totalEcosystemLossBahtPerYear"))
                    for row in component_rows
                    if isinstance(row.get("totalEcosystemLossBahtPerYear"), (int, float))
                ),
                2,
            ),
            help_text="Sum of ecosystem loss totals from all grouped components",
        ),
    ]

    return {
        "metrics": [metric.model_dump() for metric in economic_metrics],
        "componentSummaries": component_rows,
        "woodDetails": bundle.get("forest_economics", {}).get("detailRows", []),
        "ecosystemSummaries": bundle.get("ecosystem_loss", {}).get("componentSummaries", []),
        "ecosystemImpactDetails": impact_rows,
        "futureValueRows": bundle.get("wood_future_value", {}).get("periodRows", []),
        "warnings": bundle.get("warnings", []),
    }


def run_uploaded_workflow(
    uploaded_filename: str,
    file_bytes: bytes,
    plot_area_ha: float,
    rai_per_hectare: float,
    sheet_groups: list[dict[str, object]] | None = None,
) -> tuple[bytes, bytes, bytes | None, dict[str, pd.DataFrame]]:
    with tempfile.TemporaryDirectory() as tmp_dir:
        temp_dir = Path(tmp_dir)
        uploaded_path = temp_dir / uploaded_filename
        uploaded_path.write_bytes(file_bytes)

        output_base = temp_dir / OUTPUT_BASE_FILENAME
        split_runner = getattr(calc, "run_calculation_split_outputs", None)
        if split_runner is not None:
            summary_path, detail_path, result_sheets = split_runner(
                input_file=uploaded_path,
                master_file=MASTER_FILE,
                output_base=output_base,
                plot_area_ha=plot_area_ha,
                rai_per_hectare=rai_per_hectare,
                sheet_groups=sheet_groups,
            )
        else:
            result_sheets = calc.process_workbook(
                input_file=uploaded_path,
                master_file=MASTER_FILE,
                plot_area_ha=plot_area_ha,
                rai_per_hectare=rai_per_hectare,
                sheet_groups=sheet_groups,
            )
            summary_path, detail_path = calc.resolve_output_paths(uploaded_path, str(output_base))
            calc.write_summary_by_site_workbook(summary_path, result_sheets)
            calc.write_detail_workbook(detail_path, result_sheets)

        component_bytes = None
        if sheet_groups and COMPONENT_TEMPLATE_FILE.exists():
            component_path = temp_dir / COMPONENT_OUTPUT_FILENAME
            calc.write_component_summary_workbook(
                component_path,
                COMPONENT_TEMPLATE_FILE,
                result_sheets,
                summary_file=summary_path,
            )
            component_bytes = component_path.read_bytes()

        return summary_path.read_bytes(), detail_path.read_bytes(), component_bytes, result_sheets


app = FastAPI(title="Forest Public App API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=parse_cors_origins(),
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    LOG.exception("Unhandled exception for %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={
            "detail": str(exc) or exc.__class__.__name__,
            "errorType": exc.__class__.__name__,
            "path": request.url.path,
        },
    )


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/config")
def config() -> dict[str, Any]:
    return {
        "plotAreaHa": calc.PLOT_AREA_HA,
        "raiPerHectare": calc.RAI_PER_HECTARE,
        "templateAvailable": TEMPLATE_FILE.exists(),
        "profileTemplateAvailable": PROFILE_SOURCE_FILE.exists(),
        "masterAvailable": MASTER_FILE.exists(),
        "componentTemplateAvailable": COMPONENT_TEMPLATE_FILE.exists(),
    }


@app.get("/api/template")
def template_download() -> FileResponse:
    if not TEMPLATE_FILE.exists():
        raise HTTPException(status_code=404, detail="Template file is missing.")
    return FileResponse(TEMPLATE_FILE, filename=TEMPLATE_FILE.name)


@app.get("/api/profile/template")
def profile_template_download() -> FileResponse:
    template_path = ensure_profile_template()
    return FileResponse(template_path, filename=template_path.name)


@app.post("/api/inspect")
async def inspect_workbook(file: UploadFile = File(...)) -> dict[str, Any]:
    file_bytes = await file.read()
    if not file.filename or not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Please upload a valid .xlsx file.")
    return {
        "fileName": file.filename,
        "sheetNames": get_uploaded_sheet_names(file_bytes),
    }


@app.post("/api/profile/inspect")
async def inspect_profile_workbook(file: UploadFile = File(...)) -> dict[str, Any]:
    file_bytes = await file.read()
    if not file.filename or not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Please upload a valid .xlsx file.")
    return {
        "fileName": file.filename,
        "sheetNames": get_uploaded_sheet_names(file_bytes),
    }


@app.post("/api/calculate")
async def calculate(
    file: UploadFile = File(...),
    plot_area_ha: float = Form(...),
    rai_per_hectare: float = Form(...),
    sheet_groups: str | None = Form(default=None),
    calculation_scope: str = Form(default="biomass_only"),
    economic_inputs: str | None = Form(default=None),
    future_interest_rate: float = Form(default=0.01),
    future_periods: str | None = Form(default=None),
) -> dict[str, Any]:
    if not MASTER_FILE.exists():
        raise HTTPException(status_code=500, detail="species_reference_master_v1.xlsx is missing.")

    file_bytes = await file.read()
    if not file.filename or not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Please upload a valid .xlsx file.")

    parsed_sheet_groups = parse_sheet_groups(sheet_groups)
    parsed_future_periods = parse_future_periods(future_periods)
    component_area_inputs, ecosystem_inputs = parse_economic_inputs(economic_inputs, parsed_sheet_groups)
    scope = normalize_text(calculation_scope).lower() or "biomass_only"
    if scope not in {"biomass_only", "economic_only", "biomass_and_economic"}:
        raise HTTPException(status_code=400, detail="Invalid calculation_scope.")
    if scope != "biomass_only" and not parsed_sheet_groups:
        raise HTTPException(status_code=400, detail="Economic calculation requires grouped components from Step 4.")
    if scope != "biomass_only" and not ecosystem_inputs:
        raise HTTPException(status_code=400, detail="Economic calculation requires per-component economic inputs.")

    workflow_cache_key = build_workflow_cache_key(
        file_bytes=file_bytes,
        plot_area_ha=plot_area_ha,
        rai_per_hectare=rai_per_hectare,
        sheet_groups=parsed_sheet_groups,
    )
    cached_workflow = get_cached_workflow(workflow_cache_key)
    if cached_workflow is not None:
        LOG.info("Using cached biomass workflow result.")
        summary_bytes, detail_bytes, component_bytes, result_sheets = cached_workflow
    else:
        try:
            summary_bytes, detail_bytes, component_bytes, result_sheets = run_uploaded_workflow(
                uploaded_filename=file.filename,
                file_bytes=file_bytes,
                plot_area_ha=plot_area_ha,
                rai_per_hectare=rai_per_hectare,
                sheet_groups=parsed_sheet_groups,
            )
            store_cached_workflow(
                workflow_cache_key,
                (summary_bytes, detail_bytes, component_bytes, result_sheets),
            )
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    try:
        biomass_payload = None
        if scope in {"biomass_only", "biomass_and_economic"}:
            biomass_payload = build_biomass_payload(
                result_sheets=result_sheets,
                sheet_groups=parsed_sheet_groups,
                plot_area_ha=plot_area_ha,
                rai_per_hectare=rai_per_hectare,
            )

        economic_payload = None
        economic_report_download = None
        economic_json_download = None
        if scope in {"economic_only", "biomass_and_economic"}:
            bundle = calculate_forest_valuation_bundle_from_outputs(
                outputs=result_sheets,
                component_area_inputs=component_area_inputs,
                ecosystem_user_inputs=ecosystem_inputs,
                future_interest_rate=future_interest_rate,
                future_periods_years=parsed_future_periods,
            )
            economic_payload = build_economic_preview(bundle, result_sheets)
            with tempfile.TemporaryDirectory() as tmp_dir:
                temp_dir = Path(tmp_dir)
                report_path = temp_dir / ECONOMIC_OUTPUT_FILENAME
                write_forest_economic_report(report_path, result_sheets, bundle)
                economic_report_download = serialize_download_payload(ECONOMIC_OUTPUT_FILENAME, report_path.read_bytes())
            economic_json_download = serialize_download_payload(
                ECONOMIC_JSON_FILENAME,
                json.dumps(bundle, ensure_ascii=False, indent=2).encode("utf-8"),
            )

        return jsonable_encoder(
            sanitize_for_json(
                {
                    "calculationScope": scope,
                    "biomass": biomass_payload,
                    "economic": economic_payload,
                    "downloads": {
                        "biomassSummary": serialize_download_payload(SUMMARY_OUTPUT_FILENAME, summary_bytes)
                        if scope in {"biomass_only", "biomass_and_economic"}
                        else None,
                        "biomassDetail": serialize_download_payload(DETAIL_OUTPUT_FILENAME, detail_bytes)
                        if scope in {"biomass_only", "biomass_and_economic"}
                        else None,
                        "biomassComponent": serialize_download_payload(COMPONENT_OUTPUT_FILENAME, component_bytes)
                        if scope in {"biomass_only", "biomass_and_economic"} and component_bytes is not None
                        else None,
                        "economicReport": economic_report_download,
                        "economicJson": economic_json_download,
                    },
                }
            )
        )
    except Exception as exc:  # noqa: BLE001
        LOG.exception("Failed to assemble calculate response.")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/profile/calculate")
async def calculate_profile(
    file: UploadFile = File(...),
    render_mode: str = Form(default="graphic"),
) -> dict[str, Any]:
    file_bytes = await file.read()
    if not file.filename or not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Please upload a valid .xlsx file.")

    if render_mode not in {"graphic", "realistic"}:
        raise HTTPException(status_code=400, detail="render_mode must be either 'graphic' or 'realistic'.")

    try:
        images, zip_bytes, output_filename, validation = build_profile_outputs(file.filename, file_bytes, render_mode)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return {
        "sheetNames": [item["sheetName"] for item in images],
        "renderMode": render_mode,
        "images": images,
        "validation": validation,
        "download": {
            "filename": output_filename,
            "contentBase64": base64.b64encode(zip_bytes).decode("ascii"),
        },
    }
