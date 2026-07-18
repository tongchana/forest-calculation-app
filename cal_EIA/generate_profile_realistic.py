from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.lines import Line2D
from matplotlib.transforms import Affine2D, blended_transform_factory
from PIL import Image

from cal_EIA.profile_diagram_lib import (
    PROFILE_CROWN_HEIGHT_SCALE,
    PROFILE_CROWN_WIDTH_SCALE,
    TRUNK_CROWN_OVERLAP_RATIO,
    build_species_color_map,
    configure_matplotlib,
    draw_top_view,
    get_thai_font_properties,
    load_profile_sheet,
)


# Bundled with the deployment so the realistic renderer has no machine-specific paths.
ASSET_FOLDER = Path(__file__).with_name("profile_assets")
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
        # Forked trunks are narrow (about 0.36 here); crowns begin well above that.
        and 0.75 <= asset.aspect_ratio <= 3.4
    ]

    # Keep only clean, tall trunk segments for stretching.
    trunk_assets = [
        asset
        for asset in all_assets
        if asset.width_px >= 18
        and asset.height_px >= 120
        # Allow a forked top while keeping trunk sprites distinct from crown masses.
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


def layout_profile_labels(ordered_df, min_horizontal_gap_m: float = 1.6) -> dict[int, tuple[float, int]]:
    """Pack tree labels into non-overlapping rows without changing tree positions."""
    layout: dict[int, tuple[float, int]] = {}
    # Keep an approximate text width as well as position; two anchors can be
    # far enough apart while their multi-species labels still touch.
    last_item_by_row: list[tuple[float, float]] = []

    for row in ordered_df.itertuples():
        x_position = float(row.x)
        label_half_width_m = max(0.45, 0.18 * len(str(row.label)) + 0.22)
        row_index = next(
            (
                index
                for index, (previous_x, previous_half_width_m) in enumerate(last_item_by_row)
                if x_position - previous_x >= max(
                    min_horizontal_gap_m,
                    previous_half_width_m + label_half_width_m + 0.20,
                )
            ),
            None,
        )
        if row_index is None:
            row_index = len(last_item_by_row)
            last_item_by_row.append((x_position, label_half_width_m))
        else:
            last_item_by_row[row_index] = (x_position, label_half_width_m)
        layout[int(row.index)] = (x_position, row_index)

    return layout


def build_profile_label_annotations(
    ordered_df,
    label_map: dict[int, str],
    projected_cluster_width_m: float = 1.6,
):
    """Summarise labels by the visible X-projection, not hidden Y positions.

    A profile is a side view: trees at different Y coordinates can occupy the
    same visual column.  Group close X positions into one compact annotation so
    the label count reflects what can actually be distinguished in the view.
    """
    annotation_rows: list[dict[str, object]] = []
    ordered_by_x = ordered_df.sort_values(["x", "height_m"], ascending=[True, False])
    cluster_start_x: float | None = None
    clusters: list[list[object]] = []

    for row in ordered_by_x.itertuples():
        x_position = float(row.x)
        if cluster_start_x is None or x_position - cluster_start_x >= projected_cluster_width_m:
            clusters.append([])
            cluster_start_x = x_position
        clusters[-1].append(row)

    for rows in clusters:
        representative = rows[0]
        labels_in_position = [label_map[int(row.index)] for row in rows]
        cluster_x = float(np.mean([float(row.x) for row in rows]))
        label_counts: dict[str, int] = {}
        for label in labels_in_position:
            label_counts[label] = label_counts.get(label, 0) + 1
        label_tokens = [
            f"{label}\u00d7{count}" if count > 1 else label
            for label, count in label_counts.items()
        ]
        if len(label_tokens) <= 3:
            annotation = " / ".join(label_tokens)
        else:
            displayed_tree_count = sum(list(label_counts.values())[:2])
            annotation = " / ".join(label_tokens[:2]) + f" +{len(rows) - displayed_tree_count}"

        annotation_rows.append(
            {
                "index": int(representative.index),
                "x": cluster_x,
                "label": annotation,
            }
        )
    return ordered_df.__class__(annotation_rows)


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
) -> None:
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
) -> None:
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


def draw_tree(
    ax: plt.Axes,
    row,
    species_style_map: dict[str, dict[str, SpriteAsset]],
) -> None:
    crown_width = float(row.crown_width)
    crown_depth = float(row.crown_depth)
    crown_base_y = float(max(row.height_m - crown_depth, 0.0))
    # The trunk must reach its own crown base. Capping it at a fixed height
    # disconnects tall trees from their crowns and makes them appear to float.
    trunk_top_y = float(crown_base_y + crown_depth * TRUNK_CROWN_OVERLAP_RATIO)
    crown_center_x = float(row.x + (row.crown_x_plus - row.crown_x_minus) / 2)
    crown_center_y = float(crown_base_y + crown_depth / 2)

    species_style = species_style_map[str(row.species)]
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
    # Keep emergent-tree trunks legible through the lower canopy. Without this,
    # their measured height can look truncated when shorter crowns overlap them.
    trunk_zorder = 3.18 if trunk_display_height >= 15.0 else 2.15
    trunk_display_width = float(
        np.clip(
            trunk_display_height * trunk_asset.aspect_ratio * 1.16,
            0.10,
            crown_display_width * 0.14,
        )
    )
    trunk_x_left = float(row.x - trunk_asset.bottom_anchor_x * trunk_display_width)

    crown_x_left = float(crown_center_x - crown_display_width / 2)
    crown_bottom_y = max(crown_center_y - crown_display_height / 2, 0.0)
    desired_shift = crown_center_x - float(row.x)
    trunk_top_shift = float(np.clip(desired_shift, -trunk_display_width * 1.5, trunk_display_width * 1.5))
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
    draw_sheared_image(
        ax=ax,
        image_rgba=warped_trunk_asset.rgba,
        x_left=warped_trunk_x_left,
        bottom_y=0.0,
        width=warped_trunk_display_width,
        height=trunk_display_height,
        zorder=trunk_zorder,
        alpha_scale=0.98,
    )

    if branch_asset is not None:
        branch_y = float(np.clip(row.first_branch_m, 0.8, max(trunk_display_height - 0.4, 0.8)))
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
        branch_attach_x = float(row.x + branch_center_shift + branch_side * trunk_display_width * 0.05)
        branch_width = float(np.clip(crown_display_width * 0.32, 0.75, 2.35))
        branch_height = float(np.clip(branch_width / max(branch_asset.aspect_ratio, 0.2), 0.65, 2.0))
        crown_lean_angle = np.degrees(np.arctan2(desired_shift, trunk_display_height)) * 0.35
        branch_angle = float(np.clip(branch_side * branch_rng.uniform(9.0, 15.0) + crown_lean_angle, -18.0, 18.0))
        branch_anchor_x_fraction = branch_asset.bottom_anchor_x
        branch_x_left = float(branch_attach_x - branch_width * branch_anchor_x_fraction)
        draw_rotated_image(
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

    draw_sheared_image(
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


def estimate_tree_profile_top(
    row,
    species_style_map: dict[str, dict[str, SpriteAsset]],
) -> float:
    crown_width = float(row.crown_width)
    crown_depth = float(row.crown_depth)
    crown_base_y = float(max(row.height_m - crown_depth, 0.0))
    crown_center_y = float(crown_base_y + crown_depth / 2)

    species_style = species_style_map[str(row.species)]
    crown_asset = choose_species_crown_asset(species_style, crown_width=crown_width, crown_depth=crown_depth)
    crown_height_scale = 1.0 / crown_asset.core_height_fraction
    crown_display_height = float(np.clip(crown_depth * crown_height_scale * 0.92, crown_depth * 0.9, crown_depth * 1.24))
    crown_bottom_y = max(crown_center_y - crown_display_height / 2, 0.0)
    return crown_bottom_y + min(crown_display_height, 20.0)


def render_freeform_sprite_experiment(excel_path: Path, sheet_name: str, output_dir: Path) -> Path:
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
    label_annotations = build_profile_label_annotations(ordered_for_labels, label_map)
    label_layout_map = layout_profile_labels(label_annotations)
    label_row_count = max((row_index for _, row_index in label_layout_map.values()), default=0) + 1

    crown_assets, trunk_assets = load_assets()
    branch_assets = load_branch_assets()
    species_style_map = build_species_style_map(
        draw_df["species"].drop_duplicates().tolist(),
        crown_assets=crown_assets,
        trunk_assets=trunk_assets,
        branch_assets=branch_assets,
    )

    figure = plt.figure(figsize=(14.5, 14.5))
    grid = figure.add_gridspec(nrows=3, ncols=1, height_ratios=[1.0, 1.08, 0.72])
    top_ax = figure.add_subplot(grid[0])
    profile_ax = figure.add_subplot(grid[1])
    legend_ax = figure.add_subplot(grid[2])

    draw_top_view(top_ax, draw_df, colors)
    thai_axis_font = get_thai_font_properties(size=11)
    top_ax.set_xlabel("\u0e23\u0e30\u0e22\u0e30\u0e17\u0e32\u0e07 (\u0e40\u0e21\u0e15\u0e23)", fontproperties=thai_axis_font)
    top_ax.set_ylabel("\u0e23\u0e30\u0e22\u0e30\u0e17\u0e32\u0e07 (\u0e40\u0e21\u0e15\u0e23)", fontproperties=thai_axis_font)

    # Draw shorter trees first so trunks of emergent trees remain visible instead
    # of being hidden behind the crowns of lower neighbouring trees.
    for row in draw_df.sort_values(["height_m", "crown_width"], ascending=[True, False]).itertuples():
        draw_tree(profile_ax, row, species_style_map=species_style_map)

    profile_top = max(
        estimate_tree_profile_top(row, species_style_map)
        for row in draw_df.itertuples()
    )
    y_limit_top = float(
        np.ceil((profile_top + 0.8) / (2.0 if profile_top <= 12.0 else 5.0))
        * (2.0 if profile_top <= 12.0 else 5.0)
    )
    major_y_step = 2.0 if y_limit_top <= 12.0 else 5.0
    # Lock every sheet to the same horizontal viewport.  The symmetric five
    # metre margins preserve boundary crowns while placing 0 and 40 at exactly
    # the same canvas coordinates in the plan and side views.
    fixed_x_left = -5.0
    fixed_x_right = 45.0
    profile_ax.set_xlim(fixed_x_left, fixed_x_right)
    top_ax.set_xlim(fixed_x_left, fixed_x_right)
    # Equal-aspect mode changes the physical axes width when a sheet has a
    # different Y extent.  Use the locked panel rectangle for page-to-page
    # alignment instead.
    top_ax.set_aspect("auto")
    profile_ax.set_ylim(0, y_limit_top)
    profile_ax.set_xticks(np.arange(0, 41, 5))
    profile_ax.set_yticks(np.arange(0, y_limit_top + 0.1, major_y_step))
    x_axis_left, x_axis_right = profile_ax.get_xlim()
    profile_ax.set_xticks(np.arange(np.ceil(x_axis_left), np.floor(x_axis_right) + 1, 1), minor=True)
    profile_ax.set_yticks(np.arange(0, y_limit_top + 0.1, 1), minor=True)
    profile_ax.set_xlabel(
        "\u0e23\u0e30\u0e22\u0e30\u0e17\u0e32\u0e07 (\u0e40\u0e21\u0e15\u0e23)",
        fontproperties=thai_axis_font,
        labelpad=34 + (12 * max(label_row_count - 2, 0)),
    )
    profile_ax.set_ylabel("\u0e04\u0e27\u0e32\u0e21\u0e2a\u0e39\u0e07 (\u0e40\u0e21\u0e15\u0e23)", fontproperties=thai_axis_font)
    profile_ax.set_axisbelow(True)
    profile_ax.grid(which="minor", color="#e6e6e6", linewidth=0.45, alpha=0.5)
    profile_ax.grid(which="major", color="#cfcfcf", linewidth=0.7, alpha=0.65)
    profile_ax.tick_params(which="minor", length=0)
    profile_ax.spines[["top", "right", "left", "bottom"]].set_visible(False)

    profile_label_transform = blended_transform_factory(profile_ax.transData, profile_ax.transAxes)
    for row in label_annotations.itertuples():
        profile_ax.text(
            label_layout_map[int(row.index)][0],
            -0.055 - (0.065 * label_layout_map[int(row.index)][1]),
            str(row.label),
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
    legend_columns = 3 if len(handles) > 8 else min(5, len(handles))
    legend_font = get_thai_font_properties(size=8.5)
    legend_title_font = get_thai_font_properties(size=10.5, weight="bold")
    legend_ax.legend(
        handles=handles,
        title="ชนิดพันธุ์ไม้",
        loc="center",
        mode="expand",
        ncol=legend_columns,
        frameon=True,
        fancybox=True,
        framealpha=0.96,
        edgecolor="#d6d6d6",
        prop=legend_font,
        title_fontproperties=legend_title_font,
        columnspacing=0.8,
        handletextpad=0.45,
        borderpad=0.8,
        labelspacing=0.7,
        bbox_to_anchor=(legend_left, 0.04, legend_width, 0.92),
    )

    # Fixed normalized rectangles make every output page pixel-identical in
    # size and keep both X axes vertically aligned across all worksheets.
    top_ax.set_position([0.09, 0.64, 0.82, 0.29])
    profile_ax.set_position([0.09, 0.31, 0.82, 0.25])
    legend_ax.set_position([0.09, 0.06, 0.82, 0.15])
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{excel_path.stem}_{sheet_name.replace(' ', '_')}_freeform_sprite_experiment.png"
    figure.savefig(output_path, dpi=220, facecolor="white")
    plt.close(figure)
    return output_path


def main() -> None:
    args = parse_args()
    output_path = render_freeform_sprite_experiment(Path(args.excel_path).resolve(), args.sheet_name, Path(args.output_dir).resolve())
    print(f"Created preview: {output_path}")


if __name__ == "__main__":
    main()
