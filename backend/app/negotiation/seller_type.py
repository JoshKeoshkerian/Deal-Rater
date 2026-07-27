"""Dealer detection from listing text (spec 4.3, spec 6.3).

WHY THIS IS HERE AT STEP 4
--------------------------
It was not planned for this step. It became necessary because of what the
captured data turned out to contain: FOUR OF FIVE target listings with a
description are dealers, not private sellers.

  capture 1  "SPECIAL OFFER FREE 3 MONTHS/3,000 MILES LIMITED WARRANTY"
  capture 2  "Dealership: DriveNation / Financing Available / Trade-Ins Welcome"
  capture 4  "go see it on our site! We only sell clean title... back them with
              a warranty"
  capture 5  "Finance special available"

Only capture 3 reads like a person selling their own car.

That matters for step 4 specifically, because spec 6.4's seller-language signal
assumes a person: "moving", "inherited", "wife says sell". A dealer writes
"Priced to Move!" as marketing copy, and reading it as urgency would invert the
signal -- treating a sales pitch as a negotiating advantage.

WHAT THIS DOES NOT SOLVE
------------------------
Spec 6.3: "The more valuable use of this signal is comp hygiene, filtering
dealers out of the comp set, which matters more to accuracy than the trust
penalty on the target listing."

That remains BLOCKED. Comp cards carry no description and no seller listing
count, so there is nothing to run this against. This detects a dealer on the
TARGET only, which is the less valuable half. See `app/pricing/comps.py`.

Full seller-type handling, including the hashed-profile listing count, is spec
6.3 and build step 5.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import StrEnum


class SellerType(StrEnum):
    DEALER = "dealer"
    #: No dealer markers found. Deliberately not called "private": absence of
    #: boilerplate is weak evidence, and a dealer posting a bare listing looks
    #: identical to a person posting one.
    NO_DEALER_MARKERS = "no_dealer_markers"
    #: No description to read at all.
    UNKNOWN = "unknown"


def _p(pattern: str) -> re.Pattern[str]:
    return re.compile(pattern, re.I)


#: Decisive on their own. A person selling their own car does not run a finance
#: special, take trade-ins, or refer you to their inventory. Requiring a second
#: marker alongside these missed a real dealer in captured data: capture 5's
#: "Finance special available" was its only hit.
_DECISIVE_MARKERS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("names a dealership", _p(r"\bdealership\b|\bauto\s+(sales|group|mall)\b|\bmotors\b")),
    (
        "offers financing",
        _p(r"\bfinanc(e|ing)\s+(special|available|options?)\b|\bwe\s+financ|\bapr\b"
           r"|\bmonthly\s+payments?\b|\bbad\s+credit\b"),
    ),
    ("accepts trade-ins", _p(r"\btrade[\s-]?ins?\s+(welcome|accepted)\b|\btrade\s+value\b")),
    ("refers to its own inventory", _p(r"\bour\s+(site|website|lot|inventory)\b|\bvisit\s+us\b")),
    ("advertises a stock number", _p(r"\bstock\s*#")),
    ("offers a buyback", _p(r"\bbuyback\b")),
    ("mentions doc or dealer fees", _p(r"\bdoc(ument(ation)?)?\s+fee\b|\bdealer\s+fee\b")),
)

#: Suggestive but not decisive; two are required. A private seller can
#: legitimately mention remaining factory warranty, or that they have a CARFAX.
#: Excluding them on one of these would misclassify exactly the listings this
#: product exists to evaluate.
_SUPPORTING_MARKERS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("mentions a warranty", _p(r"\bwarranty\b|\bservice\s+contract\b")),
    (
        "speaks as a business",
        _p(r"\bwe\s+(only\s+)?(sell|offer|have|stock|back)\b|\bour\s+vehicles\b"),
    ),
    ("offers CARFAX on request", _p(r"\bcarfax\s+available\b")),
    ("advertises more inventory", _p(r"\bmore\s+(photos|inventory)\s+available\b")),
    ("mentions credit or financing", _p(r"\bfinanc(e|ing)\b|\bcredit\b")),
)


@dataclass(frozen=True)
class SellerTypeReading:
    seller_type: SellerType
    markers: tuple[str, ...]

    @property
    def is_dealer(self) -> bool:
        return self.seller_type is SellerType.DEALER


def detect_seller_type(description: str | None) -> SellerTypeReading:
    """Classify the seller from description boilerplate.

    One decisive marker, or two supporting ones. The asymmetry is deliberate:
    false positives cost a real private-party listing -- the case the product
    exists for -- while false negatives only mean a dealer's marketing copy is
    read as if a person wrote it.
    """
    if not description or not description.strip():
        return SellerTypeReading(SellerType.UNKNOWN, ())

    decisive = tuple(
        label for label, pattern in _DECISIVE_MARKERS if pattern.search(description)
    )
    supporting = tuple(
        label for label, pattern in _SUPPORTING_MARKERS if pattern.search(description)
    )
    found = decisive + supporting

    if decisive or len(supporting) >= 2:
        return SellerTypeReading(SellerType.DEALER, found)
    return SellerTypeReading(SellerType.NO_DEALER_MARKERS, found)
