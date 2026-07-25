"""Fuzzy identity key for relisting detection (spec 4.4).

Computed and stored at ingest so the data exists when the matching logic is
built in phase three. Nothing consumes it yet.

The key deliberately buckets mileage rather than using it exactly: a relisted
car accrues miles, and sellers round odometer readings differently between
posts. Buckets of 10k are coarse enough to survive that and fine enough that
two genuinely different cars rarely collide, given that year/make/model and
location must also match.

VIN, where present, is the strong key and is stored separately on `listings`.
This is only the fallback for the (large) majority of listings without one.
"""

from __future__ import annotations

import hashlib
import re

MILEAGE_BUCKET = 10_000

_NON_ALNUM = re.compile(r"[^a-z0-9]+")


def _norm(value: str | None) -> str:
    if not value:
        return ""
    return _NON_ALNUM.sub("", value.lower())


def _location_slug(location_text: str | None) -> str:
    if not location_text:
        return ""
    # "Tulsa, OK" and "Tulsa, Oklahoma" should not be different cars.
    return _norm(location_text.split(",")[0])


def compute_relisting_key(
    *,
    year: int | None,
    make: str | None,
    model: str | None,
    mileage: int | None,
    location_text: str | None,
) -> str | None:
    """Return a stable fuzzy key, or None when there is too little to match on."""
    make_n = _norm(make)
    model_n = _norm(model)

    # Year plus model is the minimum that makes a match meaningful. Without it
    # the key would collide across unrelated vehicles and be worse than absent.
    if not model_n or year is None:
        return None

    bucket = "" if mileage is None else str(mileage // MILEAGE_BUCKET)
    parts = [str(year), make_n, model_n, bucket, _location_slug(location_text)]
    return hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()
