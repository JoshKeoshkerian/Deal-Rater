"""Information completeness and title-status flags (spec 5.2, 6.2, build step 5).

Two separate readings that share a module because both are cheap derivations
from what the listing states about itself.

COMPLETENESS (spec 5.2, weight 15 in the eventual composite) is a measure of how
much the seller disclosed, NOT of how good the car is. A sparse listing from an
honest seller scores low here, and that is correct: the buyer genuinely knows
less. It is reported on its own and combined with nothing at this build step.

TITLE STATUS (spec 6.2) is a vehicle-risk flag, not a pricing input. Spec 2: "A
car with a known transmission failure mode priced low for exactly that reason is
a risky vehicle that is fairly priced." So a branded title never moves the
expected asking price -- it is surfaced beside it.

The client already detects title status from the structured field and the
description (`detectTitleStatus` in the extension), covering spec 6.2's list:
salvage, rebuilt, branded, no title, bill of sale only, parts only. This module
normalises that value and classifies its severity; it does not re-parse.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from . import params


class TitleRisk(StrEnum):
    """Severity of a stated title status."""

    #: Salvage, parts-only, no title. Spec 10 gates the LLM call behind these:
    #: "If pricing is disqualifying or the description contains a hard
    #: disqualifier (salvage, 'for parts'), return the verdict without a model
    #: call."
    DISQUALIFYING = "disqualifying"
    #: Rebuilt or otherwise branded. Sellable, materially affects value.
    BRANDED = "branded"
    CLEAN = "clean"
    #: Nothing stated. NOT the same as clean -- most listings simply do not say.
    UNSTATED = "unstated"


_TITLE_RISK: dict[str, TitleRisk] = {
    "parts_only": TitleRisk.DISQUALIFYING,
    "no_title": TitleRisk.DISQUALIFYING,
    "salvage": TitleRisk.DISQUALIFYING,
    "rebuilt": TitleRisk.BRANDED,
    "branded": TitleRisk.BRANDED,
    "clean": TitleRisk.CLEAN,
}

_TITLE_TEXT: dict[TitleRisk, str] = {
    TitleRisk.DISQUALIFYING: (
        "Title status is disqualifying for most buyers. Financing and insurance are "
        "usually harder, and resale is materially worse."
    ),
    TitleRisk.BRANDED: (
        "Title is branded. The vehicle is sellable but worth meaningfully less than a "
        "clean-title equivalent, and the comparison set may not reflect that."
    ),
    TitleRisk.CLEAN: "Seller states a clean title.",
    TitleRisk.UNSTATED: (
        "No title status stated. Most listings do not say, so this is not itself a "
        "warning -- but it is worth asking before viewing."
    ),
}


@dataclass(frozen=True)
class TitleReading:
    risk: TitleRisk
    raw: str | None

    @property
    def message(self) -> str:
        return _TITLE_TEXT[self.risk]

    @property
    def is_hard_disqualifier(self) -> bool:
        """Spec 10's LLM cost gate."""
        return self.risk is TitleRisk.DISQUALIFYING


def read_title_status(title_status: str | None) -> TitleReading:
    """Normalise and classify a stored title status.

    Captured data contains both "clean" (from description text) and "CLEAN"
    (from Facebook's structured field) for the same meaning, so casing is
    normalised here rather than at every call site.
    """
    if not title_status or not title_status.strip():
        return TitleReading(TitleRisk.UNSTATED, None)

    key = title_status.strip().lower().replace(" ", "_").replace("-", "_")
    return TitleReading(_TITLE_RISK.get(key, TitleRisk.BRANDED), title_status)


@dataclass(frozen=True)
class CompletenessReading:
    """How much the listing tells you. Not a quality judgement."""

    score: float
    present: tuple[str, ...]
    missing: tuple[str, ...]

    @property
    def message(self) -> str:
        if not self.missing:
            return "The seller disclosed everything this tool looks for."
        return "Not stated: " + ", ".join(self.missing) + "."


def assess_completeness(
    *,
    description: str | None,
    photo_count: int | None,
    mileage: int | None,
    title_status: str | None,
    vin: str | None,
    year: int | None,
    trim_text: str | None,
) -> CompletenessReading:
    """Score disclosure 0-100 across the fields a buyer needs.

    Weights are UNCALIBRATED. They rank fields by how much a buyer loses without
    them: mileage and title status change what the car is worth, whereas a VIN is
    a convenience that unlocks a free history check.
    """
    text = (description or "").strip()

    checks: list[tuple[str, bool, float]] = [
        ("mileage", mileage is not None, 22.0),
        ("title status", bool(title_status and title_status.strip()), 20.0),
        ("model year", year is not None, 10.0),
        ("trim", bool(trim_text and trim_text.strip()), 8.0),
        ("VIN", bool(vin), 12.0),
        (
            "a description",
            len(text) >= params.MINIMAL_DESCRIPTION_CHARS,
            18.0,
        ),
        ("photos", photo_count is not None and photo_count > 0, 10.0),
    ]

    score = 0.0
    present: list[str] = []
    missing: list[str] = []

    for label, ok, weight in checks:
        if ok:
            score += weight
            present.append(label)
        else:
            missing.append(label)

    # Partial credit above the minimum bar, so a thorough listing outscores a
    # barely-adequate one rather than tying with it.
    if len(text) >= params.MINIMAL_DESCRIPTION_CHARS:
        extra = min(1.0, len(text) / params.AMPLE_DESCRIPTION_CHARS)
        score += 0.0 if extra >= 1.0 else -(1.0 - extra) * 4.0
    if photo_count:
        score -= (1.0 - min(1.0, photo_count / params.AMPLE_PHOTOS)) * 6.0

    return CompletenessReading(
        score=max(0.0, min(100.0, score)),
        present=tuple(present),
        missing=tuple(missing),
    )
