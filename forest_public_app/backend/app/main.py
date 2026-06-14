from __future__ import annotations

import base64
import json
import os
import sys
import tempfile
from io import BytesIO
from pathlib import Path
from typing import Any
from zipfile import ZIP_DEFLATED, ZipFile

import pandas as pd
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from openpyxl import load_workbook
from pydantic import BaseModel

ROOT_DIR = Path(__file__).resolve().parents[3]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

import run_forest_calculation as calc
from cal_EIA.profile_diagram_lib import create_profile_template, render_workbook_profile_map

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


def parse_cors_origins() -> list[str]:
    raw_value = os.getenv("CORS_ORIGINS", "*").strip()
    if not raw_value or raw_value == "*":
        return ["*"]
    return [origin.strip() for origin in raw_value.split(",") if origin.strip()]


class MetricCard(BaseModel):
    label: str
    value: str
    help_text: str


def format_metric_value(value: object, decimals: int = 2) -> str:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return "-"
    if isinstance(value, (int, float)):
        return f"{value:,.{decimals}f}" if isinstance(value, float) or decimals else f"{int(value):,}"
    return str(value)


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


def build_metrics(
    summary_all: pd.DataFrame,
    unmatched: pd.DataFrame,
    result_sheets: dict[str, pd.DataFrame],
) -> list[MetricCard]:
    if summary_all.empty:
        return []

    filtered_summary = filter_primary_rows(summary_all, result_sheets)
    filtered_unmatched = filter_primary_rows(unmatched, result_sheets)

    total_tree = pd.to_numeric(filtered_summary.get("n_tree"), errors="coerce").fillna(0).sum()
    total_sapling = pd.to_numeric(filtered_summary.get("n_sapling"), errors="coerce").fillna(0).sum()
    total_tree_biomass = pd.to_numeric(filtered_summary.get("total_tree_biomass"), errors="coerce").fillna(0).sum()
    total_tree_volume = pd.to_numeric(filtered_summary.get("total_tree_volume_m3"), errors="coerce").fillna(0).sum()
    total_sapling_volume = pd.to_numeric(filtered_summary.get("total_sapling_volume_m3"), errors="coerce").fillna(0).sum()

    shannon_series = pd.to_numeric(filtered_summary.get("shannon_index"), errors="coerce")
    shannon_value = shannon_series.mean() if shannon_series is not None and not shannon_series.dropna().empty else None
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
    return sample.to_dict(orient="records")


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


def build_profile_outputs(uploaded_filename: str, file_bytes: bytes) -> tuple[list[dict[str, str]], bytes]:
    with tempfile.TemporaryDirectory() as tmp_dir:
        temp_dir = Path(tmp_dir)
        uploaded_path = temp_dir / uploaded_filename
        uploaded_path.write_bytes(file_bytes)

        output_dir = temp_dir / "profile_images"
        rendered_items = render_workbook_profile_map(uploaded_path, output_dir)
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

        zip_path = temp_dir / PROFILE_OUTPUT_FILENAME
        with ZipFile(zip_path, "w", compression=ZIP_DEFLATED) as zip_file:
            for image_path in image_paths:
                zip_file.write(image_path, arcname=image_path.name)
        return payloads, zip_path.read_bytes()


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
) -> dict[str, Any]:
    if not MASTER_FILE.exists():
        raise HTTPException(status_code=500, detail="species_reference_master_v1.xlsx is missing.")

    file_bytes = await file.read()
    if not file.filename or not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Please upload a valid .xlsx file.")

    parsed_sheet_groups = parse_sheet_groups(sheet_groups)

    try:
        summary_bytes, detail_bytes, component_bytes, result_sheets = run_uploaded_workflow(
            uploaded_filename=file.filename,
            file_bytes=file_bytes,
            plot_area_ha=plot_area_ha,
            rai_per_hectare=rai_per_hectare,
            sheet_groups=parsed_sheet_groups,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    summary_all = result_sheets.get("SUMMARY_ALL", pd.DataFrame())
    summary_biomass = result_sheets.get("SUMMARY_BIOMASS", pd.DataFrame())
    summary_volume = result_sheets.get("SUMMARY_VOLUME", pd.DataFrame())
    summary_shannon = result_sheets.get("SUMMARY_SHANNON", pd.DataFrame())
    unmatched = result_sheets.get("CHECK_UNMATCHED_SPECIES", pd.DataFrame())

    return {
        "metrics": [metric.model_dump() for metric in build_metrics(summary_all, unmatched, result_sheets)],
        "previews": {
            "summaryAll": dataframe_records(summary_all),
            "summaryBiomass": dataframe_records(summary_biomass),
            "summaryVolume": dataframe_records(summary_volume),
            "summaryShannon": dataframe_records(summary_shannon),
            "unmatchedSpecies": dataframe_records(unmatched),
        },
        "downloads": {
            "summary": {
                "filename": SUMMARY_OUTPUT_FILENAME,
                "contentBase64": base64.b64encode(summary_bytes).decode("ascii"),
            },
            "detail": {
                "filename": DETAIL_OUTPUT_FILENAME,
                "contentBase64": base64.b64encode(detail_bytes).decode("ascii"),
            },
            "component": {
                "filename": COMPONENT_OUTPUT_FILENAME,
                "contentBase64": base64.b64encode(component_bytes).decode("ascii"),
            } if component_bytes is not None else None,
        },
    }


@app.post("/api/profile/calculate")
async def calculate_profile(file: UploadFile = File(...)) -> dict[str, Any]:
    file_bytes = await file.read()
    if not file.filename or not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Please upload a valid .xlsx file.")

    try:
        images, zip_bytes = build_profile_outputs(file.filename, file_bytes)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return {
        "sheetNames": [item["sheetName"] for item in images],
        "images": images,
        "download": {
            "filename": PROFILE_OUTPUT_FILENAME,
            "contentBase64": base64.b64encode(zip_bytes).decode("ascii"),
        },
    }
