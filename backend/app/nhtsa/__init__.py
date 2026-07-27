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


def _us_market_trim(decoded: str) -> str:
    """The US-market half of a vPIC trim that names regional variants.

    vPIC writes a model sold under two names as "Touring/GS" (US/Canada) or
    "Sport/GX", with the US name first. Left whole, that tokenises to
    {touring, gs} and never matches a listing's "Touring" -- a mismatch caused
    entirely by how the decode is spelled rather than by the cars differing,
    which is the failure mode `enrich_target` exists to avoid.

    Splits only when the tail is a SINGLE alphanumeric word, which is what a
    regional alternate name looks like -- "Touring/GS", "Grand Touring/GT".
    A slash inside one longer description does not split: "S 4dr/AWD Sport"
    is one trim written awkwardly, not two names for the same car, and
    truncating it at the slash would invent a trim that does not exist.
    """
    head, sep, tail = decoded.partition("/")
    if not sep:
        return decoded
    head, tail = head.strip(), tail.strip()
    if head and tail.isalnum():
        return head
    return decoded


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

    REACH IS SMALL, and worth stating so this is not mistaken for a fix to the
    trim problem generally. It fires only when a listing supplies a VIN AND
    states no trim -- roughly 1 listing in 300 carries a VIN at all, and ~90%
    of targets already state something. It removes a specific gap; it does not
    move the average case.

    A KNOWN RESIDUAL MISMATCH: vPIC sometimes describes a trim by drivetrain
    branding where listings describe it by engine ("quattro Premium Plus"
    against "2.0T Premium Plus"). Those still read as different trims. Closing
    that needs a per-make trim vocabulary, which is not worth building until
    comps carry VINs and both sides can be decoded the same way.
    """
    if spec is None or not spec.clean_decode or not spec.trim:
        return target
    if target.trim_text and target.trim_text.strip():
        return target

    from dataclasses import replace

    return replace(target, trim_text=_us_market_trim(spec.trim))
