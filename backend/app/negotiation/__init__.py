"""Time on market and negotiation strength (spec 6.4, build step 4).

A separate package from `app.pricing` because spec 6 requires the dimensions be
separated, and spec 6.4 calls negotiation "genuinely orthogonal to deal
quality". Nothing here reads or writes a price.

    params.py     thresholds, all UNCALIBRATED
    language.py   seller phrasing, scored in opposing directions
    strength.py   time on market, the price x time interaction, leverage
    seller_type.py  dealer detection, because 4 of 5 captured targets are dealers
"""

from .language import Direction, LanguageReading, LanguageSignal, read_seller_language
from .seller_type import SellerType, SellerTypeReading, detect_seller_type
from .strength import (
    Leverage,
    NegotiationAssessment,
    assess_negotiation,
    days_on_market,
)

__all__ = [
    "Direction",
    "LanguageReading",
    "LanguageSignal",
    "Leverage",
    "NegotiationAssessment",
    "SellerType",
    "SellerTypeReading",
    "assess_negotiation",
    "days_on_market",
    "detect_seller_type",
    "read_seller_language",
]
