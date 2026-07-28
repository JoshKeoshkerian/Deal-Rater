"""Scam pattern detection (spec 6.3, build step 5).

Spec 6.3: "Flag the COMBINATION, not individual elements... Any one of these is
weak. Four together is a strong signal and should produce a distinct, prominent
warning rather than a numerical deduction buried in a composite."

Two design consequences, both structural:

1. THIS MODULE RETURNS NO SCORE. It returns which signals fired and whether the
   combination crossed the threshold. There is deliberately no
   `scam_score: float` to be quietly summed into a composite later, because the
   spec's whole point is that a buried numerical deduction is the wrong shape
   for this signal. Spec 6.3 again: "a distinct, prominent warning".

2. EVERY SIGNAL REPORTS WHETHER IT COULD BE EVALUATED AT ALL, separately from
   whether it fired. A signal that cannot be checked is not a signal that passed.

WHY THE THRESHOLD IS HARDER TO REACH THAN THE SPEC ASSUMES
----------------------------------------------------------
Spec 6.3 lists seven signals and sets the warning at four. Only five of the
seven can be evaluated with the data this product collects, and one of those is
partial:

  price far below expected, unexplained   YES
  very few photos                         PARTIAL -- count only. "Photos that
                                          appear to be stock images" needs
                                          vision, cut from the MVP in spec 11.
  minimal or templated description        YES
  VIN omitted from a detailed listing     YES
  cash-only / wire / shipping / no meet   YES
  price revised UPWARD                    NO -- needs price history, which is
                                          phase three (spec 12). `price_changed`
                                          is NULL on every observation captured.
  newly created seller account            NO, AND NEVER WILL BE. Spec 8.2
                                          explicitly forbids collecting it:
                                          "Explicitly not collected: display
                                          name, profile URL, join date, account
                                          age, profile photo, profile
                                          completeness."

That last one is a genuine tension INSIDE the spec: 6.3 names account age as a
scam signal and 8.2 forbids collecting it. 8.2 is a privacy decision listed among
the settled decisions in spec 14, so it wins, and the signal is permanently
unavailable rather than merely pending. `Signal.NEW_ACCOUNT` exists so that
absence is visible rather than forgotten.

Requiring four of five when the spec assumed four of seven makes this detector
markedly less sensitive than intended. `ScamAssessment.reduced_sensitivity`
reports that, so a quiet "no warning" is never mistaken for a clean bill.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import StrEnum

from . import params


class Signal(StrEnum):
    """The seven patterns spec 6.3 enumerates, in the order it lists them."""

    UNEXPLAINED_DEEP_DISCOUNT = "unexplained_deep_discount"
    FEW_OR_STOCK_PHOTOS = "few_or_stock_photos"
    MINIMAL_DESCRIPTION = "minimal_description"
    VIN_OMITTED_FROM_DETAILED_LISTING = "vin_omitted_from_detailed_listing"
    PAYMENT_OR_MEETING_RED_FLAGS = "payment_or_meeting_red_flags"
    PRICE_REVISED_UPWARD = "price_revised_upward"
    NEW_ACCOUNT = "new_account"


SIGNAL_TEXT: dict[Signal, str] = {
    Signal.UNEXPLAINED_DEEP_DISCOUNT: (
        "Priced far below comparable listings with no explanation in the description."
    ),
    Signal.FEW_OR_STOCK_PHOTOS: "Very few photos for a vehicle at this price.",
    Signal.MINIMAL_DESCRIPTION: "Description is minimal or looks templated.",
    Signal.VIN_OMITTED_FROM_DETAILED_LISTING: (
        "The listing is detailed in every other respect but omits the VIN."
    ),
    Signal.PAYMENT_OR_MEETING_RED_FLAGS: (
        "Payment or meeting terms that legitimate private sellers rarely ask for."
    ),
    Signal.PRICE_REVISED_UPWARD: "Asking price was revised upward, which is unusual.",
    Signal.NEW_ACCOUNT: "Seller account appears newly created.",
}


def _p(pattern: str) -> re.Pattern[str]:
    return re.compile(pattern, re.I)


#: Spec 6.3: "Cash-only or wire-transfer language, refusal to meet in person,
#: shipping offers."
_PAYMENT_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("wire transfer", _p(r"\bwire\s+(transfer|the\s+money)\b|\bwestern\s+union\b|\bmoneygram\b")),
    ("gift cards", _p(r"\bgift\s?cards?\b|\bsteam\s+card\b")),
    ("crypto", _p(r"\b(bitcoin|btc|crypto|usdt)\b")),
    ("deposit to hold", _p(r"\bdeposit\s+to\s+hold\b|\bsend\s+.{0,20}deposit\b")),
    (
        "will not meet in person",
        _p(r"\b(can'?t|cannot|won'?t|unable\s+to)\s+meet\b|\bno\s+(meet|test\s+drives?)\b"),
    ),
    (
        "ships the vehicle",
        _p(r"\b(ship|deliver)(ping|s|ed)?\s+(it\s+)?(to\s+you|nationwide|anywhere)\b"
           r"|\bshipping\s+(is\s+)?(available|included|arranged)\b"),
    ),
    (
        "third-party escrow claim",
        _p(r"\b(ebay|amazon|paypal)\s+(motors\s+)?(protection|escrow|guarantee)\b"),
    ),
    ("overseas or deployed seller", _p(r"\b(overseas|deployed|out\s+of\s+the\s+country)\b")),
)

#: An explanation for a low price. Its PRESENCE defuses the discount signal,
#: because spec 6.3's wording is "far below the expected range WITH NO
#: EXPLANATION in the description".
_EXPLANATION_PATTERNS = _p(
    r"\b(salvage|rebuilt|branded|flood|hail|no\s+title|bill\s+of\s+sale|parts?\s+only"
    r"|needs?\s+(work|repair|engine|transmission|head\s?gasket|a\s+lot)"
    r"|not\s+running|doesn'?t\s+(run|start)|won'?t\s+start|blown|knock(ing)?"
    r"|rust(ed|y)?|accident|wrecked|damage|mechanic'?s?\s+special|as[\s-]is"
    r"|check\s+engine|transmission\s+(slips|issue|problem))\b"
)


@dataclass(frozen=True)
class SignalResult:
    signal: Signal
    #: Whether the data needed to check this signal existed at all.
    evaluable: bool
    fired: bool
    #: Why it could not be evaluated, when it could not be.
    unavailable_reason: str | None = None
    detail: str | None = None


@dataclass(frozen=True)
class ScamAssessment:
    """The result of spec 6.3's combination check. Deliberately not a score."""

    results: tuple[SignalResult, ...]

    @property
    def fired(self) -> tuple[SignalResult, ...]:
        return tuple(r for r in self.results if r.fired)

    @property
    def evaluable(self) -> tuple[SignalResult, ...]:
        return tuple(r for r in self.results if r.evaluable)

    @property
    def unavailable(self) -> tuple[SignalResult, ...]:
        return tuple(r for r in self.results if not r.evaluable)

    @property
    def warn(self) -> bool:
        """Whether to show the prominent warning spec 6.3 calls for."""
        return len(self.fired) >= params.SCAM_SIGNALS_FOR_WARNING

    @property
    def reduced_sensitivity(self) -> bool:
        """True when fewer signals are checkable than the threshold assumes.

        Spec 6.3 set the threshold of four against a list of seven. With five
        evaluable, four-of-five is a much stricter bar than four-of-seven, so a
        non-warning here is weaker evidence than the spec intended.
        """
        return len(self.evaluable) < len(self.results) - 1

    def explain(self) -> list[str]:
        return [SIGNAL_TEXT[r.signal] + (f" ({r.detail})" if r.detail else "") for r in self.fired]


def assess_scam_patterns(
    *,
    description: str | None,
    photo_count: int | None,
    vin: str | None,
    price_residual: float | None,
    price_changed: bool | None = None,
) -> ScamAssessment:
    """Evaluate spec 6.3's scam signals and report the combination.

    Returns no score by design. See the module docstring.
    """
    text = description or ""
    has_text = bool(text.strip())
    results: list[SignalResult] = []

    # 1. Price far below the expected range with no explanation.
    if price_residual is None:
        results.append(
            SignalResult(
                Signal.UNEXPLAINED_DEEP_DISCOUNT,
                evaluable=False,
                fired=False,
                unavailable_reason="no expected asking price to compare against",
            )
        )
    else:
        deep = price_residual <= params.SCAM_PRICE_RESIDUAL
        explained = bool(_EXPLANATION_PATTERNS.search(text))
        results.append(
            SignalResult(
                Signal.UNEXPLAINED_DEEP_DISCOUNT,
                evaluable=True,
                fired=deep and not explained,
                detail=f"{abs(price_residual):.0%} below expected" if deep else None,
            )
        )

    # 2. Very few photos, or stock images. Count only -- stock-image detection
    #    needs vision, cut from the MVP in spec 11.
    if photo_count is None:
        results.append(
            SignalResult(
                Signal.FEW_OR_STOCK_PHOTOS,
                evaluable=False,
                fired=False,
                unavailable_reason="photo count not captured for this listing",
            )
        )
    else:
        results.append(
            SignalResult(
                Signal.FEW_OR_STOCK_PHOTOS,
                evaluable=True,
                fired=photo_count <= params.FEW_PHOTOS,
                detail=f"{photo_count} photos" if photo_count <= params.FEW_PHOTOS else None,
            )
        )

    # 3. Minimal or templated description.
    results.append(
        SignalResult(
            Signal.MINIMAL_DESCRIPTION,
            evaluable=True,
            fired=len(text.strip()) < params.SCAM_MINIMAL_DESCRIPTION_CHARS,
            detail=("no description at all" if not has_text else f"{len(text.strip())} characters"),
        )
    )

    # 4. VIN omitted despite an otherwise detailed listing. Spec 4.2: "A VIN
    #    omitted from an otherwise detailed listing is itself a mild signal."
    #    The conjunction matters -- most listings omit the VIN, so omission alone
    #    is normal rather than suspicious.
    detailed = len(text.strip()) >= params.DETAILED_DESCRIPTION_CHARS
    results.append(
        SignalResult(
            Signal.VIN_OMITTED_FROM_DETAILED_LISTING,
            evaluable=has_text,
            fired=has_text and detailed and not vin,
            unavailable_reason=None if has_text else "no description to judge detail against",
        )
    )

    # 5. Cash-only / wire / shipping / refusal to meet.
    if not has_text:
        results.append(
            SignalResult(
                Signal.PAYMENT_OR_MEETING_RED_FLAGS,
                evaluable=False,
                fired=False,
                unavailable_reason="no description to read payment terms from",
            )
        )
    else:
        hits = [label for label, pattern in _PAYMENT_PATTERNS if pattern.search(text)]
        results.append(
            SignalResult(
                Signal.PAYMENT_OR_MEETING_RED_FLAGS,
                evaluable=True,
                fired=bool(hits),
                detail=", ".join(hits) if hits else None,
            )
        )

    # 6. Price revised upward. Phase three (spec 12).
    results.append(
        SignalResult(
            Signal.PRICE_REVISED_UPWARD,
            evaluable=price_changed is not None,
            fired=False,
            unavailable_reason=(
                None
                if price_changed is not None
                else "needs price history across observations, which is phase three (spec 12)"
            ),
        )
    )

    # 7. Newly created account. Permanently unavailable by decision, not by gap.
    results.append(
        SignalResult(
            Signal.NEW_ACCOUNT,
            evaluable=False,
            fired=False,
            unavailable_reason=(
                "account age is deliberately never collected (spec 8.2 privacy decision), "
                "so this signal is permanently unavailable rather than pending"
            ),
        )
    )

    return ScamAssessment(results=tuple(results))
