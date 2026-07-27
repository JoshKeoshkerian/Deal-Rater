"""VIN validation, server side (spec 4.2).

Spec 4.2: "Validate the check digit before querying, to avoid wasting calls on
typos."

The extension already validates before transmitting (`src/shared/vin.ts`). This
is not redundant: the API is client-agnostic by design (spec 8.1.4), so any
client can post a capture, and a VIN that reaches the decoder unvalidated costs
a network round trip to learn what arithmetic answers for free.

The algorithm is the North American standard: transliterate, weight, sum,
modulo 11, compare against position 9.
"""

from __future__ import annotations

import re

#: I, O and Q are excluded from the VIN alphabet precisely because they are
#: confusable with 1 and 0.
VIN_RE = re.compile(r"^[A-HJ-NPR-Z0-9]{17}$")

_TRANSLITERATION = {
    **{str(d): d for d in range(10)},
    "A": 1, "B": 2, "C": 3, "D": 4, "E": 5, "F": 6, "G": 7, "H": 8,
    "J": 1, "K": 2, "L": 3, "M": 4, "N": 5, "P": 7, "R": 9,
    "S": 2, "T": 3, "U": 4, "V": 5, "W": 6, "X": 7, "Y": 8, "Z": 9,
}

_WEIGHTS = (8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2)

_CHECK_DIGIT_INDEX = 8


def is_valid_vin(vin: str | None) -> bool:
    """Whether `vin` is 17 valid characters with a correct check digit."""
    if not vin:
        return False
    upper = vin.strip().upper()
    if not VIN_RE.match(upper):
        return False

    total = sum(
        _TRANSLITERATION[char] * weight
        for char, weight in zip(upper, _WEIGHTS, strict=True)
    )
    remainder = total % 11
    expected = "X" if remainder == 10 else str(remainder)
    return upper[_CHECK_DIGIT_INDEX] == expected


def normalize_vin(vin: str | None) -> str | None:
    """Uppercase and strip, or None when the VIN does not validate."""
    if not vin:
        return None
    upper = vin.strip().upper()
    return upper if is_valid_vin(upper) else None
