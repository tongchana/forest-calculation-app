from __future__ import annotations

from dataclasses import asdict, dataclass


M2_PER_RAI = 1600.0
M2_PER_HECTARE = 10000.0

ECOSYSTEM_UNIT_PRICES = {
    "soil_transport_baht_per_trip": 1800.0,
    "nitrogen_baht_per_g": 0.035,
    "phosphorus_baht_per_g": 0.093,
    "potassium_baht_per_g": 0.88,
    "water_transport_baht_per_trip": 1800.0,
    "warming_baht_per_hour": 2.5,
    "warming_hours_multiplier": 10020.0,
    "co2_baht_per_ton": 793.5,
    "wood_product_price_if_flag_0": 22750.0,
    "wood_product_price_if_flag_1": 42000.0,
    "soil_trip_kg": 13000.0,
    "water_trip_m3": 12.0,
}

FOREST_TYPE_FLAG_MAP = {
    "ป่าดิบ": 0,
    "ป่าดงดิบ": 0,
    "ป่าดิบแล้ง": 0,
    "ป่าดิบชื้น": 0,
    "ป่าดิบเขา": 0,
    "evergreen forest": 0,
    "dry evergreen forest": 0,
    "tropical evergreen forest": 0,
    "hill evergreen forest": 0,
    "def": 0,
    "mixed deciduous forest": 1,
    "dry dipterocarp forest": 1,
    "ป่าเบญจพรรณ": 1,
    "ป่าเต็งรัง": 1,
    "mdf": 1,
    "ddf": 1,
}

IMPACT_DETAILS = {
    "wood_product": ("มูลค่าผลผลิตไม้", "m3/rai/year", "baht/m3"),
    "soil": ("มูลค่าการสูญเสียดิน", "kg/rai/year", "baht/trip"),
    "nitrogen": ("มูลค่าการสูญเสียไนโตรเจน", "kg/rai/year", "baht/g"),
    "phosphorus": ("มูลค่าการสูญเสียฟอสฟอรัส", "g/rai/year", "baht/g"),
    "potassium": ("มูลค่าการสูญเสียโพแทสเซียม", "g/rai/year", "baht/g"),
    "water_regulation": ("มูลค่าการสูญเสียการควบคุมน้ำ", "m3/rai/year", "baht/trip"),
    "warming": ("มูลค่าการสูญเสียจากภาวะร้อน", "celsius", "baht/hour"),
    "co2_absorption": ("มูลค่าการสูญเสียการดูดซับ CO2", "ton CO2/rai/year", "baht/ton"),
}


def normalize_text(value: object) -> str:
    if value is None:
        return ""
    return str(value).strip()


def normalize_forest_type_key(value: object) -> str:
    text = normalize_text(value).lower()
    return " ".join(text.split())


@dataclass(frozen=True)
class EcosystemComponentInput:
    component_id: str
    component_name: str
    canopy_cover_percent: float
    canopy_layer_count: float
    soil_depth_m: float
    annual_rainfall_mm: float
    topography_score: float
    basal_area_percent: float
    forest_type: str | None = None
    component_area_rai: float | None = None
    representative_area_rai: float | None = None
    sample_plot_area_rai: float | None = None


@dataclass(frozen=True)
class EcosystemImpactQuantities:
    wood_product_loss_m3_per_rai_per_year: float
    soil_loss_kg_per_rai_per_year: float
    nitrogen_loss_kg_per_rai_per_year: float
    phosphorus_loss_g_per_rai_per_year: float
    potassium_loss_g_per_rai_per_year: float
    water_regulation_loss_m3_per_rai_per_year: float
    temperature_increase_celsius: float
    co2_absorption_loss_ton_per_rai_per_year: float


@dataclass(frozen=True)
class EcosystemImpactValues:
    wood_product_value_baht_per_rai_per_year: float
    soil_value_baht_per_rai_per_year: float
    nitrogen_value_baht_per_rai_per_year: float
    phosphorus_value_baht_per_rai_per_year: float
    potassium_value_baht_per_rai_per_year: float
    water_regulation_value_baht_per_rai_per_year: float
    warming_value_baht_per_rai_per_year: float
    co2_absorption_value_baht_per_rai_per_year: float
    total_ecosystem_loss_baht_per_rai_per_year: float


@dataclass(frozen=True)
class EcosystemLossResult:
    component_id: str
    component_name: str
    component_area_rai: float | None
    forest_type: str | None
    canopy_cover_percent: float
    canopy_layer_count: float
    basal_area_percent: float
    soil_depth_m: float
    annual_rainfall_mm: float
    topography_score: float
    wood_product_price_flag: int
    bdv: float
    representative_area_rai: float | None
    sample_plot_area_rai: float | None
    wood_product_loss_m3_per_rai_per_year: float
    soil_loss_kg_per_rai_per_year: float
    nitrogen_loss_kg_per_rai_per_year: float
    phosphorus_loss_g_per_rai_per_year: float
    potassium_loss_g_per_rai_per_year: float
    water_regulation_loss_m3_per_rai_per_year: float
    temperature_increase_celsius: float
    co2_absorption_loss_ton_per_rai_per_year: float
    wood_product_value_baht_per_rai_per_year: float
    soil_value_baht_per_rai_per_year: float
    nitrogen_value_baht_per_rai_per_year: float
    phosphorus_value_baht_per_rai_per_year: float
    potassium_value_baht_per_rai_per_year: float
    water_regulation_value_baht_per_rai_per_year: float
    warming_value_baht_per_rai_per_year: float
    co2_absorption_value_baht_per_rai_per_year: float
    total_ecosystem_loss_baht_per_rai_per_year: float
    total_ecosystem_loss_baht_per_year: float | None
    warnings: list[str]

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


def calculate_basal_area_percent_from_ba_and_area(total_ba_m2: float, total_plot_area_m2: float) -> float:
    if total_ba_m2 < 0:
        raise ValueError("total_ba_m2 must be >= 0")
    if total_plot_area_m2 <= 0:
        raise ValueError("total_plot_area_m2 must be > 0")
    return (total_ba_m2 / total_plot_area_m2) * 100.0


def calculate_basal_area_percent_from_plot_area_rai(total_ba_m2: float, total_plot_area_rai: float) -> float:
    return calculate_basal_area_percent_from_ba_and_area(total_ba_m2, total_plot_area_rai * M2_PER_RAI)


def calculate_basal_area_percent_from_plot_area_ha(total_ba_m2: float, total_plot_area_ha: float) -> float:
    return calculate_basal_area_percent_from_ba_and_area(total_ba_m2, total_plot_area_ha * M2_PER_HECTARE)


def calculate_basal_area_percent_from_ba_density_per_ha(basal_area_m2_per_ha: float) -> float:
    if basal_area_m2_per_ha < 0:
        raise ValueError("basal_area_m2_per_ha must be >= 0")
    return basal_area_m2_per_ha / 100.0


def get_wood_product_price_flag(forest_type: str | None) -> tuple[int, list[str]]:
    if not normalize_text(forest_type):
        return 1, ["forest_type is missing; defaulted wood product price flag to 1"]
    key = normalize_forest_type_key(forest_type)
    if key in FOREST_TYPE_FLAG_MAP:
        return FOREST_TYPE_FLAG_MAP[key], []
    return 1, [f"forest_type '{forest_type}' is unmapped; defaulted wood product price flag to 1"]


def validate_ecosystem_input(data: EcosystemComponentInput) -> list[str]:
    warnings: list[str] = []
    if not 0 <= data.canopy_cover_percent <= 100:
        warnings.append("canopy_cover_percent must be between 0 and 100")
    if data.canopy_layer_count <= 0:
        warnings.append("canopy_layer_count must be > 0")
    if data.basal_area_percent < 0:
        warnings.append("basal_area_percent must be >= 0")
    if data.soil_depth_m <= 0:
        warnings.append("soil_depth_m must be > 0")
    if data.annual_rainfall_mm < 0:
        warnings.append("annual_rainfall_mm must be >= 0")
    if data.topography_score <= 0:
        warnings.append("topography_score must be > 0")
    return warnings


def calculate_bdv(data: EcosystemComponentInput) -> float:
    return 0.45 * pow(10.46 + (0.11 * data.canopy_cover_percent * data.canopy_layer_count), 0.62) * pow(
        25.16 + (45.26 * data.basal_area_percent * data.soil_depth_m),
        0.59,
    )


def calculate_ecosystem_impact_quantities(
    bdv: float,
    annual_rainfall_mm: float,
    topography_score: float,
) -> EcosystemImpactQuantities:
    rainfall = annual_rainfall_mm
    topo = topography_score
    warming_term = (bdv / 100.0) * (rainfall / 1000.0) * topo
    return EcosystemImpactQuantities(
        wood_product_loss_m3_per_rai_per_year=-1.17 + (0.04 * bdv) + (0.0008 * rainfall) + (0.05 * topo),
        soil_loss_kg_per_rai_per_year=-31.86 + (0.86 * bdv) + (0.04 * rainfall) + (0.52 * topo),
        nitrogen_loss_kg_per_rai_per_year=-4.0 + (0.02 * bdv) + (0.0005 * rainfall) + (0.2 * topo),
        phosphorus_loss_g_per_rai_per_year=-20.07 + (0.17 * bdv) + (0.0005 * rainfall) + (0.63 * topo),
        potassium_loss_g_per_rai_per_year=-140.76 + (0.98 * bdv) + (0.012 * rainfall) + (3.89 * topo),
        water_regulation_loss_m3_per_rai_per_year=(
            -16.66 + (0.12 * bdv) + (0.017 * rainfall) + (0.81 * topo)
        )
        / 1.6,
        temperature_increase_celsius=(-0.002 * pow(warming_term, 2)) + (0.11 * warming_term) + 0.517,
        co2_absorption_loss_ton_per_rai_per_year=-0.38 + (0.018 * bdv) + (0.0015 * rainfall) + (0.12 * topo),
    )


def calculate_ecosystem_impact_values(
    quantities: EcosystemImpactQuantities,
    wood_product_price_flag: int,
) -> EcosystemImpactValues:
    wood_price = (
        ECOSYSTEM_UNIT_PRICES["wood_product_price_if_flag_0"]
        if wood_product_price_flag == 0
        else ECOSYSTEM_UNIT_PRICES["wood_product_price_if_flag_1"]
    )
    soil_loss = quantities.soil_loss_kg_per_rai_per_year
    if soil_loss >= ECOSYSTEM_UNIT_PRICES["soil_trip_kg"]:
        soil_value = (soil_loss / ECOSYSTEM_UNIT_PRICES["soil_trip_kg"]) * ECOSYSTEM_UNIT_PRICES["soil_transport_baht_per_trip"]
    else:
        soil_value = ECOSYSTEM_UNIT_PRICES["soil_transport_baht_per_trip"]

    values = EcosystemImpactValues(
        wood_product_value_baht_per_rai_per_year=quantities.wood_product_loss_m3_per_rai_per_year * wood_price,
        soil_value_baht_per_rai_per_year=soil_value,
        nitrogen_value_baht_per_rai_per_year=quantities.nitrogen_loss_kg_per_rai_per_year * 1000.0 * ECOSYSTEM_UNIT_PRICES["nitrogen_baht_per_g"],
        phosphorus_value_baht_per_rai_per_year=quantities.phosphorus_loss_g_per_rai_per_year * ECOSYSTEM_UNIT_PRICES["phosphorus_baht_per_g"],
        potassium_value_baht_per_rai_per_year=(
            quantities.potassium_loss_g_per_rai_per_year * ECOSYSTEM_UNIT_PRICES["potassium_baht_per_g"] / 1000.0
        ),
        water_regulation_value_baht_per_rai_per_year=(
            quantities.water_regulation_loss_m3_per_rai_per_year / ECOSYSTEM_UNIT_PRICES["water_trip_m3"]
        )
        * ECOSYSTEM_UNIT_PRICES["water_transport_baht_per_trip"],
        warming_value_baht_per_rai_per_year=(
            quantities.temperature_increase_celsius
            * ECOSYSTEM_UNIT_PRICES["warming_baht_per_hour"]
            * ECOSYSTEM_UNIT_PRICES["warming_hours_multiplier"]
        ),
        co2_absorption_value_baht_per_rai_per_year=(
            quantities.co2_absorption_loss_ton_per_rai_per_year * ECOSYSTEM_UNIT_PRICES["co2_baht_per_ton"]
        ),
        total_ecosystem_loss_baht_per_rai_per_year=0.0,
    )
    total = (
        values.wood_product_value_baht_per_rai_per_year
        + values.soil_value_baht_per_rai_per_year
        + values.nitrogen_value_baht_per_rai_per_year
        + values.phosphorus_value_baht_per_rai_per_year
        + values.potassium_value_baht_per_rai_per_year
        + values.water_regulation_value_baht_per_rai_per_year
        + values.warming_value_baht_per_rai_per_year
        + values.co2_absorption_value_baht_per_rai_per_year
    )
    return EcosystemImpactValues(
        wood_product_value_baht_per_rai_per_year=values.wood_product_value_baht_per_rai_per_year,
        soil_value_baht_per_rai_per_year=values.soil_value_baht_per_rai_per_year,
        nitrogen_value_baht_per_rai_per_year=values.nitrogen_value_baht_per_rai_per_year,
        phosphorus_value_baht_per_rai_per_year=values.phosphorus_value_baht_per_rai_per_year,
        potassium_value_baht_per_rai_per_year=values.potassium_value_baht_per_rai_per_year,
        water_regulation_value_baht_per_rai_per_year=values.water_regulation_value_baht_per_rai_per_year,
        warming_value_baht_per_rai_per_year=values.warming_value_baht_per_rai_per_year,
        co2_absorption_value_baht_per_rai_per_year=values.co2_absorption_value_baht_per_rai_per_year,
        total_ecosystem_loss_baht_per_rai_per_year=total,
    )


def build_ecosystem_loss_detail_rows(result: EcosystemLossResult) -> list[dict[str, object]]:
    quantity_map = {
        "wood_product": result.wood_product_loss_m3_per_rai_per_year,
        "soil": result.soil_loss_kg_per_rai_per_year,
        "nitrogen": result.nitrogen_loss_kg_per_rai_per_year,
        "phosphorus": result.phosphorus_loss_g_per_rai_per_year,
        "potassium": result.potassium_loss_g_per_rai_per_year,
        "water_regulation": result.water_regulation_loss_m3_per_rai_per_year,
        "warming": result.temperature_increase_celsius,
        "co2_absorption": result.co2_absorption_loss_ton_per_rai_per_year,
    }
    unit_price_map = {
        "wood_product": (
            ECOSYSTEM_UNIT_PRICES["wood_product_price_if_flag_0"]
            if result.wood_product_price_flag == 0
            else ECOSYSTEM_UNIT_PRICES["wood_product_price_if_flag_1"]
        ),
        "soil": ECOSYSTEM_UNIT_PRICES["soil_transport_baht_per_trip"],
        "nitrogen": ECOSYSTEM_UNIT_PRICES["nitrogen_baht_per_g"],
        "phosphorus": ECOSYSTEM_UNIT_PRICES["phosphorus_baht_per_g"],
        "potassium": ECOSYSTEM_UNIT_PRICES["potassium_baht_per_g"],
        "water_regulation": ECOSYSTEM_UNIT_PRICES["water_transport_baht_per_trip"],
        "warming": ECOSYSTEM_UNIT_PRICES["warming_baht_per_hour"],
        "co2_absorption": ECOSYSTEM_UNIT_PRICES["co2_baht_per_ton"],
    }
    value_map = {
        "wood_product": result.wood_product_value_baht_per_rai_per_year,
        "soil": result.soil_value_baht_per_rai_per_year,
        "nitrogen": result.nitrogen_value_baht_per_rai_per_year,
        "phosphorus": result.phosphorus_value_baht_per_rai_per_year,
        "potassium": result.potassium_value_baht_per_rai_per_year,
        "water_regulation": result.water_regulation_value_baht_per_rai_per_year,
        "warming": result.warming_value_baht_per_rai_per_year,
        "co2_absorption": result.co2_absorption_value_baht_per_rai_per_year,
    }

    rows: list[dict[str, object]] = []
    for impact_key, (impact_name_th, quantity_unit, unit_price_unit) in IMPACT_DETAILS.items():
        rows.append(
            {
                "component_id": result.component_id,
                "component_name": result.component_name,
                "forest_type": result.forest_type,
                "impact_key": impact_key,
                "impact_name_th": impact_name_th,
                "quantity": quantity_map[impact_key],
                "quantity_unit": quantity_unit,
                "unit_price": unit_price_map[impact_key],
                "unit_price_unit": unit_price_unit,
                "value_baht_per_rai_per_year": value_map[impact_key],
            }
        )
    return rows


def calculate_ecosystem_loss_for_component(data: EcosystemComponentInput) -> EcosystemLossResult:
    warnings = validate_ecosystem_input(data)
    if warnings:
        raise ValueError("; ".join(warnings))
    wood_product_price_flag, forest_warnings = get_wood_product_price_flag(data.forest_type)
    warnings.extend(forest_warnings)
    bdv = calculate_bdv(data)
    quantities = calculate_ecosystem_impact_quantities(bdv, data.annual_rainfall_mm, data.topography_score)
    values = calculate_ecosystem_impact_values(quantities, wood_product_price_flag)
    total_per_year = (
        values.total_ecosystem_loss_baht_per_rai_per_year * data.component_area_rai
        if data.component_area_rai is not None
        else None
    )
    return EcosystemLossResult(
        component_id=data.component_id,
        component_name=data.component_name,
        component_area_rai=data.component_area_rai,
        forest_type=data.forest_type,
        canopy_cover_percent=data.canopy_cover_percent,
        canopy_layer_count=data.canopy_layer_count,
        basal_area_percent=data.basal_area_percent,
        soil_depth_m=data.soil_depth_m,
        annual_rainfall_mm=data.annual_rainfall_mm,
        topography_score=data.topography_score,
        wood_product_price_flag=wood_product_price_flag,
        bdv=bdv,
        representative_area_rai=data.representative_area_rai,
        sample_plot_area_rai=data.sample_plot_area_rai,
        wood_product_loss_m3_per_rai_per_year=quantities.wood_product_loss_m3_per_rai_per_year,
        soil_loss_kg_per_rai_per_year=quantities.soil_loss_kg_per_rai_per_year,
        nitrogen_loss_kg_per_rai_per_year=quantities.nitrogen_loss_kg_per_rai_per_year,
        phosphorus_loss_g_per_rai_per_year=quantities.phosphorus_loss_g_per_rai_per_year,
        potassium_loss_g_per_rai_per_year=quantities.potassium_loss_g_per_rai_per_year,
        water_regulation_loss_m3_per_rai_per_year=quantities.water_regulation_loss_m3_per_rai_per_year,
        temperature_increase_celsius=quantities.temperature_increase_celsius,
        co2_absorption_loss_ton_per_rai_per_year=quantities.co2_absorption_loss_ton_per_rai_per_year,
        wood_product_value_baht_per_rai_per_year=values.wood_product_value_baht_per_rai_per_year,
        soil_value_baht_per_rai_per_year=values.soil_value_baht_per_rai_per_year,
        nitrogen_value_baht_per_rai_per_year=values.nitrogen_value_baht_per_rai_per_year,
        phosphorus_value_baht_per_rai_per_year=values.phosphorus_value_baht_per_rai_per_year,
        potassium_value_baht_per_rai_per_year=values.potassium_value_baht_per_rai_per_year,
        water_regulation_value_baht_per_rai_per_year=values.water_regulation_value_baht_per_rai_per_year,
        warming_value_baht_per_rai_per_year=values.warming_value_baht_per_rai_per_year,
        co2_absorption_value_baht_per_rai_per_year=values.co2_absorption_value_baht_per_rai_per_year,
        total_ecosystem_loss_baht_per_rai_per_year=values.total_ecosystem_loss_baht_per_rai_per_year,
        total_ecosystem_loss_baht_per_year=total_per_year,
        warnings=warnings,
    )


def aggregate_ecosystem_group_results(group_results: list[EcosystemLossResult]) -> tuple[float, list[str]]:
    if not group_results:
        raise ValueError("group_results must not be empty")
    if len(group_results) == 1:
        return group_results[0].total_ecosystem_loss_baht_per_rai_per_year, list(group_results[0].warnings)

    representative_weights = [row.representative_area_rai for row in group_results]
    if all(weight is not None for weight in representative_weights):
        weights = [float(weight) for weight in representative_weights if weight is not None]
        warnings: list[str] = []
    else:
        sample_weights = [row.sample_plot_area_rai for row in group_results]
        if not all(weight is not None for weight in sample_weights):
            raise ValueError(
                "Multiple forest-type group aggregation requires representative_area_rai or sample_plot_area_rai for every group"
            )
        weights = [float(weight) for weight in sample_weights if weight is not None]
        warnings = ["representative_area_rai missing; used sample_plot_area_rai weighted average"]

    total_weight = sum(weights)
    if total_weight <= 0:
        raise ValueError("aggregation weights must sum to > 0")
    weighted_total = sum(
        row.total_ecosystem_loss_baht_per_rai_per_year * weight for row, weight in zip(group_results, weights)
    ) / total_weight
    for row in group_results:
        warnings.extend(row.warnings)
    return weighted_total, warnings
