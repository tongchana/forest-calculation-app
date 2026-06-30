from __future__ import annotations

from dataclasses import asdict, dataclass


DEFAULT_INTEREST_RATE = 0.01
DEFAULT_PERIODS_YEARS = [1, 10, 20, 30, 40, 50]


@dataclass(frozen=True)
class FutureValuePeriodRow:
    period_years: int
    annual_wood_value_baht: float
    interest_rate: float
    future_value_baht: float
    present_value_baht: float


@dataclass(frozen=True)
class FutureValueComponentSummary:
    component_id: str
    component_name: str
    annual_wood_value_baht: float
    period_rows: list[FutureValuePeriodRow]


@dataclass(frozen=True)
class WoodFutureValueResult:
    annual_wood_value_baht: float | None
    interest_rate: float
    periods_years: list[int]
    period_rows: list[FutureValuePeriodRow]
    component_summaries: list[FutureValueComponentSummary]
    warnings: list[str]

    def to_dict(self) -> dict[str, object]:
        return {
            "annualWoodValueBaht": self.annual_wood_value_baht,
            "interestRate": self.interest_rate,
            "periodsYears": list(self.periods_years),
            "periodRows": [asdict(row) for row in self.period_rows],
            "componentSummaries": [
                {
                    "component_id": summary.component_id,
                    "component_name": summary.component_name,
                    "annual_wood_value_baht": summary.annual_wood_value_baht,
                    "period_rows": [asdict(row) for row in summary.period_rows],
                }
                for summary in self.component_summaries
            ],
            "warnings": list(self.warnings),
        }


def validate_future_value_inputs(
    annual_wood_value_baht: float | None,
    interest_rate: float,
    periods_years: list[int],
) -> list[str]:
    warnings: list[str] = []
    if annual_wood_value_baht is None:
        warnings.append("Missing annual wood value. Please run annual increment value calculation first.")
    elif annual_wood_value_baht < 0:
        warnings.append("annual_wood_value_baht must be >= 0")
    if interest_rate < 0:
        warnings.append("interest_rate must be >= 0")
    if not periods_years:
        warnings.append("periods_years must not be empty")
    elif any(period <= 0 for period in periods_years):
        warnings.append("each periods_years entry must be > 0")
    return warnings


def calculate_future_value_period(
    annual_wood_value_baht: float,
    interest_rate: float,
    period_years: int,
) -> FutureValuePeriodRow:
    if interest_rate == 0:
        future_value = annual_wood_value_baht * period_years
        present_value = future_value
    else:
        future_value = annual_wood_value_baht * (((1 + interest_rate) ** period_years - 1) / interest_rate)
        present_value = future_value / ((1 + interest_rate) ** period_years)
    return FutureValuePeriodRow(
        period_years=period_years,
        annual_wood_value_baht=annual_wood_value_baht,
        interest_rate=interest_rate,
        future_value_baht=future_value,
        present_value_baht=present_value,
    )


def calculate_wood_future_value(
    annual_wood_value_baht: float | None,
    interest_rate: float = DEFAULT_INTEREST_RATE,
    periods_years: list[int] | None = None,
    component_annual_values: list[dict[str, object]] | None = None,
) -> WoodFutureValueResult:
    periods = list(periods_years or DEFAULT_PERIODS_YEARS)
    warnings = validate_future_value_inputs(annual_wood_value_baht, interest_rate, periods)
    if warnings:
        return WoodFutureValueResult(
            annual_wood_value_baht=annual_wood_value_baht,
            interest_rate=interest_rate,
            periods_years=periods,
            period_rows=[],
            component_summaries=[],
            warnings=warnings,
        )

    assert annual_wood_value_baht is not None
    period_rows = [
        calculate_future_value_period(
            annual_wood_value_baht=annual_wood_value_baht,
            interest_rate=interest_rate,
            period_years=period,
        )
        for period in periods
    ]
    component_summaries: list[FutureValueComponentSummary] = []
    for item in component_annual_values or []:
        component_value = item.get("annual_wood_value_baht")
        if component_value is None:
            continue
        component_rows = [
            calculate_future_value_period(
                annual_wood_value_baht=float(component_value),
                interest_rate=interest_rate,
                period_years=period,
            )
            for period in periods
        ]
        component_summaries.append(
            FutureValueComponentSummary(
                component_id=str(item.get("component_id") or ""),
                component_name=str(item.get("component_name") or ""),
                annual_wood_value_baht=float(component_value),
                period_rows=component_rows,
            )
        )
    return WoodFutureValueResult(
        annual_wood_value_baht=annual_wood_value_baht,
        interest_rate=interest_rate,
        periods_years=periods,
        period_rows=period_rows,
        component_summaries=component_summaries,
        warnings=[],
    )
