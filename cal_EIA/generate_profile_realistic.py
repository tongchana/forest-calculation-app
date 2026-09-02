from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path

import matplotlib
matplotlib.use("Agg", force=True)
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.lines import Line2D
from matplotlib.patches import Rectangle
from matplotlib.transforms import Affine2D, blended_transform_factory
from PIL import Image

from cal_EIA.profile_diagram_lib import (
    PROFILE_CROWN_HEIGHT_SCALE,
    PROFILE_CROWN_WIDTH_SCALE,
    SIDE_PADDING_METERS,
    TRUNK_CROWN_OVERLAP_RATIO,
    build_species_color_map,
    compute_profile_limits,
    configure_matplotlib,
    draw_top_view,
    get_thai_font_properties,
    load_profile_sheet,
)


# Bundled with the deployment so the realistic renderer has no machine-specific paths.
ASSET_FOLDER = Path(__file__).with_name("profile_assets")
EDITOR_ASSET_ROOTS = [
    Path(__file__).with_name("profile_assets_v2") / "normalized",
    Path(__file__).with_name("profile_assets_v3") / "normalized",
]
ASSET_RANDOM_SEED_OFFSET = 20260623
# 0.36 was the shortened experimental crown scale; raise it by 40% for the current profile series.
LOCAL_CROWN_HEIGHT_REDUCTION = 0.504


@dataclass(frozen=True)
class SpriteAsset:
    name: str
    rgba: np.ndarray
    width_px: int
    height_px: int
    bottom_anchor_x: float
    aspect_ratio: float
    core_width_fraction: float
    core_height_fraction: float


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Local proof-of-concept: render freeform crown/trunk sprites without crown masking."
    )
    parser.add_argument("excel_path", nargs="?", default="profile.xlsx")
    parser.add_argument("--sheet-name", default="N2")
    parser.add_argument("--output-dir", default="outputs/profile_freeform_sprite_experiment")
    return parser.parse_args()


def load_rgba(path: Path) -> np.ndarray:
    with Image.open(path) as image:
        rgba = image.convert("RGBA")
        alpha = rgba.getchannel("A")
        bbox = alpha.getbbox()
        if bbox is None:
            return np.zeros((1, 1, 4), dtype=np.uint8)
        return np.asarray(rgba.crop(bbox)).copy()


def source_alpha_coverage(path: Path) -> float:
    with Image.open(path) as image:
        alpha = np.asarray(image.convert("RGBA").getchannel("A"))
    return float((alpha > 5).mean())


def remove_checkerboard_background(rgba: np.ndarray) -> np.ndarray:
    """Remove the neutral light/dark checkerboard baked into supplied branch exports."""
    cleaned = rgba.copy()
    rgb = cleaned[..., :3].astype(np.int16)
    neutral = (rgb.max(axis=2) - rgb.min(axis=2)) <= 18
    light_or_mid_gray = rgb.mean(axis=2) >= 135
    cleaned[..., 3][neutral & light_or_mid_gray] = 0
    return crop_rgba_to_alpha_bbox(cleaned)


def load_branch_assets() -> list[SpriteAsset]:
    candidates = [
        path
        for path in sorted(ASSET_FOLDER.glob("*.png"))
        if "branch" in path.name.lower() or source_alpha_coverage(path) >= 0.97
    ]
    assets: list[SpriteAsset] = []
    for path in candidates:
        with Image.open(path) as image:
            rgba = np.asarray(image.convert("RGBA")).copy()
        if source_alpha_coverage(path) >= 0.97:
            rgba = remove_checkerboard_background(rgba)
        else:
            rgba = crop_rgba_to_alpha_bbox(rgba)
        asset = build_asset(path.name, rgba)
        if asset.width_px >= 100 and asset.height_px >= 100 and asset.aspect_ratio >= 0.65:
            assets.append(asset)
    return assets


def crop_rgba_to_alpha_bbox(rgba: np.ndarray) -> np.ndarray:
    alpha = Image.fromarray(rgba.astype(np.uint8), mode="RGBA").getchannel("A")
    bbox = alpha.getbbox()
    if bbox is None:
        return np.zeros((1, 1, 4), dtype=np.uint8)
    return np.asarray(Image.fromarray(rgba.astype(np.uint8), mode="RGBA").crop(bbox)).copy()


def build_asset(name: str, rgba: np.ndarray) -> SpriteAsset:
    alpha = rgba[..., 3]
    height_px, width_px = alpha.shape

    bottom_rows = []
    for row_idx in range(max(int(height_px * 0.82), 0), height_px):
        cols = np.where(alpha[row_idx] > 20)[0]
        if cols.size:
            bottom_rows.append(cols)
    if bottom_rows:
        centers = [(cols[0] + cols[-1]) / 2 for cols in bottom_rows]
        bottom_anchor_x = float(np.median(centers) / max(width_px - 1, 1))
    else:
        bottom_anchor_x = 0.5

    col_strength = alpha.sum(axis=0).astype(np.float64)
    row_strength = alpha.sum(axis=1).astype(np.float64)
    active_cols = np.where(col_strength >= col_strength.max() * 0.18)[0]
    active_rows = np.where(row_strength >= row_strength.max() * 0.18)[0]
    core_width_fraction = float((active_cols[-1] - active_cols[0] + 1) / width_px) if active_cols.size else 1.0
    core_height_fraction = float((active_rows[-1] - active_rows[0] + 1) / height_px) if active_rows.size else 1.0

    return SpriteAsset(
        name=name,
        rgba=rgba,
        width_px=width_px,
        height_px=height_px,
        bottom_anchor_x=bottom_anchor_x,
        aspect_ratio=float(width_px / max(height_px, 1)),
        core_width_fraction=float(np.clip(core_width_fraction, 0.15, 1.0)),
        core_height_fraction=float(np.clip(core_height_fraction, 0.15, 1.0)),
    )


def load_assets() -> tuple[list[SpriteAsset], list[SpriteAsset]]:
    # Discover transparent sprites by geometry, not by file name. This keeps new
    # crown/trunk exports usable even when they retain their original image names.
    all_assets = [
        build_asset(path.name, load_rgba(path))
        for path in sorted(ASSET_FOLDER.glob("*.png"))
        if "branch" not in path.name.lower()
        and source_alpha_coverage(path) < 0.97
    ]

    # Keep only complete-looking crowns: reject tiny fragments, slivers, and overly sparse pieces.
    crown_assets = [
        asset
        for asset in all_assets
        if asset.width_px >= 110
        and asset.height_px >= 70
        and asset.core_width_fraction >= 0.42
        and asset.core_height_fraction >= 0.34
        # Crowns begin well above the narrow trunk geometry.
        and 0.75 <= asset.aspect_ratio <= 3.4
    ]

    # Keep only clean, tall trunk segments for stretching.
    trunk_assets = [
        asset
        for asset in all_assets
        if asset.width_px >= 18
        and asset.height_px >= 120
        # Keep trunk sprites distinct from crown masses.
        and asset.aspect_ratio <= 0.42
        and asset.core_height_fraction >= 0.82
    ]
    if not crown_assets or not trunk_assets:
        raise ValueError("Sprite assets could not be loaded.")
    return crown_assets, trunk_assets


def stable_species_seed(species: str) -> int:
    return ASSET_RANDOM_SEED_OFFSET + sum((idx + 1) * ord(ch) for idx, ch in enumerate(species))


def index_to_alpha_label(index: int) -> str:
    label = ""
    value = int(index)
    while True:
        value, remainder = divmod(value, 26)
        label = chr(ord("A") + remainder) + label
        if value == 0:
            break
        value -= 1
    return label


def build_species_label_map(draw_df) -> dict[str, str]:
    """Assign one stable alphabetic identifier to each species on a profile."""
    ordered = draw_df.sort_values(["x", "height_m"], ascending=[True, False])
    labels: dict[str, str] = {}
    for row in ordered.itertuples():
        species = str(row.species)
        if species not in labels:
            labels[species] = index_to_alpha_label(len(labels))
    return labels


def layout_profile_labels(ordered_df, cluster_gap_m: float = 0.75) -> dict[int, tuple[float, int]]:
    """Use two rows and small local offsets to keep labels legible in dense x clusters."""
    groups: list[list[object]] = []
    for row in ordered_df.itertuples():
        if not groups or float(row.x) - float(groups[-1][-1].x) > cluster_gap_m:
            groups.append([row])
        else:
            groups[-1].append(row)

    layout: dict[int, tuple[float, int]] = {}
    for group in groups:
        count = len(group)
        # The offsets only move the annotation, never the tree or its measured x position.
        offsets = np.linspace(-0.34 * (count - 1) / 2, 0.34 * (count - 1) / 2, count)
        for position, (row, offset) in enumerate(zip(group, offsets)):
            layout[int(row.index)] = (float(row.x) + float(offset), position % 2)
    return layout


def build_species_style_map(
    species_names: list[str],
    crown_assets: list[SpriteAsset],
    trunk_assets: list[SpriteAsset],
    branch_assets: list[SpriteAsset],
) -> dict[str, dict[str, SpriteAsset]]:
    # The refreshed asset set has three useful silhouette families:
    # compact/tall, rounded medium, and broad spreading crowns.
    tall_assets = [asset for asset in crown_assets if asset.aspect_ratio <= 1.40]
    short_assets = [asset for asset in crown_assets if asset.aspect_ratio >= 2.10]
    medium_assets = [asset for asset in crown_assets if 1.40 < asset.aspect_ratio < 2.10]

    if not tall_assets:
        tall_assets = crown_assets
    if not short_assets:
        short_assets = crown_assets
    if not medium_assets:
        medium_assets = crown_assets

    style_map: dict[str, dict[str, SpriteAsset]] = {}
    for species in species_names:
        rng = np.random.default_rng(stable_species_seed(species))
        style_map[species] = {
            "tall_crown": tall_assets[int(rng.integers(0, len(tall_assets)))],
            "medium_crown": medium_assets[int(rng.integers(0, len(medium_assets)))],
            "short_crown": short_assets[int(rng.integers(0, len(short_assets)))],
            "trunk": trunk_assets[int(rng.integers(0, len(trunk_assets)))],
        }
        if branch_assets:
            style_map[species]["branch"] = branch_assets[int(rng.integers(0, len(branch_assets)))]
    return style_map


def load_editor_asset_group(asset_roots: list[Path], group_id: str) -> dict[str, SpriteAsset] | None:
    """Load one coherent V3 trunk/branch/canopy group for an edited tree."""
    for root in asset_roots:
        group_dir = root / group_id
        paths = {
            "trunk": group_dir / "trunk.png",
            "branch": group_dir / "first_branch.png",
            "crown": group_dir / "canopy_side.png",
        }
        if not all(path.is_file() for path in paths.values()):
            continue
        return {
            "trunk": build_asset(f"{group_id}::trunk", load_rgba(paths["trunk"])),
            "branch": build_asset(f"{group_id}::branch", load_rgba(paths["branch"])),
            "crown": build_asset(f"{group_id}::crown", load_rgba(paths["crown"])),
        }
    return None


def build_editor_tree_styles(
    draw_df,
    asset_assignments: dict[int, str] | None,
    asset_roots: list[Path] | None,
    fallback_styles: dict[str, dict[str, SpriteAsset]],
) -> dict[int, dict[str, SpriteAsset]]:
    if not asset_assignments or not asset_roots:
        return {}
    styles: dict[int, dict[str, SpriteAsset]] = {}
    for row in draw_df.itertuples():
        group_id = asset_assignments.get(int(row.Index))
        if not group_id:
            continue
        group = load_editor_asset_group(asset_roots, str(group_id))
        if group is None:
            continue
        styles[int(row.Index)] = {
            "tall_crown": group["crown"],
            "medium_crown": group["crown"],
            "short_crown": group["crown"],
            "trunk": group["trunk"],
            "branch": group["branch"],
        }
    return styles


def choose_species_crown_asset(
    species_style: dict[str, SpriteAsset],
    crown_width: float,
    crown_depth: float,
) -> SpriteAsset:
    elongation = crown_depth / max(crown_width, 0.18)
    if elongation >= 1.18:
        return species_style["tall_crown"]
    if elongation <= 0.72:
        return species_style["short_crown"]
    return species_style["medium_crown"]


def apply_alpha_scale(image_rgba: np.ndarray, alpha_scale: float) -> np.ndarray:
    scaled = image_rgba.copy()
    scaled[..., 3] = np.clip(np.round(scaled[..., 3].astype(np.float32) * alpha_scale), 0, 255).astype(np.uint8)
    return scaled


def match_branch_foliage_to_crown(branch_rgba: np.ndarray, crown_rgba: np.ndarray) -> np.ndarray:
    """Bring branch leaves into the selected crown's green palette while preserving texture."""
    result = branch_rgba.copy()
    branch_rgb = result[..., :3].astype(np.float32)
    crown_rgb = crown_rgba[..., :3].astype(np.float32)

    crown_leaf_mask = (
        (crown_rgba[..., 3] > 20)
        & (crown_rgb[..., 1] > crown_rgb[..., 0] * 1.04)
        & (crown_rgb[..., 1] > crown_rgb[..., 2] * 1.02)
    )
    if not crown_leaf_mask.any():
        return result

    target_green = crown_rgb[crown_leaf_mask].mean(axis=0)
    branch_leaf_mask = (
        (result[..., 3] > 20)
        & (branch_rgb[..., 1] > branch_rgb[..., 0] * 1.04)
        & (branch_rgb[..., 1] > branch_rgb[..., 2] * 1.02)
    )
    if branch_leaf_mask.any():
        source_green = branch_rgb[branch_leaf_mask].mean(axis=0)
        tint_scale = target_green / np.maximum(source_green, 1.0)
        branch_rgb[branch_leaf_mask] = np.clip(branch_rgb[branch_leaf_mask] * tint_scale, 0, 255)
        result[..., :3] = branch_rgb.astype(np.uint8)
    return result


def crop_vertical_fraction(image_rgba: np.ndarray, start_fraction: float, end_fraction: float) -> np.ndarray:
    height = image_rgba.shape[0]
    start = int(np.clip(round(height * start_fraction), 0, height - 1))
    end = int(np.clip(round(height * end_fraction), start + 1, height))
    return image_rgba[start:end].copy()


def smoothstep(value: np.ndarray | float) -> np.ndarray | float:
    value = np.clip(value, 0.0, 1.0)
    return value * value * (3.0 - 2.0 * value)


def bilinear_sample(image: np.ndarray, x: np.ndarray, y: np.ndarray) -> np.ndarray:
    height, width = image.shape[:2]
    x = np.clip(x, 0.0, width - 1.001)
    y = np.clip(y, 0.0, height - 1.001)

    x0 = np.floor(x).astype(np.int32)
    y0 = np.floor(y).astype(np.int32)
    x1 = np.clip(x0 + 1, 0, width - 1)
    y1 = np.clip(y0 + 1, 0, height - 1)

    wx = x - x0
    wy = y - y0

    top = image[y0, x0] * (1.0 - wx)[..., None] + image[y0, x1] * wx[..., None]
    bottom = image[y1, x0] * (1.0 - wx)[..., None] + image[y1, x1] * wx[..., None]
    return top * (1.0 - wy)[..., None] + bottom * wy[..., None]


def compute_bend_shift(
    branch_y: float,
    trunk_display_height: float,
    top_shift_data: float,
    trunk_display_width: float,
    bend_start_fraction: float,
    bend_end_fraction: float,
) -> float:
    if trunk_display_height <= 0:
        return 0.0
    limited_top_shift_data = float(np.clip(top_shift_data, -trunk_display_width * 0.75, trunk_display_width * 0.75))
    normalized_height = float(np.clip(branch_y / trunk_display_height, 0.0, 1.0))
    bend_phase = (normalized_height - bend_start_fraction) / max(1e-6, bend_end_fraction - bend_start_fraction)
    return float(limited_top_shift_data * smoothstep(bend_phase))


def warp_trunk_asset(
    trunk_asset: SpriteAsset,
    top_shift_data: float,
    trunk_display_width: float,
    bend_start_fraction: float = 0.40,
    bend_end_fraction: float = 0.80,
) -> tuple[SpriteAsset, float]:
    rgba = trunk_asset.rgba.astype(np.float32)
    height_px, width_px = rgba.shape[:2]
    src_center_x = (width_px - 1) / 2.0

    limited_top_shift_data = float(np.clip(top_shift_data, -trunk_display_width * 0.75, trunk_display_width * 0.75))
    max_shift_px = 0.0 if trunk_display_width <= 0 else limited_top_shift_data / trunk_display_width * width_px
    canvas_padding_px = int(max(24, abs(max_shift_px) * 1.25))
    out_width = int(width_px + abs(max_shift_px) + canvas_padding_px * 2)
    out_height = height_px
    out_center_x = canvas_padding_px + src_center_x + max(0.0, max_shift_px)

    yy, xx = np.meshgrid(
        np.arange(out_height, dtype=np.float32),
        np.arange(out_width, dtype=np.float32),
        indexing="ij",
    )
    normalized_height = 1.0 - yy / max(out_height - 1, 1)
    bend_phase = (normalized_height - bend_start_fraction) / max(1e-6, bend_end_fraction - bend_start_fraction)
    shift = max_shift_px * smoothstep(bend_phase)

    shifted_up = np.roll(shift, 1, axis=0)
    shifted_down = np.roll(shift, -1, axis=0)
    shifted_up[0] = shift[0]
    shifted_down[-1] = shift[-1]
    dshift_dy = (shifted_down - shifted_up) / 2.0

    tangent_x = dshift_dy
    tangent_y = np.ones_like(tangent_x)
    tangent_norm = np.sqrt(tangent_x * tangent_x + tangent_y * tangent_y)
    tangent_x /= tangent_norm
    tangent_y /= tangent_norm

    normal_x = tangent_y
    normal_y = -tangent_x

    center_x = out_center_x + shift
    dx = xx - center_x
    dy = np.zeros_like(dx)

    local_normal = dx * normal_x + dy * normal_y
    local_tangent = dx * tangent_x + dy * tangent_y

    # Preserve the original trunk width through the curve; only its centerline moves.
    local_normal = local_normal

    source_x = src_center_x + local_normal
    source_y = yy + local_tangent

    valid = (
        (source_x >= 0.0)
        & (source_x <= width_px - 1.001)
        & (source_y >= 0.0)
        & (source_y <= height_px - 1.001)
    )

    warped = np.zeros((out_height, out_width, 4), dtype=np.float32)
    warped[valid] = bilinear_sample(rgba, source_x[valid], source_y[valid])
    warped[..., 3] *= valid.astype(np.float32)
    cropped = crop_rgba_to_alpha_bbox(np.clip(warped, 0, 255).astype(np.uint8))
    warped_asset = build_asset(f"warped::{trunk_asset.name}", cropped)
    warped_display_width = trunk_display_width + abs(top_shift_data)
    return warped_asset, warped_display_width


def draw_sheared_image(
    ax: plt.Axes,
    image_rgba: np.ndarray,
    x_left: float,
    bottom_y: float,
    width: float,
    height: float,
    zorder: float,
    bottom_shift_x: float = 0.0,
    top_shift_x: float = 0.0,
    alpha_scale: float = 1.0,
) -> object:
    image = ax.imshow(
        apply_alpha_scale(image_rgba, alpha_scale),
        extent=(0.0, width, 0.0, height),
        interpolation="bilinear",
        zorder=zorder,
        aspect="auto",
    )
    shear_x = 0.0 if height <= 0 else (top_shift_x - bottom_shift_x) / height
    image.set_transform(
        Affine2D().from_values(1.0, 0.0, shear_x, 1.0, x_left + bottom_shift_x, bottom_y) + ax.transData
    )
    return image


def draw_rotated_image(
    ax: plt.Axes,
    image_rgba: np.ndarray,
    x_left: float,
    bottom_y: float,
    width: float,
    height: float,
    zorder: float,
    rotate_deg: float,
    anchor_x_fraction: float,
    anchor_y_fraction: float,
    alpha_scale: float = 1.0,
) -> object:
    image = ax.imshow(
        apply_alpha_scale(image_rgba, alpha_scale),
        extent=(0.0, width, 0.0, height),
        interpolation="bilinear",
        zorder=zorder,
        aspect="auto",
    )
    local_anchor_x = width * anchor_x_fraction
    local_anchor_y = height * anchor_y_fraction
    image.set_transform(
        Affine2D().rotate_deg_around(local_anchor_x, local_anchor_y, rotate_deg).translate(x_left, bottom_y) + ax.transData
    )
    return image


def draw_tree(
    ax: plt.Axes,
    row,
    species_style_map: dict[str, dict[str, SpriteAsset]],
    tree_style_map: dict[int, dict[str, SpriteAsset]] | None = None,
    tree_transform_map: dict[int, dict[str, object]] | None = None,
) -> dict[str, object]:
    artists: dict[str, object] = {}
    editor_transform = (tree_transform_map or {}).get(int(row.Index), {})
    editor_scale = float(np.clip(float(editor_transform.get("scale", 1.0) or 1.0), 0.2, 12.0))
    editor_width_scale = float(np.clip(float(editor_transform.get("widthScale", 1.0) or 1.0), 0.25, 12.0))
    crown_width_scale = float(np.clip(float(editor_transform.get("crownWidthScale", 1.0) or 1.0), 0.25, 12.0))
    crown_height_scale = float(np.clip(float(editor_transform.get("crownHeightScale", 1.0) or 1.0), 0.25, 12.0))
    editor_dx = float(editor_transform.get("dx", 0.0) or 0.0) / 30.0
    editor_dy = -float(editor_transform.get("dy", 0.0) or 0.0) / 30.0
    crown_width = float(row.crown_width) * editor_scale * crown_width_scale
    crown_depth = float(row.crown_depth) * editor_scale * crown_height_scale
    crown_base_y = float(max(row.height_m - crown_depth, 0.0))
    trunk_top_y = float(min(crown_base_y + crown_depth * TRUNK_CROWN_OVERLAP_RATIO, 19.6))
    crown_center_x = float(row.x + (row.crown_x_plus - row.crown_x_minus) / 2 + editor_dx)
    crown_center_y = float(crown_base_y + crown_depth / 2 + editor_dy)

    species_style = (tree_style_map or {}).get(int(row.Index), species_style_map[str(row.species)])
    crown_asset = choose_species_crown_asset(species_style, crown_width=crown_width, crown_depth=crown_depth)
    trunk_asset = species_style["trunk"]
    branch_asset = species_style.get("branch")

    # Keep the visible crown mass aligned much more tightly to the measured x+/x- width.
    # Because the PNGs are alpha-cropped, we expand only by the asset's dense-core fraction
    # rather than by an extra artistic multiplier.
    crown_width_scale = 1.0 / crown_asset.core_width_fraction
    crown_height_scale = 1.0 / crown_asset.core_height_fraction
    crown_display_width = float(np.clip(crown_width * crown_width_scale * 0.92, crown_width * 0.88, crown_width * 1.22))
    crown_display_height = float(np.clip(crown_depth * crown_height_scale * 0.92, crown_depth * 0.9, crown_depth * 1.24))

    trunk_display_height = max(trunk_top_y, 0.45)
    trunk_display_width = float(
        np.clip(
            trunk_display_height * trunk_asset.aspect_ratio * 1.16 * editor_width_scale,
            0.10,
            crown_display_width * 0.14,
        )
    )
    trunk_x_left = float(row.x + editor_dx - trunk_asset.bottom_anchor_x * trunk_display_width)

    crown_x_left = float(crown_center_x - crown_display_width / 2)
    crown_bottom_y = max(crown_center_y - crown_display_height / 2, 0.0)
    desired_shift = crown_center_x - float(row.x + editor_dx)
    editor_bend_x = float(editor_transform.get("bendXRatio", 0.0) or 0.0)
    trunk_top_shift = float(np.clip(desired_shift + editor_bend_x * trunk_display_height, -trunk_display_width * 2.5, trunk_display_width * 2.5))
    crown_bottom_shift = float(np.clip(-trunk_top_shift * 0.26, -crown_display_width * 0.08, crown_display_width * 0.08))
    crown_top_shift = float(np.clip(trunk_top_shift * 0.14, -crown_display_width * 0.06, crown_display_width * 0.06))

    # Keep the lower and upper trunk straight, with one gradual directional curve in between.
    warped_trunk_asset, warped_trunk_display_width = warp_trunk_asset(
        trunk_asset=trunk_asset,
        top_shift_data=trunk_top_shift,
        trunk_display_width=trunk_display_width,
        bend_start_fraction=0.40,
        bend_end_fraction=0.80,
    )
    warped_trunk_x_left = float(row.x - warped_trunk_asset.bottom_anchor_x * warped_trunk_display_width)
    artists["trunk"] = draw_sheared_image(
        ax=ax,
        image_rgba=warped_trunk_asset.rgba,
        x_left=warped_trunk_x_left,
        bottom_y=0.0,
        width=warped_trunk_display_width,
        height=trunk_display_height,
        zorder=2.15,
        alpha_scale=0.98,
    )
    if branch_asset is not None:
        branch_y = float(np.clip(row.first_branch_m + editor_dy, 0.8, max(trunk_display_height - 0.4, 0.8)))
        branch_center_shift = compute_bend_shift(
            branch_y=branch_y,
            trunk_display_height=trunk_display_height,
            top_shift_data=trunk_top_shift,
            trunk_display_width=trunk_display_width,
            bend_start_fraction=0.40,
            bend_end_fraction=0.80,
        )
        branch_rng = np.random.default_rng(ASSET_RANDOM_SEED_OFFSET + 9000 + int(row.Index))
        branch_side = -1 if int(branch_rng.integers(0, 2)) == 0 else 1
        branch_attach_x = float(row.x + editor_dx + branch_center_shift + branch_side * trunk_display_width * 0.05)
        branch_width = float(np.clip(crown_display_width * 0.32, 0.75, 2.35))
        branch_height = float(np.clip(branch_width / max(branch_asset.aspect_ratio, 0.2), 0.65, 2.0))
        crown_lean_angle = np.degrees(np.arctan2(desired_shift, trunk_display_height)) * 0.35
        branch_angle = float(np.clip(branch_side * branch_rng.uniform(9.0, 15.0) + crown_lean_angle + float(editor_transform.get("rotate", 0.0) or 0.0), -45.0, 45.0))
        branch_anchor_x_fraction = branch_asset.bottom_anchor_x
        branch_x_left = float(branch_attach_x - branch_width * branch_anchor_x_fraction)
        artists["branch"] = draw_rotated_image(
            ax=ax,
            image_rgba=match_branch_foliage_to_crown(branch_asset.rgba, crown_asset.rgba),
            x_left=branch_x_left,
            bottom_y=branch_y,
            width=branch_width,
            height=branch_height,
            zorder=2.7,
            rotate_deg=branch_angle,
            anchor_x_fraction=branch_anchor_x_fraction,
            anchor_y_fraction=0.0,
            alpha_scale=0.98,
        )

    artists["crown"] = draw_sheared_image(
        ax=ax,
        image_rgba=crown_asset.rgba,
        x_left=crown_x_left,
        bottom_y=crown_bottom_y,
        width=crown_display_width,
        height=min(crown_display_height, 20.0),
        zorder=3.05,
        bottom_shift_x=crown_bottom_shift,
        top_shift_x=crown_top_shift,
        alpha_scale=0.98,
    )
    return artists


def estimate_tree_profile_top(
    row,
    species_style_map: dict[str, dict[str, SpriteAsset]],
) -> float:
    crown_width = float(row.crown_width)
    crown_depth = float(row.crown_depth)
    crown_base_y = float(max(row.height_m - crown_depth, 0.0))
    crown_center_y = float(crown_base_y + crown_depth / 2)

    species_style = (
        species_style_map
        if "tall_crown" in species_style_map
        else species_style_map[str(row.species)]
    )
    crown_asset = choose_species_crown_asset(species_style, crown_width=crown_width, crown_depth=crown_depth)
    crown_height_scale = 1.0 / crown_asset.core_height_fraction
    crown_display_height = float(np.clip(crown_depth * crown_height_scale * 0.92, crown_depth * 0.9, crown_depth * 1.24))
    crown_bottom_y = max(crown_center_y - crown_display_height / 2, 0.0)
    return crown_bottom_y + min(crown_display_height, 20.0)


def render_freeform_sprite_experiment(
    excel_path: Path,
    sheet_name: str,
    output_dir: Path,
    asset_assignments: dict[int, str] | None = None,
    tree_transform_map: dict[int, dict[str, object]] | None = None,
    top_transform_map: dict[int, dict[str, object]] | None = None,
    asset_roots: list[Path] | None = None,
    visible_tree_indices: set[int] | None = None,
    layer_mode: bool = False,
    capture_layer_parts: list[dict[str, object]] | None = None,
    output_suffix: str = "freeform_sprite_experiment",
    dpi: int = 220,
    tight_bbox: bool = True,
) -> Path:
    configure_matplotlib()
    df = load_profile_sheet(excel_path, sheet_name)
    if df.empty:
        raise ValueError(f"Sheet '{sheet_name}' does not contain usable tree profile data.")

    colors = build_species_color_map(df["species"].tolist())
    draw_df = df.copy()
    draw_df["crown_width"] = ((draw_df["crown_x_plus"] + draw_df["crown_x_minus"]) * PROFILE_CROWN_WIDTH_SCALE).clip(lower=0.6)
    draw_df["crown_depth"] = (
        (draw_df["height_m"] - draw_df["first_branch_m"])
        * PROFILE_CROWN_HEIGHT_SCALE
        * LOCAL_CROWN_HEIGHT_REDUCTION
    ).clip(lower=0.8)

    # Keep short survey sheets legible in the shared 20 m profile frame while
    # preserving the relative height of every tree within that sheet.
    tallest_height = float(draw_df["height_m"].max())
    visual_height_scale = max(1.0, min(20.0 / max(tallest_height, 0.1), 2.5))
    draw_df["height_m"] *= visual_height_scale
    draw_df["first_branch_m"] *= visual_height_scale

    ordered_for_labels = draw_df.sort_values(["x", "height_m"], ascending=[True, False]).reset_index()
    species_label_map = build_species_label_map(draw_df)
    legend_label_map = {
        species: f"{species} ({label})"
        for species, label in species_label_map.items()
    }
    label_map = {
        int(row["index"]): species_label_map[str(row["species"])]
        for _, row in ordered_for_labels.iterrows()
    }
    label_layout_map = layout_profile_labels(ordered_for_labels)
    draw_df["tree_label"] = draw_df.index.map(label_map)

    crown_assets, trunk_assets = load_assets()
    branch_assets = load_branch_assets()
    species_style_map = build_species_style_map(
        draw_df["species"].drop_duplicates().tolist(),
        crown_assets=crown_assets,
        trunk_assets=trunk_assets,
        branch_assets=branch_assets,
    )
    editor_tree_styles = build_editor_tree_styles(
        draw_df,
        asset_assignments=asset_assignments,
        asset_roots=asset_roots,
        fallback_styles=species_style_map,
    )

    top_draw_df = draw_df.copy()
    for index, transform in (top_transform_map or {}).items():
        if index not in top_draw_df.index:
            continue
        top_draw_df.loc[index, "x"] += float(transform.get("dx", 0.0) or 0.0) / 30.0
        top_draw_df.loc[index, "y"] -= float(transform.get("dy", 0.0) or 0.0) / 30.0

    figure = plt.figure(figsize=(14.5, 13.2))
    grid = figure.add_gridspec(nrows=3, ncols=1, height_ratios=[1.0, 1.08, 0.4])
    top_ax = figure.add_subplot(grid[0])
    profile_ax = figure.add_subplot(grid[1])
    legend_ax = figure.add_subplot(grid[2])

    draw_top_view(top_ax, top_draw_df, colors)
    for patch in list(top_ax.patches):
        if isinstance(patch, Rectangle):
            patch.remove()
    top_ax.add_patch(Rectangle((0.0, 0.0), 40.0, 10.0, fill=False, linewidth=1.8, edgecolor="black", zorder=4, transform=top_ax.transData))
    existing_x_left, existing_x_right = top_ax.get_xlim()
    existing_y_bottom, existing_y_top = top_ax.get_ylim()
    top_ax.set_xlim(min(-5.0, existing_x_left), max(45.0, existing_x_right))
    top_ax.set_ylim(min(-5.0, existing_y_bottom), max(15.0, existing_y_top))
    top_ax.set_aspect("auto")
    top_ax.set_xticks(np.arange(0, 41, 5))
    top_ax.set_yticks(np.arange(0, 11, 5))
    thai_axis_font = get_thai_font_properties(size=11)
    top_ax.set_xlabel("\u0e23\u0e30\u0e22\u0e30\u0e17\u0e32\u0e07 (\u0e40\u0e21\u0e15\u0e23)", fontproperties=thai_axis_font)
    top_ax.set_ylabel("\u0e23\u0e30\u0e22\u0e30\u0e17\u0e32\u0e07 (\u0e40\u0e21\u0e15\u0e23)", fontproperties=thai_axis_font)

    tree_part_artists: dict[int, dict[str, object]] = {}
    for row in draw_df.sort_values(["crown_width", "height_m"], ascending=[False, False]).itertuples():
        if visible_tree_indices is not None and int(row.Index) not in visible_tree_indices:
            continue
        tree_part_artists[int(row.Index)] = draw_tree(
            profile_ax,
            row,
            species_style_map=species_style_map,
            tree_style_map=editor_tree_styles,
            tree_transform_map=tree_transform_map,
        )

    profile_left, profile_right = compute_profile_limits(draw_df)
    profile_top = 20.0
    for row in draw_df.itertuples():
        transform = (tree_transform_map or {}).get(int(row.Index), {})
        scale = float(np.clip(float(transform.get("scale", 1.0) or 1.0), 0.2, 12.0))
        shift_x = float(transform.get("dx", 0.0) or 0.0) / 30.0
        half_width = float(row.crown_width) * PROFILE_CROWN_WIDTH_SCALE * scale / 2.0
        profile_left = min(profile_left, float(row.x) + shift_x - half_width)
        profile_right = max(profile_right, float(row.x) + shift_x + half_width)
        profile_top = max(profile_top, float(row.height_m) * scale + abs(float(transform.get("dy", 0.0) or 0.0)) / 30.0)
    profile_top = float(np.ceil(profile_top / 5.0) * 5.0)
    # The report scale follows the normalized tree heights.  Do not let a
    # transparent crown margin force a 25 m axis when the tallest tree fits
    # the standard 20 m frame; the crown may overhang that frame by a few
    # pixels, but its measured height remains the scale anchor.
    profile_top = max(profile_top, float(draw_df["height_m"].max()))
    y_limit_top = float(np.ceil(profile_top / 5.0) * 5.0)
    # Preserve the full crown overhang around the surveyed profile.
    # Keep the side-profile canvas consistent across worksheets. The surveyed
    # transect is 40 m wide; the small outer margin keeps edge crowns visible
    # without changing the coordinate grid or the 0–40 m labels.
    profile_ax.set_xlim(-5.0, 45.0)
    profile_ax.set_ylim(0, y_limit_top)
    profile_ax.set_xticks(np.arange(0, 41, 5))
    profile_ax.set_yticks(np.arange(0, y_limit_top + 0.1, 5))
    x_axis_left, x_axis_right = profile_ax.get_xlim()
    profile_ax.set_xticks(np.arange(np.ceil(x_axis_left), np.floor(x_axis_right) + 1, 1), minor=True)
    profile_ax.set_yticks(np.arange(0, y_limit_top + 0.1, 1), minor=True)
    profile_ax.set_xlabel(
        "\u0e23\u0e30\u0e22\u0e30\u0e17\u0e32\u0e07 (\u0e40\u0e21\u0e15\u0e23)",
        fontproperties=thai_axis_font,
        labelpad=34,
    )
    profile_ax.set_ylabel("\u0e04\u0e27\u0e32\u0e21\u0e2a\u0e39\u0e07 (\u0e40\u0e21\u0e15\u0e23)", fontproperties=thai_axis_font)
    profile_ax.set_axisbelow(True)
    profile_ax.grid(which="minor", color="#e6e6e6", linewidth=0.45, alpha=0.5)
    profile_ax.grid(which="major", color="#cfcfcf", linewidth=0.7, alpha=0.65)
    profile_ax.tick_params(which="minor", length=0)
    profile_ax.spines[["top", "right", "left", "bottom"]].set_visible(False)

    profile_label_transform = blended_transform_factory(profile_ax.transData, profile_ax.transAxes)
    for row in ordered_for_labels.itertuples():
        profile_ax.text(
            label_layout_map[int(row.index)][0],
            -0.055 - (0.065 * label_layout_map[int(row.index)][1]),
            str(label_map[int(row.index)]),
            transform=profile_label_transform,
            ha="center",
            va="top",
            fontsize=9.5,
            color="#2d2d2d",
            clip_on=False,
        )

    handles = [
        Line2D(
            [0],
            [0],
            marker="s",
            linestyle="None",
            markersize=12,
            markerfacecolor=colors[species],
            markeredgecolor="none",
            label=legend_label_map.get(species, species),
            alpha=0.85,
        )
        for species in colors
    ]
    handles.append(
        Line2D([0], [0], marker="o", linestyle="None", markersize=6, markerfacecolor="black", markeredgecolor="black", label="ตำแหน่งลำต้น")
    )
    legend_ax.axis("off")
    x_left, x_right = profile_ax.get_xlim()
    axis_span = max(x_right - x_left, 1.0)
    legend_left = max((0 - x_left) / axis_span, 0.0)
    legend_width = min(40 / axis_span, 1.0 - legend_left)
    legend_font = get_thai_font_properties(size=9.5)
    legend_title_font = get_thai_font_properties(size=10.5, weight="bold")
    legend_ax.legend(
        handles=handles,
        title="ชนิดพันธุ์ไม้",
        loc="center",
        mode="expand",
        ncol=5,
        frameon=True,
        fancybox=True,
        framealpha=0.96,
        edgecolor="#d6d6d6",
        prop=legend_font,
        title_fontproperties=legend_title_font,
        columnspacing=1.0,
        handletextpad=0.5,
        borderpad=0.9,
        labelspacing=0.8,
        bbox_to_anchor=(legend_left, 0.08, legend_width, 0.84),
    )

    figure.subplots_adjust(left=0.09, right=0.91, top=0.96, bottom=0.06, hspace=0.2)
    # Match the profile panel's visible y-axis/title alignment to the equal-aspect
    # top view without changing any tree coordinates or profile scale.
    if layer_mode:
        top_ax.clear()
        top_ax.axis("off")
        top_ax.patch.set_alpha(0)
        profile_ax.axis("off")
        profile_ax.patch.set_alpha(0)
        legend_ax.clear()
        legend_ax.axis("off")
        legend_ax.patch.set_alpha(0)
        figure.patch.set_alpha(0)
        for label_artist in list(profile_ax.texts):
            label_artist.remove()

    figure.canvas.draw()
    top_position = top_ax.get_position()
    profile_position = profile_ax.get_position()
    legend_position = legend_ax.get_position()
    profile_ax.set_position([top_position.x0, profile_position.y0, top_position.width, profile_position.height])
    legend_ax.set_position([top_position.x0, legend_position.y0, top_position.width, legend_position.height])
    figure.canvas.draw()

    if layer_mode and capture_layer_parts is not None:
        for artists in tree_part_artists.values():
            for artist in artists.values():
                artist.set_visible(False)
        for tree_id, artists in tree_part_artists.items():
            for part_name, artist in artists.items():
                artist.set_visible(True)
                figure.canvas.draw()
                rgba = np.asarray(figure.canvas.buffer_rgba()).copy()
                image = Image.fromarray(rgba, mode="RGBA")
                alpha_bbox = image.getchannel("A").getbbox()
                if alpha_bbox is not None:
                    cropped_path = output_dir / f"tree_{tree_id}_{part_name}.png"
                    image.crop(alpha_bbox).save(cropped_path, optimize=True)
                    capture_layer_parts.append({
                        "treeId": tree_id,
                        "part": part_name,
                        "path": cropped_path,
                        "x": alpha_bbox[0],
                        "y": alpha_bbox[1],
                        "w": alpha_bbox[2] - alpha_bbox[0],
                        "h": alpha_bbox[3] - alpha_bbox[1],
                        "canvasWidth": rgba.shape[1],
                        "canvasHeight": rgba.shape[0],
                    })
                artist.set_visible(False)
        for artists in tree_part_artists.values():
            for artist in artists.values():
                artist.set_visible(True)
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{excel_path.stem}_{sheet_name.replace(' ', '_')}_{output_suffix}.png"
    save_kwargs = {"dpi": dpi}
    if tight_bbox:
        save_kwargs["bbox_inches"] = "tight"
    figure.savefig(output_path, **save_kwargs)
    plt.close(figure)
    return output_path


def list_editor_asset_group_ids() -> list[str]:
    group_ids: list[str] = []
    for root in EDITOR_ASSET_ROOTS:
        if not root.is_dir():
            continue
        for group_dir in sorted(root.iterdir()):
            if group_dir.is_dir() and group_dir.name not in group_ids and all(
                (group_dir / filename).is_file() for filename in ("trunk.png", "first_branch.png", "canopy_side.png")
            ):
                group_ids.append(group_dir.name)
    return sorted(group_ids)


def render_editable_profile_scene(excel_path: Path, sheet_name: str, output_dir: Path) -> dict[str, object]:
    """Render the production editor scene with V3's coherent tree groups."""
    scene_dir = output_dir / sheet_name.replace(" ", "_")
    scene_dir.mkdir(parents=True, exist_ok=True)
    profile_df = load_profile_sheet(excel_path, sheet_name)
    group_ids = list_editor_asset_group_ids()
    assignments = {
        int(index): group_ids[position % len(group_ids)]
        for position, index in enumerate(profile_df.index)
    } if group_ids else {}

    base_path = render_freeform_sprite_experiment(
        excel_path,
        sheet_name,
        scene_dir,
        visible_tree_indices=set(),
        output_suffix="editor_base",
        dpi=220,
        tight_bbox=False,
    )
    with Image.open(base_path) as base_image:
        base_width, base_height = base_image.size

    captured_parts: list[dict[str, object]] = []
    capture_path = render_freeform_sprite_experiment(
        excel_path,
        sheet_name,
        scene_dir,
        asset_assignments=assignments,
        asset_roots=EDITOR_ASSET_ROOTS,
        layer_mode=True,
        dpi=220,
        tight_bbox=False,
        output_suffix="editor_layer_capture",
        capture_layer_parts=captured_parts,
    )
    capture_path.unlink(missing_ok=True)

    parts_by_tree: dict[int, dict[str, dict[str, object]]] = {}
    for captured in captured_parts:
        tree_id = int(captured["treeId"])
        scale_x = base_width / int(captured["canvasWidth"])
        scale_y = base_height / int(captured["canvasHeight"])
        parts_by_tree.setdefault(tree_id, {})[str(captured["part"])] = {
            "path": captured["path"],
            "x": round(float(captured["x"]) * scale_x, 3),
            "y": round(float(captured["y"]) * scale_y, 3),
            "w": round(float(captured["w"]) * scale_x, 3),
            "h": round(float(captured["h"]) * scale_y, 3),
        }

    trees: list[dict[str, object]] = []
    for row_index, row in profile_df.iterrows():
        trees.append({
            "id": int(row_index),
            "species": str(row["species"]),
            "assetGroup": assignments.get(int(row_index)),
            "parts": parts_by_tree.get(int(row_index), {}),
        })
    return {
        "name": sheet_name,
        "basePath": base_path,
        "width": base_width,
        "height": base_height,
        "trees": trees,
    }


def main() -> None:
    args = parse_args()
    output_path = render_freeform_sprite_experiment(Path(args.excel_path).resolve(), args.sheet_name, Path(args.output_dir).resolve())
    print(f"Created preview: {output_path}")


if __name__ == "__main__":
    main()
