from __future__ import annotations

from dataclasses import asdict, dataclass
import re


FOREST_INCREMENT_RATE = {
    "ป่าเต็งรัง": 0.015,
    "เต็งรัง": 0.015,
    "dry dipterocarp forest": 0.015,
    "ddf": 0.015,
    "ป่าเบญจพรรณ": 0.020,
    "เบญจพรรณ": 0.020,
    "mixed deciduous forest": 0.020,
    "mdf": 0.020,
    "ป่าดิบ": 0.025,
    "ป่าดิบชื้น": 0.025,
    "ป่าดิบแล้ง": 0.025,
    "ป่าดิบเขา": 0.025,
    "evergreen forest": 0.025,
    "dry evergreen forest": 0.025,
    "tropical evergreen forest": 0.025,
    "hill evergreen forest": 0.025,
    "def": 0.025,
}


@dataclass(frozen=True)
class PriceResult:
    status: str
    price_per_m3: float | None = None
    notes: str = ""


@dataclass(frozen=True)
class TQRecord:
    tq: str
    volume_m3: float
    species_name: str | None = None
    species_volume_m3: float | None = None


@dataclass(frozen=True)
class Plot:
    plot_id: str
    component_id: str
    plot_area_rai: float
    forest_type: str
    tq_records: list[TQRecord]


@dataclass(frozen=True)
class Component:
    component_id: str
    component_name: str
    component_area_rai: float
    related_plots: list[Plot]
    component_area_m2: float | None = None
    component_area_ha: float | None = None


@dataclass(frozen=True)
class ForestEconomicsSpeciesDetailRow:
    component_id: str
    component_name: str
    forest_type: str
    tq: str
    species_name: str | None
    allocated_component_area_rai: float
    plot_area_basis_rai: float
    species_volume_m3: float
    species_volume_per_rai_m3: float
    wood_loss_m3: float
    increment_rate_percent: float
    increment_rate_decimal: float
    annual_increment_m3_per_year: float
    annual_wood_value_baht: float | None
    wood_price_per_m3: float | None
    wood_value_baht: float | None
    price_status: str
    notes: str


@dataclass(frozen=True)
class ForestEconomicsDetailRow:
    component_id: str
    component_name: str
    forest_type: str
    tq: str
    allocated_component_area_rai: float
    plot_area_basis_rai: float
    volume_m3: float
    volume_per_rai_m3: float
    wood_loss_m3: float
    increment_rate_percent: float
    increment_rate_decimal: float
    annual_increment_m3_per_year: float
    annual_wood_value_baht: float | None
    wood_price_per_m3: float | None
    wood_value_baht: float | None
    price_status: str
    notes: str


@dataclass(frozen=True)
class ForestEconomicsComponentSummary:
    component_id: str
    component_name: str
    component_area_rai: float
    forest_types_detected: list[str]
    tq_detected: list[str]
    total_wood_loss_m3: float
    total_annual_increment_m3_per_year: float
    total_annual_wood_value_baht: float | None
    total_wood_value_baht: float | None
    calculation_status: str
    warnings: list[str]


@dataclass(frozen=True)
class ForestEconomicsGrandTotal:
    total_wood_loss_m3: float
    total_annual_increment_m3_per_year: float
    total_annual_wood_value_baht: float | None
    total_wood_value_baht: float | None


@dataclass(frozen=True)
class ForestEconomicsResult:
    detail_rows: list[ForestEconomicsDetailRow]
    species_detail_rows: list[ForestEconomicsSpeciesDetailRow]
    component_summaries: list[ForestEconomicsComponentSummary]
    grand_total: ForestEconomicsGrandTotal
    warnings: list[str]

    def to_dict(self) -> dict[str, object]:
        return {
            "detailRows": [asdict(row) for row in self.detail_rows],
            "speciesDetailRows": [asdict(row) for row in self.species_detail_rows],
            "componentSummaries": [asdict(row) for row in self.component_summaries],
            "grandTotal": asdict(self.grand_total),
            "warnings": list(self.warnings),
        }


def normalize_text(value: object) -> str:
    if value is None:
        return ""
    return str(value).strip()


def normalize_forest_type(value: object) -> str:
    return " ".join(normalize_text(value).lower().split())


def normalize_tq(value: object) -> str:
    text = normalize_text(value)
    if not text:
        return ""
    if re.fullmatch(r"\d+(\.\d+)?", text):
        number = float(text)
        if number.is_integer():
            return f"TQ{int(number)}"
        return f"TQ{text}"
    lowered = text.lower().replace(" ", "")
    if lowered.startswith("tq"):
        suffix = lowered[2:]
        return f"TQ{suffix.upper()}" if suffix and not suffix.isdigit() else f"TQ{suffix}"
    return text.upper()


def tq_sort_key(value: str) -> tuple[int, str]:
    match = re.match(r"^TQ(\d+(?:\.\d+)?)$", normalize_text(value), re.IGNORECASE)
    if match:
        return 0, f"{float(match.group(1)):012.4f}"
    return 1, normalize_text(value)


def get_increment_rate(forest_type: str) -> float | None:
    key = normalize_forest_type(forest_type)
    return FOREST_INCREMENT_RATE.get(key)


def default_price_lookup(_: dict[str, object]) -> PriceResult:
    return PriceResult(status="PENDING_PRICE_LOGIC", notes="price resolver not provided")


def calculate_forest_economics(
    components: list[Component],
    price_lookup=default_price_lookup,
) -> ForestEconomicsResult:
    detail_rows: list[ForestEconomicsDetailRow] = []
    species_detail_rows: list[ForestEconomicsSpeciesDetailRow] = []
    component_summaries: list[ForestEconomicsComponentSummary] = []
    warnings: list[str] = []

    for component in components:
        component_warnings: list[str] = []
        if component.component_area_rai <= 0:
            component_warnings.append(f"{component.component_name}: component area must be > 0")
        if not component.related_plots:
            component_warnings.append(f"{component.component_name}: component has no related plots")
        total_component_plot_area = sum(plot.plot_area_rai for plot in component.related_plots)
        if total_component_plot_area <= 0:
            component_warnings.append(f"{component.component_name}: total plot area basis must be > 0")
        if component_warnings:
            warnings.extend(component_warnings)
            component_summaries.append(
                ForestEconomicsComponentSummary(
                    component_id=component.component_id,
                    component_name=component.component_name,
                    component_area_rai=component.component_area_rai,
                    forest_types_detected=[],
                    tq_detected=[],
                    total_wood_loss_m3=0.0,
                    total_annual_increment_m3_per_year=0.0,
                    total_annual_wood_value_baht=None,
                    total_wood_value_baht=None,
                    calculation_status="INVALID_INPUT",
                    warnings=component_warnings,
                )
            )
            continue

        forest_type_groups: dict[str, list[Plot]] = {}
        for plot in component.related_plots:
            forest_key = normalize_text(plot.forest_type)
            forest_type_groups.setdefault(forest_key, []).append(plot)

        for forest_type, forest_plots in forest_type_groups.items():
            increment_rate = get_increment_rate(forest_type)
            if increment_rate is None:
                message = f"{component.component_name}: cannot map increment rate for forest type '{forest_type}'"
                warnings.append(message)
                component_warnings.append(message)
                continue

            forest_plot_area = sum(plot.plot_area_rai for plot in forest_plots)
            if forest_plot_area <= 0:
                message = f"{component.component_name}: forest type '{forest_type}' has invalid plot area"
                warnings.append(message)
                component_warnings.append(message)
                continue

            allocated_component_area = component.component_area_rai * (forest_plot_area / total_component_plot_area)
            tq_species_volume: dict[str, dict[str, float]] = {}
            for plot in forest_plots:
                if plot.plot_area_rai <= 0:
                    continue
                for record in plot.tq_records:
                    tq = normalize_tq(record.tq)
                    if not tq:
                        continue
                    if record.volume_m3 < 0:
                        message = f"{component.component_name}: negative volume found for {forest_type} {tq}"
                        warnings.append(message)
                        component_warnings.append(message)
                        continue
                    species_name = normalize_text(record.species_name) or "(UNSPECIFIED)"
                    species_bucket = tq_species_volume.setdefault(tq, {})
                    species_bucket[species_name] = species_bucket.get(species_name, 0.0) + float(record.volume_m3)

            for tq in sorted(tq_species_volume.keys(), key=tq_sort_key):
                species_map = tq_species_volume[tq]
                total_volume = sum(species_map.values())
                if total_volume <= 0:
                    continue
                volume_per_rai = total_volume / forest_plot_area
                tq_wood_loss = allocated_component_area * volume_per_rai
                tq_increment = tq_wood_loss * increment_rate

                aggregated_price_numerator = 0.0
                aggregated_price_denominator = 0.0
                species_statuses: list[str] = []
                species_notes: list[str] = []
                species_value_total = 0.0
                has_calculated_species = False

                for species_name, species_volume in sorted(species_map.items()):
                    species_volume_per_rai = species_volume / forest_plot_area
                    species_wood_loss = allocated_component_area * species_volume_per_rai
                    species_increment = species_wood_loss * increment_rate
                    price = price_lookup(
                        {
                            "component_name": component.component_name,
                            "forest_type": forest_type,
                            "tq": tq,
                            "species_name": None if species_name == "(UNSPECIFIED)" else species_name,
                        }
                    )
                    species_statuses.append(price.status)
                    if price.notes:
                        species_notes.append(f"{species_name}: {price.notes}")
                    wood_value = None
                    annual_wood_value = None
                    if price.status == "CALCULATED" and price.price_per_m3 is not None:
                        wood_value = species_wood_loss * price.price_per_m3
                        annual_wood_value = species_increment * price.price_per_m3
                        species_value_total += wood_value
                        aggregated_price_numerator += species_wood_loss * price.price_per_m3
                        aggregated_price_denominator += species_wood_loss
                        has_calculated_species = True
                    species_detail_rows.append(
                        ForestEconomicsSpeciesDetailRow(
                            component_id=component.component_id,
                            component_name=component.component_name,
                            forest_type=forest_type,
                            tq=tq,
                            species_name=None if species_name == "(UNSPECIFIED)" else species_name,
                            allocated_component_area_rai=allocated_component_area,
                            plot_area_basis_rai=forest_plot_area,
                            species_volume_m3=species_volume,
                            species_volume_per_rai_m3=species_volume_per_rai,
                            wood_loss_m3=species_wood_loss,
                            increment_rate_percent=increment_rate * 100.0,
                            increment_rate_decimal=increment_rate,
                            annual_increment_m3_per_year=species_increment,
                            annual_wood_value_baht=annual_wood_value,
                            wood_price_per_m3=price.price_per_m3,
                            wood_value_baht=wood_value,
                            price_status=price.status,
                            notes=price.notes,
                        )
                    )

                if not species_statuses:
                    price_status = "MISSING_PRICE"
                elif all(status == "CALCULATED" for status in species_statuses):
                    price_status = "CALCULATED"
                elif any(status == "CALCULATED" for status in species_statuses):
                    price_status = "PARTIAL_PRICE_LOGIC"
                elif all(status == "PENDING_PRICE_LOGIC" for status in species_statuses):
                    price_status = "PENDING_PRICE_LOGIC"
                else:
                    price_status = "MISSING_PRICE"

                weighted_price = (
                    aggregated_price_numerator / aggregated_price_denominator if aggregated_price_denominator > 0 else None
                )
                annual_wood_value_total = sum(
                    row.annual_wood_value_baht
                    for row in species_detail_rows
                    if row.component_id == component.component_id
                    and row.forest_type == forest_type
                    and row.tq == tq
                    and row.annual_wood_value_baht is not None
                )
                detail_rows.append(
                    ForestEconomicsDetailRow(
                        component_id=component.component_id,
                        component_name=component.component_name,
                        forest_type=forest_type,
                        tq=tq,
                        allocated_component_area_rai=allocated_component_area,
                        plot_area_basis_rai=forest_plot_area,
                        volume_m3=total_volume,
                        volume_per_rai_m3=volume_per_rai,
                        wood_loss_m3=tq_wood_loss,
                        increment_rate_percent=increment_rate * 100.0,
                        increment_rate_decimal=increment_rate,
                        annual_increment_m3_per_year=tq_increment,
                        annual_wood_value_baht=annual_wood_value_total if has_calculated_species else None,
                        wood_price_per_m3=weighted_price,
                        wood_value_baht=species_value_total if has_calculated_species else None,
                        price_status=price_status,
                        notes=" | ".join(species_notes),
                    )
                )

        component_detail_rows = [row for row in detail_rows if row.component_id == component.component_id]
        forest_types = sorted({row.forest_type for row in component_detail_rows})
        tq_values = sorted({row.tq for row in component_detail_rows}, key=tq_sort_key)
        total_wood_loss = sum(row.wood_loss_m3 for row in component_detail_rows)
        total_increment = sum(row.annual_increment_m3_per_year for row in component_detail_rows)
        calculated_annual_values = [row.annual_wood_value_baht for row in component_detail_rows if row.annual_wood_value_baht is not None]
        calculated_values = [row.wood_value_baht for row in component_detail_rows if row.wood_value_baht is not None]
        total_annual_wood_value = sum(calculated_annual_values) if calculated_annual_values else None
        total_wood_value = sum(calculated_values) if calculated_values else None
        statuses = {row.price_status for row in component_detail_rows}
        if not component_detail_rows:
            calculation_status = "NO_DETAIL_ROWS"
        elif statuses == {"CALCULATED"}:
            calculation_status = "CALCULATED"
        elif "PARTIAL_PRICE_LOGIC" in statuses or ("CALCULATED" in statuses and len(statuses) > 1):
            calculation_status = "PARTIAL_PRICE_LOGIC"
        elif statuses == {"PENDING_PRICE_LOGIC"}:
            calculation_status = "PENDING_PRICE_LOGIC"
        elif "MISSING_PRICE" in statuses:
            calculation_status = "MISSING_PRICE"
        else:
            calculation_status = "INCOMPLETE"
        component_summaries.append(
            ForestEconomicsComponentSummary(
                component_id=component.component_id,
                component_name=component.component_name,
                component_area_rai=component.component_area_rai,
                forest_types_detected=forest_types,
                tq_detected=tq_values,
                total_wood_loss_m3=total_wood_loss,
                total_annual_increment_m3_per_year=total_increment,
                total_annual_wood_value_baht=total_annual_wood_value,
                total_wood_value_baht=total_wood_value,
                calculation_status=calculation_status,
                warnings=component_warnings,
            )
        )

    grand_total = ForestEconomicsGrandTotal(
        total_wood_loss_m3=sum(row.total_wood_loss_m3 for row in component_summaries),
        total_annual_increment_m3_per_year=sum(row.total_annual_increment_m3_per_year for row in component_summaries),
        total_annual_wood_value_baht=(
            sum(row.total_annual_wood_value_baht for row in component_summaries if row.total_annual_wood_value_baht is not None)
            if any(row.total_annual_wood_value_baht is not None for row in component_summaries)
            else None
        ),
        total_wood_value_baht=(
            sum(row.total_wood_value_baht for row in component_summaries if row.total_wood_value_baht is not None)
            if any(row.total_wood_value_baht is not None for row in component_summaries)
            else None
        ),
    )
    return ForestEconomicsResult(
        detail_rows=detail_rows,
        species_detail_rows=species_detail_rows,
        component_summaries=component_summaries,
        grand_total=grand_total,
        warnings=warnings,
    )
