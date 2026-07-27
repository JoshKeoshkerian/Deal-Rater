"""Time on market and negotiation strength (spec 6.4, build step 4).

NEGOTIATION STRENGTH IS NOT DEAL QUALITY.

Spec 6.4 opens by insisting on this: "Genuinely orthogonal to deal quality: a
slightly overpriced car that has sat 58 days is a weak deal and a strong
negotiation." So nothing here modifies a price, a pricing rating, or a
confidence level. It answers a different question -- how much room the buyer has
-- and it is reported alongside the pricing dimension, never folded into it.

Spec 6.4 also says where it belongs in the UI: "Surface this inside the brief
rather than as a third headline number, since three headline metrics is too many
for a consumer UI." `NegotiationAssessment.headline_safe` records that.

THE INTERACTION IS THE POINT
----------------------------
Spec 6.4: "Model the interaction explicitly rather than scoring price and time
independently. A car at market price sitting 45 days is a better opportunity
than the price residual alone suggests."

Two facts multiply rather than add. A listing at or above expected asking price
that has sat 45 days is not "average price, plus stale". It is a listing the
market has already seen and declined, which is information neither fact carries
alone. `_interaction_bonus` is that term, and it is the reason this module takes
the price residual as an input rather than running independently of it.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum

from . import params
from .language import LanguageReading, read_seller_language
from .seller_type import SellerTypeReading, detect_seller_type


class Leverage(StrEnum):
    """How much negotiating room the buyer has."""

    STRONG = "strong"
    MODERATE = "moderate"
    WEAK = "weak"
    #: No posted date, so time on market is unknown. Distinct from "weak":
    #: absence of evidence, not evidence of a fresh listing.
    UNKNOWN = "unknown"


@dataclass(frozen=True)
class NegotiationAssessment:
    leverage: Leverage
    #: 0-100 on the negotiation dimension ALONE. Not a deal score, and not a
    #: component of one at this build step.
    strength: float
    days_listed: int | None
    language: LanguageReading
    seller: SellerTypeReading
    #: Plain-language reasons, ordered strongest first, for the brief (spec 7.5).
    leverage_points: tuple[str, ...]
    #: Spec 6.4: negotiation belongs in the brief, not as a third headline
    #: number. Kept as data so a UI cannot accidentally promote it.
    headline_safe: bool = False
    #: Extra discount, as a fraction, that leverage justifies on top of the
    #: pricing anchor. Zero when there is no time-on-market evidence.
    extra_discount: float = 0.0
    #: Time on market ALONE, 0-100, with no seller-language contribution.
    #:
    #: Spec 5.2's composite lists "Time on market: 20" as a component, which is
    #: not the same thing as `strength`: that also folds in description phrasing,
    #: which is soft, gameable, and meaningless for a dealer. The composite gets
    #: the objective half only. None when there is no posted date.
    time_on_market_score: float | None = None

    @property
    def is_stale(self) -> bool:
        return self.days_listed is not None and self.days_listed >= params.STALE_LISTING_DAYS


def days_on_market(posted_at: datetime | None, observed_at: datetime | None) -> int | None:
    """Whole days between posting and observation, or None if unknowable."""
    if posted_at is None or observed_at is None:
        return None
    delta = observed_at - posted_at
    if delta.total_seconds() < 0:
        # A posted date in the future is a parse error, not a fresh listing.
        return None
    return int(delta.total_seconds() // 86_400)


def _time_component(days: int | None) -> tuple[float, list[str]]:
    """Strength from time on market alone, before any interaction."""
    if days is None:
        return 0.0, []

    if days >= params.VERY_STALE_LISTING_DAYS:
        return 45.0, [
            f"Listed {days} days without selling, which is most of a season at this price."
        ]
    if days >= params.STALE_LISTING_DAYS:
        return 32.0, [
            f"Listed {days} days at an unchanged price, which usually means the ask is "
            f"above what this market will pay."
        ]
    if days * 24 < params.FRESH_LISTING_HOURS:
        return 0.0, [
            "Listed within the last day, so you are competing with everyone else who "
            "just saw it. Leverage is low regardless of price."
        ]
    if days >= 14:
        return 18.0, [f"Listed {days} days, long enough that early interest has passed."]
    return 8.0, [f"Listed {days} days."]


def _interaction_bonus(days: int | None, price_residual: float | None) -> tuple[float, list[str]]:
    """The explicit price x time term required by spec 6.4.

    Fires only when BOTH hold: the listing is stale, and the ask is not below
    expected. That conjunction is the signal -- a cheap car sitting a while may
    simply not have been seen yet, whereas an at-or-above-market car sitting a
    while has been seen and passed over.
    """
    if days is None or price_residual is None:
        return 0.0, []
    if days < params.STALE_LISTING_DAYS:
        return 0.0, []
    if price_residual < params.MARKET_HAS_DECLINED_RESIDUAL:
        return 0.0, []

    return params.STALE_AND_OVERPRICED_BONUS, [
        f"Asking at or above comparable listings for {days} days. Buyers have seen this "
        f"price and passed, which is a stronger position for you than either fact alone."
    ]


def _language_component(
    reading: LanguageReading, seller: SellerTypeReading
) -> tuple[float, list[str]]:
    """Strength from seller phrasing, scored in both directions (spec 6.4)."""
    if not reading.had_text:
        return 0.0, []

    # Spec 6.4's keyword set assumes a person with a reason to sell. A dealer
    # writes "Priced to Move!" as copy, so scoring it as urgency would read a
    # sales pitch as a negotiating advantage. The phrases are still reported --
    # they are really in the text -- but they carry no weight.
    if seller.is_dealer:
        return 0.0, [
            "Seller appears to be a dealer, so description phrasing is marketing copy "
            "rather than a signal of personal motivation. Time on market is the "
            "reliable signal here."
        ]

    points: list[str] = []
    # Capped so that a description stuffed with motivated phrasing cannot swamp
    # the time signal, which is the more objective of the two.
    score = max(-20.0, min(20.0, reading.net_weight * 4.0))

    if reading.motivated:
        points.append("Seller language suggests motivation: " + ", ".join(reading.motivated) + ".")
    if reading.rigid:
        points.append("Seller signals price rigidity: " + ", ".join(reading.rigid) + ".")
    if reading.is_contradictory:
        points.append(
            "The description points both ways at once, so treat the phrasing as weak "
            "evidence and lead with time on market."
        )
    return score, points


def assess_negotiation(
    *,
    posted_at: datetime | None,
    observed_at: datetime | None,
    description: str | None,
    price_residual: float | None,
) -> NegotiationAssessment:
    """Assess negotiating position for one listing.

    `price_residual` is the target's signed residual against the expected ASKING
    price, from the pricing model. It is an input to the interaction term only;
    nothing here feeds back into the price.
    """
    days = days_on_market(posted_at, observed_at)
    reading = read_seller_language(description)

    seller = detect_seller_type(description)
    time_score, time_points = _time_component(days)
    bonus, bonus_points = _interaction_bonus(days, price_residual)
    language_score, language_points = _language_component(reading, seller)

    strength = max(0.0, min(100.0, 30.0 + time_score + bonus + language_score))

    if days is None:
        leverage = Leverage.UNKNOWN
    elif strength >= 70:
        leverage = Leverage.STRONG
    elif strength >= 45:
        leverage = Leverage.MODERATE
    else:
        leverage = Leverage.WEAK

    # Strongest evidence first: time on market is observed fact, the interaction
    # is derived from it, and seller phrasing is the softest of the three.
    points = [*bonus_points, *time_points, *language_points]

    extra = 0.0
    if days is not None:
        extra = params.MAX_EXTRA_DISCOUNT_FROM_LEVERAGE * (strength / 100.0)

    # `_time_component` tops out at 45 for a very stale listing; rescale that
    # to 0-100 so the composite can weight it against other dimensions.
    time_only = None if days is None else min(100.0, (time_score / 45.0) * 100.0)

    return NegotiationAssessment(
        leverage=leverage,
        strength=strength,
        days_listed=days,
        language=reading,
        seller=seller,
        leverage_points=tuple(points),
        extra_discount=extra,
        time_on_market_score=time_only,
    )
