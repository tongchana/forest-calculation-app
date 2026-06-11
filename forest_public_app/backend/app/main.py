from __future__ import annotations

import base64
import json
import sys
import tempfile
from io import BytesIO
from pathlib import Path
from typing import Any

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

TEMPLATE_FILE = ROOT_DIR / "template.xlsx"
MASTER_FILE = ROOT_DIR / "species_reference_master_v1.xlsx"
COMPONENT_TEMPLATE_FILE = ROOT_DIR / "forest_component_7.xlsx"
OUTPUT_BASE_FILENAME = "forest_calculation_output.xlsx"
SUMMARY_OUTPUT_FILENAME = "forest_calculation_output_summary_by_site.xlsx"
DETAIL_OUTPUT_FILENAME = "forest_calculation_output_details.xlsx"
COMPONENT_OUTPUT_FILENAME = "forest_component_summary.xlsx"


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


def build_metrics(summary_all: pd.DataFrame, unmatched: pd.DataFrame) -> list[MetricCard]:
    if summary_all.empty:
        return []

    total_tree = pd.to_numeric(summary_all.get("n_tree"), errors="coerce").fillna(0).sum()
    total_sapling = pd.to_numeric(summary_all.get("n_sapling"), errors="coerce").fillna(0).sum()
    total_tree_biomass = pd.to_numeric(summary_all.get("total_tree_biomass"), errors="coerce").fillna(0).sum()
    total_tree_volume = pd.to_numeric(summary_all.get("total_tree_volume_m3"), errors="coerce").fillna(0).sum()
    total_sapling_volume = pd.to_numeric(summary_all.get("total_sapling_volume_m3"), errors="coerce").fillna(0).sum()

    shannon_series = pd.to_numeric(summary_all.get("shannon_index"), errors="coerce")
    shannon_value = shannon_series.mean() if shannon_series is not None and not shannon_series.dropna().empty else None
    unmatched_count = len(unmatched.index) if not unmatched.empty else 0

    return [
        MetricCard(label="Total tree count", value=format_metric_value(total_tree, 0), help_text="Across all processed worksheets"),
        MetricCard(label="Total sapling count", value=format_metric_value(total_sapling, 0), help_text="Sapling records included in volume"),
        MetricCard(label="Total tree biomass", value=format_metric_value(total_tree_biomass, 2), help_text="Tree biomass only"),
        MetricCard(label="Total tree volume", value=format_metric_value(total_tree_volume, 3), help_text="Tree block volume"),
        MetricCard(label="Total sapling volume", value=format_metric_value(total_sapling_volume, 3), help_text="Sapling block volume"),
        MetricCard(label="Shannon index", value=format_metric_value(shannon_value, 6), help_text="Average across available sites"),
        MetricCard(label="Unmatched species", value=format_metric_value(unmatched_count, 0), help_text="Still reviewed in the QA sheet"),
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
    allow_origins=["*"],
    allow_credentials=True,
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
        "masterAvailable": MASTER_FILE.exists(),
        "componentTemplateAvailable": COMPONENT_TEMPLATE_FILE.exists(),
    }


@app.get("/api/template")
def template_download() -> FileResponse:
    if not TEMPLATE_FILE.exists():
        raise HTTPException(status_code=404, detail="Template file is missing.")
    return FileResponse(TEMPLATE_FILE, filename=TEMPLATE_FILE.name)


@app.post("/api/inspect")
async def inspect_workbook(file: UploadFile = File(...)) -> dict[str, Any]:
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
        "metrics": [metric.model_dump() for metric in build_metrics(summary_all, unmatched)],
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
