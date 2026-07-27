"""NHTSA vPIC and safety data (spec 4.2, 6.2, build step 6).

    vin.py         check-digit validation, so typos never cost a request
    client.py      cached access to vPIC, recalls and complaints
    assessment.py  spec 6.2's vehicle-risk reading

Spec 13.6 states step 6's purpose precisely: "NHTSA integration; feed decoded
trim back into comp matching." The decode is worth more to the pricing model
than to the risk section, because it supplies the trim, drivetrain and
transmission that text parsing cannot -- 7% and 0% available respectively from
listing text. `enrich_target` is that feedback path.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from ..pricing.comps import CompCandidate
from .assessment import (
    COMPLAINT_CAVEAT,
    RECALL_CAVEAT,
    DecodedSpec,
    VehicleRiskAssessment,
    build_assessment,
)
from .client import decode_vin, lookup_vehicle_safety
from .vin import is_valid_vin, normalize_vin

__all__ = [
    "COMPLAINT_CAVEAT",
    "RECALL_CAVEAT",
    "DecodedSpec",
    "VehicleRiskAssessment",
    "assess_vehicle",
    "build_assessment",
    "decode_vin",
    "enrich_target",
    "is_valid_vin",
    "lookup_vehicle_safety",
    "normalize_vin",
]


def assess_vehicle(
    session: Session,
    *,
    vin: str | None,
    year: int | None,
    make: str | None,
    model: str | None,
    offline: bool = False,
) -> VehicleRiskAssessment:
    """Spec 6.2's vehicle-risk reading for one listing.

    The two halves have very different reach. The decode needs a VIN, which
    roughly 1 listing in 300 supplies. Recalls and complaints need only
    year/make/model, so they apply to essentially every listing -- which is why
    spec 6.2 lists complaint density as a separate bullet with "(no VIN
    required)" attached to it.
    """
    decode = decode_vin(session, vin, offline=offline)
    safety = lookup_vehicle_safety(
        session, year=year, make=make, model=model, offline=offline
    )
    return build_assessment(decode, safety)


def enrich_target(target: CompCandidate, spec: DecodedSpec | None) -> CompCandidate:
    """Fold a VIN decode back into the comp-matching candidate (spec 13.6).

    Only the trim is written, and only when the listing text did not already
    state one. Two reasons for that restraint:

      The decode is authoritative about the FACTORY specification, so it
      overwriting a seller's stated trim would be right in principle -- but a
      comp set's trims all come from listing text, and replacing one side of a
      comparison with a differently-sourced value makes matches fail for
      spelling reasons rather than real ones. Until comps carry VINs too, the
      two sides must be described the same way.

      Drivetrain and transmission are deliberately NOT written back. They are
      already parsed opportunistically from text in `comps.py`, where they are
      recorded and never filtered on, because they are 7% and 0% populated
      across comps. Supplying them for the target alone would not make them
      comparable; it would just make the target look better specified than
      everything it is measured against.
    """
    if spec is None or not spec.clean_decode or not spec.trim:
        return target
    if target.trim_text and target.trim_text.strip():
        return target

    from dataclasses import replace

    return replace(target, trim_text=spec.trim)
