from __future__ import annotations

from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

import matplotlib
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from matplotlib import font_manager
from matplotlib.lines import Line2D
from matplotlib.patches import PathPatch, Rectangle
from matplotlib.path import Path as MplPath
from openpyxl import load_workbook


EXPECTED_COLUMNS = [
    "no",
    "species",
    "girth_cm",
    "height_m",
    "first_branch_m",
    "x",
    "y",
    "crown_x_plus",
    "crown_x_minus",
    "crown_y_plus",
    "crown_y_minus",
]

PLOT_PALETTE = [
    "#43a047",
    "#1e88e5",
    "#8e24aa",
    "#f4511e",
    "#00acc1",
    "#7cb342",
    "#5e35b1",
    "#d81b60",
    "#546e7a",
    "#00897b",
    "#e53935",
    "#6d4c41",
    "#3949ab",
    "#fb8c00",
    "#8d6e63",
    "#00a0dc",
]

PROFILE_CROWN_WIDTH_SCALE = 1.18
PROFILE_CROWN_HEIGHT_SCALE = 0.7
SIDE_PADDING_METERS = 4.6


def configure_matplotlib() -> None:
    thai_font_candidates = [
        "Noto Sans Thai",
        "Sarabun",
        "TH Sarabun New",
        "Leelawadee UI",
        "Tahoma",
    ]
    installed = {font.name for font in font_manager.fontManager.ttflist}
    for font_name in thai_font_candidates:
        if font_name in installed:
            matplotlib.rcParams["font.family"] = font_name
            break
    matplotlib.rcParams["axes.unicode_minus"] = False


def load_profile_sheet(excel_path: Path, sheet_name: str) -> pd.DataFrame:
    raw = pd.read_excel(excel_path, sheet_name=sheet_name, header=[0, 1])
    raw.columns = EXPECTED_COLUMNS
    df = raw.copy()
    df["species"] = df["species"].astype(str).str.strip()
    for column in EXPECTED_COLUMNS:
        if column != "species":
            df[column] = pd.to_numeric(df[column], errors="coerce")

    df = df.dropna(subset=["species", "x", "y", "height_m"])
    df = df[df["species"].ne("")]
    return df.reset_index(drop=True)


def list_profile_sheets(excel_path: Path) -> list[str]:
    workbook = pd.ExcelFile(excel_path)
    return workbook.sheet_names


def build_species_color_map(species_names: list[str]) -> dict[str, str]:
    unique_species = sorted(dict.fromkeys(species_names))
    return {
        species: PLOT_PALETTE[index % len(PLOT_PALETTE)]
        for index, species in enumerate(unique_species)
    }


def make_output_path(excel_path: Path, output_dir: Path, sheet_name: str) -> Path:
    stem = excel_path.stem
    safe_sheet_name = "".join(ch if ch.isalnum() or ch in {"-", "_"} else "_" for ch in sheet_name)
    return output_dir / f"{stem}_{safe_sheet_name}_profile.png"


def build_trunk_widths(df: pd.DataFrame) -> pd.Series:
    girth = df["girth_cm"].fillna(df["girth_cm"].median()).astype(float)
    min_girth = float(girth.min())
    max_girth = float(girth.max())
    if np.isclose(min_girth, max_girth):
        return pd.Series(2.2, index=df.index)

    normalized = (girth - min_girth) / (max_girth - min_girth)
    softened = np.sqrt(normalized)
    return 0.9 + softened * 4.1


def compute_top_view_limits(df: pd.DataFrame) -> tuple[float, float, float, float]:
    left = (df["x"] - df["crown_x_minus"]).min()
    right = (df["x"] + df["crown_x_plus"]).max()
    bottom = (df["y"] - df["crown_y_minus"]).min()
    top = (df["y"] + df["crown_y_plus"]).max()
    return float(left), float(right), float(bottom), float(top)


def compute_profile_limits(df: pd.DataFrame) -> tuple[float, float]:
    left = (df["x"] - df["crown_x_minus"] * PROFILE_CROWN_WIDTH_SCALE).min()
    right = (df["x"] + df["crown_x_plus"] * PROFILE_CROWN_WIDTH_SCALE).max()
    return float(left), float(right)


def add_bushy_crown(
    ax: plt.Axes,
    center_x: float,
    center_y: float,
    width: float,
    height: float,
    color: str,
    alpha: float,
    zorder: int,
    edgecolor: str | None = None,
    linewidth: float = 0.0,
) -> None:
    angles = np.linspace(0, 2 * np.pi, 220, endpoint=False)
    width = max(width, 0.18)
    height = max(height, 0.18)
    phase = (center_x * 0.37 + center_y * 0.19 + width * 0.11) % (2 * np.pi)
    modulation = (
        1.0
        + 0.08 * np.sin(5 * angles + phase)
        + 0.05 * np.sin(9 * angles + phase / 2)
        + 0.03 * np.cos(13 * angles - phase)
    )
    modulation = np.clip(modulation, 0.86, 1.16)

    radius_x = (width / 2) * modulation
    radius_y = (height / 2) * modulation
    xs = center_x + radius_x * np.cos(angles)
    ys = center_y + radius_y * np.sin(angles)

    vertices = np.column_stack([xs, ys])
    vertices = np.vstack([vertices, vertices[0]])
    codes = [MplPath.MOVETO] + [MplPath.LINETO] * (len(vertices) - 2) + [MplPath.CLOSEPOLY]
    patch = PathPatch(
        MplPath(vertices, codes),
        facecolor=color,
        edgecolor=edgecolor if edgecolor else "none",
        linewidth=linewidth,
        alpha=alpha,
        zorder=zorder,
        joinstyle="round",
        capstyle="round",
    )
    ax.add_patch(patch)


def draw_top_view(ax: plt.Axes, df: pd.DataFrame, colors: dict[str, str]) -> None:
    x_min = float(np.floor(df["x"].min()))
    x_max = float(np.ceil(df["x"].max()))
    y_min = float(np.floor(df["y"].min()))
    y_max = float(np.ceil(df["y"].max()))
    crown_left, crown_right, crown_bottom, crown_top = compute_top_view_limits(df)

    for row in df.itertuples(index=False):
        crown_width = max(row.crown_x_plus + row.crown_x_minus, 0.2)
        crown_height = max(row.crown_y_plus + row.crown_y_minus, 0.2)
        crown_center_x = row.x + (row.crown_x_plus - row.crown_x_minus) / 2
        crown_center_y = row.y + (row.crown_y_plus - row.crown_y_minus) / 2
        add_bushy_crown(
            ax=ax,
            center_x=crown_center_x,
            center_y=crown_center_y,
            width=crown_width,
            height=crown_height,
            color=colors[row.species],
            alpha=0.5,
            zorder=2,
        )

    ax.scatter(df["x"], df["y"], s=8, color="black", zorder=3)
    plot_width = max(x_max - x_min, 1.0)
    plot_height = max(y_max - y_min, 1.0)
    ax.add_patch(
        Rectangle(
            (x_min, y_min),
            plot_width,
            plot_height,
            fill=False,
            linewidth=1.8,
            edgecolor="black",
            zorder=4,
        )
    )
    ax.set_xlim(np.floor(crown_left - SIDE_PADDING_METERS), np.ceil(crown_right + SIDE_PADDING_METERS))
    ax.set_ylim(np.floor(crown_bottom - 1.0), np.ceil(crown_top + 1.0))
    ax.set_aspect("equal", adjustable="box")
    ax.set_xlabel("Distance (m.)")
    ax.set_ylabel("Distance (m.)")
    ax.grid(False)
    ax.set_xticks(np.arange(0, 41, 5))
    ax.set_yticks(np.arange(0, np.ceil(crown_top + 1.0) + 1, 5))
    ax.spines[["top", "right", "left", "bottom"]].set_visible(False)


def draw_profile_view(ax: plt.Axes, df: pd.DataFrame, colors: dict[str, str]) -> None:
    trunk_widths = build_trunk_widths(df)
    draw_df = df.copy()
    draw_df["trunk_width"] = trunk_widths
    draw_df["crown_width"] = (
        (draw_df["crown_x_plus"] + draw_df["crown_x_minus"]) * PROFILE_CROWN_WIDTH_SCALE
    ).clip(lower=0.6)
    draw_df["crown_depth"] = (
        (draw_df["height_m"] - draw_df["first_branch_m"]) * PROFILE_CROWN_HEIGHT_SCALE
    ).clip(lower=0.8)
    draw_df["crown_area"] = draw_df["crown_width"] * draw_df["crown_depth"]

    for row in draw_df.itertuples(index=False):
        trunk_top_y = min(max(row.height_m - row.crown_depth, 0), 19.6)
        ax.plot(
            [row.x, row.x],
            [0, trunk_top_y],
            color="#4e342e",
            linewidth=float(row.trunk_width),
            alpha=0.95,
            zorder=2,
            solid_capstyle="round",
        )

    crown_df = draw_df.sort_values(["crown_area", "height_m"], ascending=[False, False])
    for row in crown_df.itertuples(index=False):
        crown_width = float(row.crown_width)
        crown_base_y = float(max(row.height_m - row.crown_depth, 0))
        crown_depth = float(min(row.crown_depth, 20 - crown_base_y))
        crown_center_x = float(row.x + (row.crown_x_plus - row.crown_x_minus) / 2)
        crown_center_y = float(crown_base_y + crown_depth / 2)
        add_bushy_crown(
            ax=ax,
            center_x=crown_center_x,
            center_y=crown_center_y,
            width=crown_width,
            height=crown_depth,
            color=colors[row.species],
            edgecolor=colors[row.species],
            linewidth=0.6,
            alpha=0.5,
            zorder=3,
        )

    profile_left, profile_right = compute_profile_limits(df)
    ax.set_xlim(np.floor(profile_left - SIDE_PADDING_METERS), np.ceil(profile_right + SIDE_PADDING_METERS))
    ax.set_ylim(0, 20)
    ax.set_xticks(np.arange(0, 41, 5))
    ax.set_yticks(np.arange(0, 21, 5))
    ax.set_xlabel("Distance (m.)")
    ax.set_ylabel("Height (m.)")
    ax.grid(False)
    ax.spines[["top", "right", "left", "bottom"]].set_visible(False)


def render_sheet_profile(excel_path: Path, sheet_name: str, output_dir: Path) -> Path:
    df = load_profile_sheet(excel_path, sheet_name)
    if df.empty:
        raise ValueError(f"Sheet '{sheet_name}' does not contain usable tree profile data.")

    colors = build_species_color_map(df["species"].tolist())
    output_path = make_output_path(excel_path, output_dir, sheet_name)

    figure = plt.figure(figsize=(14.5, 13.2))
    grid = figure.add_gridspec(nrows=3, ncols=1, height_ratios=[1.0, 1.08, 0.4])
    top_ax = figure.add_subplot(grid[0])
    profile_ax = figure.add_subplot(grid[1])
    legend_ax = figure.add_subplot(grid[2])

    draw_top_view(top_ax, df, colors)
    draw_profile_view(profile_ax, df, colors)

    handles = [
        Line2D(
            [0],
            [0],
            marker="s",
            linestyle="None",
            markersize=12,
            markerfacecolor=colors[species],
            markeredgecolor="none",
            label=species,
            alpha=0.85,
        )
        for species in colors
    ]
    handles.append(
        Line2D(
            [0],
            [0],
            marker="o",
            linestyle="None",
            markersize=6,
            markerfacecolor="black",
            markeredgecolor="black",
            label="ตำแหน่งลำต้น",
        )
    )
    legend_ax.axis("off")
    x_left, x_right = profile_ax.get_xlim()
    axis_span = max(x_right - x_left, 1.0)
    legend_left = max((0 - x_left) / axis_span, 0.0)
    legend_width = min(40 / axis_span, 1.0 - legend_left)
    legend_ax.legend(
        handles=handles,
        title=f"ชนิดพันธุ์ไม้ {sheet_name}",
        loc="center",
        mode="expand",
        ncol=5,
        frameon=True,
        fancybox=True,
        framealpha=0.96,
        edgecolor="#d6d6d6",
        fontsize=9.5,
        title_fontsize=10.5,
        columnspacing=1.0,
        handletextpad=0.5,
        borderpad=0.9,
        labelspacing=0.8,
        bbox_to_anchor=(legend_left, 0.08, legend_width, 0.84),
    )

    figure.subplots_adjust(left=0.09, right=0.91, top=0.96, bottom=0.06, hspace=0.2)
    figure.savefig(output_path, dpi=220, bbox_inches="tight")
    plt.close(figure)
    return output_path


def render_workbook_profiles(excel_path: Path, output_dir: Path) -> list[Path]:
    configure_matplotlib()
    output_dir.mkdir(parents=True, exist_ok=True)
    output_paths: list[Path] = []
    for sheet_name in list_profile_sheets(excel_path):
        try:
            output_paths.append(render_sheet_profile(excel_path, sheet_name, output_dir))
        except ValueError:
            continue
    if not output_paths:
        raise ValueError("No worksheet contained usable profile data.")
    return output_paths


def render_workbook_profile_map(excel_path: Path, output_dir: Path) -> list[tuple[str, Path]]:
    configure_matplotlib()
    output_dir.mkdir(parents=True, exist_ok=True)
    outputs: list[tuple[str, Path]] = []
    for sheet_name in list_profile_sheets(excel_path):
        try:
            outputs.append((sheet_name, render_sheet_profile(excel_path, sheet_name, output_dir)))
        except ValueError:
            continue
    if not outputs:
        raise ValueError("No worksheet contained usable profile data.")
    return outputs


def create_profile_template(source_path: Path, output_path: Path) -> Path:
    workbook = load_workbook(source_path)
    try:
        for ws in workbook.worksheets:
            if ws.max_row > 2:
                ws.delete_rows(3, ws.max_row - 2)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        workbook.save(output_path)
    finally:
        workbook.close()
    return output_path


def zip_profile_outputs(image_paths: list[Path], zip_path: Path) -> Path:
    zip_path.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(zip_path, "w", compression=ZIP_DEFLATED) as zip_file:
        for image_path in image_paths:
            zip_file.write(image_path, arcname=image_path.name)
    return zip_path
