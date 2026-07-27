"""Spec 10's deterministic gate on the paid call.

    "Gate the LLM call behind deterministic checks. If pricing is disqualifying
    or the description contains a hard disqualifier (salvage, 'for parts'),
    return the verdict without a model call."

Pure functions over already-computed readings. Nothing here touches the network,
the database or the settings, so every skip reason is testable on its own and
the cost control can be reasoned about without running an evaluation.

The reason strings are USER-FACING. Spec 10 says "return the verdict without a
model call" -- the verdict, not a blank. A buyer who sees nothing under "what to
check on this car" learns nothing; one who sees "the stated title is
disqualifying, which answers the question on its own" learns why the section is
empty and that the emptiness is deliberate.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..flags.completeness import TitleReading
from . import params


@dataclass(frozen=True)
class GateDecision:
    """Whether to spend a model call, and if not, what to say instead."""

    allowed: bool
    #: None when allowed. Otherwise the verdict shown in place of the section.
    reason: str | None = None
    #: Short machine-readable tag for cost telemetry, e.g. "hard_disqualifier".
    code: str | None = None

    @classmethod
    def allow(cls) -> GateDecision:
        return cls(allowed=True)

    @classmethod
    def skip(cls, code: str, reason: str) -> GateDecision:
        return cls(allowed=False, reason=reason, code=code)


def find_disqualifier(description: str | None) -> str | None:
    """The first hard-disqualifier phrase in the description, if any."""
    if not description:
        return None
    haystack = description.lower()
    for phrase in params.HARD_DISQUALIFIER_PHRASES:
        if phrase in haystack:
            return phrase
    return None


def evaluate_gate(
    *,
    title: TitleReading,
    description: str | None,
    pricing_band: str | None,
    year: int | None,
    make: str | None,
    model: str | None,
) -> GateDecision:
    """Decide whether this listing earns a model call.

    Ordered cheapest-signal-first among the deterministic checks, but the real
    ordering rule is that the DISQUALIFIERS are tested before the data
    requirements. A salvage-title listing with a missing make should report the
    salvage title, not "insufficient vehicle data" -- the first is the answer,
    the second is a shrug.
    """
    if title.is_hard_disqualifier:
        return GateDecision.skip(
            "title_disqualifier",
            "Skipped: the stated title status is disqualifying for most buyers, "
            "which answers the question on its own. Model-specific maintenance "
            "advice would not change that verdict.",
        )

    phrase = find_disqualifier(description)
    if phrase is not None:
        return GateDecision.skip(
            "hard_disqualifier",
            f'Skipped: the description says "{phrase}". That is the verdict for a '
            "buyer looking for a car to drive, and no amount of maintenance "
            "context changes it.",
        )

    if pricing_band in params.DISQUALIFYING_PRICING_BANDS:
        return GateDecision.skip(
            "pricing_disqualifier",
            "Skipped: the ask is so far below comparable listings, with nothing in "
            "the description explaining why, that establishing the reason comes "
            "before anything else about the model.",
        )

    if year is None or not make or not model:
        return GateDecision.skip(
            "insufficient_vehicle_data",
            "Not available: the listing does not identify the vehicle precisely "
            "enough (year, make and model are all required) to say what fails on "
            "it.",
        )

    return GateDecision.allow()
