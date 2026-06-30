from __future__ import annotations

from dataclasses import dataclass

from forest_economics import PriceResult
from forest_timber_price_data import (
    FULL_ALIAS_ROWS,
    FULL_OFFICIAL_PRICE_ROWS,
    FULL_PROXY_PRICE_ROWS,
    FULL_PROXY_SPECIES_ROWS,
)


DEFAULT_PRICE_FACTOR = 1.0
DEFAULT_TEAK_LT_6FT_PRICE = 16630.0
DEFAULT_FALLBACK_PRICE = 2450.0


def clean_species_name(value: object) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    text = text.replace(" ", "")
    text = text.replace("ไม้", "")
    return text


@dataclass(frozen=True)
class TimberPriceLookupResult:
    species_raw: str | None
    species_key: str
    quality_factor: float
    price_group: str
    price_baht_m3: float
    price_source: str
    pricing_notes: str
    economic_value_baht: float | None

    def to_price_result(self) -> PriceResult:
        return PriceResult(
            status="CALCULATED",
            price_per_m3=self.price_baht_m3,
            notes=self.pricing_notes,
        )


class TimberPriceResolver:
    def __init__(
        self,
        alias_map: dict[str, str],
        official_price_map: dict[str, tuple[str, float]],
        proxy_price_map: dict[str, float],
        proxy_species_map: dict[str, str],
    ) -> None:
        self.alias_map = alias_map
        self.official_price_map = official_price_map
        self.proxy_price_map = proxy_price_map
        self.proxy_species_map = proxy_species_map

    @classmethod
    def default(cls) -> "TimberPriceResolver":
        return cls(
            alias_map={
                clean_species_name(raw_name): clean_species_name(canonical_name)
                for raw_name, canonical_name in FULL_ALIAS_ROWS
            },
            official_price_map={
                clean_species_name(species_key): (str(price_group), float(price_baht_m3))
                for species_key, price_group, price_baht_m3 in FULL_OFFICIAL_PRICE_ROWS
            },
            proxy_price_map={
                str(proxy_code): float(proxy_price_baht_m3)
                for proxy_code, _proxy_group, proxy_price_baht_m3 in FULL_PROXY_PRICE_ROWS
            },
            proxy_species_map={
                clean_species_name(species_key): str(proxy_code)
                for species_key, proxy_code in FULL_PROXY_SPECIES_ROWS
            },
        )

    def normalize_species_key(self, species_raw: object) -> str:
        raw_key = clean_species_name(species_raw)
        if not raw_key:
            return ""
        return self.alias_map.get(raw_key, raw_key)

    def lookup(
        self,
        species_raw: object,
        volume_m3: float | None = None,
        quality_factor: float = DEFAULT_PRICE_FACTOR,
    ) -> TimberPriceLookupResult:
        species_key = self.normalize_species_key(species_raw)
        if species_key == clean_species_name("สัก"):
            price_group = "A"
            price_baht_m3 = DEFAULT_TEAK_LT_6FT_PRICE
            price_source = "official_AB"
            pricing_notes = "default_teak_lt_6ft_assumption"
        elif species_key in self.official_price_map:
            price_group, price_baht_m3 = self.official_price_map[species_key]
            price_source = "official_AB"
            pricing_notes = "matched_official_ab"
        else:
            proxy_code = self.proxy_species_map.get(species_key)
            if proxy_code and proxy_code in self.proxy_price_map:
                price_group = proxy_code
                price_baht_m3 = self.proxy_price_map[proxy_code]
                price_source = "proxy_C"
                pricing_notes = f"matched_proxy_{proxy_code.lower()}"
            else:
                price_group = "C6"
                price_baht_m3 = DEFAULT_FALLBACK_PRICE
                price_source = "assumed_lowest_proxy"
                pricing_notes = "assumed_lowest_proxy"

        economic_value = None
        if volume_m3 is not None:
            economic_value = float(volume_m3) * float(price_baht_m3) * float(quality_factor)
        return TimberPriceLookupResult(
            species_raw=None if species_raw is None else str(species_raw),
            species_key=species_key,
            quality_factor=float(quality_factor),
            price_group=price_group,
            price_baht_m3=float(price_baht_m3),
            price_source=price_source,
            pricing_notes=pricing_notes,
            economic_value_baht=economic_value,
        )


_DEFAULT_RESOLVER = TimberPriceResolver.default()


def resolve_timber_price(
    species_name: object,
    volume_m3: float | None = None,
    quality_factor: float = DEFAULT_PRICE_FACTOR,
) -> TimberPriceLookupResult:
    return _DEFAULT_RESOLVER.lookup(
        species_raw=species_name,
        volume_m3=volume_m3,
        quality_factor=quality_factor,
    )


def timber_price_lookup(payload: dict[str, object]) -> PriceResult:
    result = resolve_timber_price(
        species_name=payload.get("species_name"),
        quality_factor=float(payload.get("quality_factor", DEFAULT_PRICE_FACTOR)),
    )
    return result.to_price_result()
