"""Wire contract for capture ingestion.

This module is deliberately client-agnostic (spec 8.1.4). It describes a
listing observation and the comps observed alongside it. Nothing here knows
that a browser extension exists; a paste-a-URL web client posts the same shape.
"""

from __future__ import annotations

import re
from datetime import datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

Role = Literal["target", "comp"]
Scope = Literal["target", "comp_card", "comp_search"]
IssueStatus = Literal["missing", "unparsed", "suspect"]
Expectation = Literal["required", "expected", "optional"]
MileageUnit = Literal["mi", "km"]

# 17 characters, I/O/Q excluded (spec 4.2).
VIN_RE = re.compile(r"^[A-HJ-NPR-Z0-9]{17}$")
SHA256_HEX_RE = re.compile(r"^[0-9a-f]{64}$")

# Loose upper bound; a model year can lead the calendar year.
MIN_MODEL_YEAR = 1900
MAX_MODEL_YEAR = 2100


class ClientInfo(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Annotated[str, Field(max_length=64)]
    version: Annotated[str, Field(max_length=32)]


class SellerIn(BaseModel):
    """Spec 8.2: a hashed identifier plus reputation NUMBERS, never identity.

    `rating_average`/`rating_count` are the star rating Marketplace already
    renders on the listing page itself -- exempt from the "never collected"
    list (display name, profile URL, photo, join date) the same way
    `active_vehicle_listing_count` already was, because a number is not
    identity."""

    model_config = ConfigDict(extra="forbid")

    seller_hash: str
    hash_version: Annotated[int, Field(ge=1, le=32767)]
    active_vehicle_listing_count: Annotated[int | None, Field(ge=0, le=10_000)] = None
    rating_average: Annotated[float | None, Field(ge=0, le=5)] = None
    rating_count: Annotated[int | None, Field(ge=0, le=1_000_000)] = None

    @field_validator("seller_hash")
    @classmethod
    def _hex_sha256(cls, v: str) -> str:
        v = v.strip().lower()
        if not SHA256_HEX_RE.match(v):
            raise ValueError("seller_hash must be 64 lowercase hex characters (sha-256)")
        return v


class ObservationIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: Annotated[str, Field(max_length=64)] = "facebook_marketplace"
    source_listing_id: Annotated[str, Field(min_length=1, max_length=128)]
    listing_url: Annotated[str | None, Field(max_length=2048)] = None
    role: Role

    price_cents: Annotated[int | None, Field(ge=0, le=1_000_000_000)] = None
    currency: Annotated[str | None, Field(max_length=8)] = None
    mileage: Annotated[int | None, Field(ge=0, le=5_000_000)] = None
    mileage_unit: MileageUnit | None = None
    year: Annotated[int | None, Field(ge=MIN_MODEL_YEAR, le=MAX_MODEL_YEAR)] = None
    make: Annotated[str | None, Field(max_length=64)] = None
    model: Annotated[str | None, Field(max_length=128)] = None
    trim_text: Annotated[str | None, Field(max_length=128)] = None
    #: Which tier produced `trim_text`. Free text rather than an enum: an
    #: unrecognised value from a newer client should not 422 a whole capture,
    #: and the column is descriptive rather than something scoring branches on.
    trim_source: Annotated[str | None, Field(max_length=16)] = None
    #: Marketplace's own PRIVATE_SELLER / DEALER (spec 4.3's dealer exclusion).
    seller_type: Annotated[str | None, Field(max_length=32)] = None
    transmission: Annotated[str | None, Field(max_length=32)] = None
    title_status: Annotated[str | None, Field(max_length=32)] = None
    #: Marketplace's "About this vehicle" owner-count field: ONE / TWO /
    #: THREE_PLUS. Free text rather than an enum for the same reason as
    #: `trim_source` -- an unrecognised value from a newer client should not
    #: 422 a whole capture.
    owner_count: Annotated[str | None, Field(max_length=16)] = None
    description: Annotated[str | None, Field(max_length=20_000)] = None
    photo_count: Annotated[int | None, Field(ge=0, le=1000)] = None
    posted_at: datetime | None = None
    posted_relative_text: Annotated[str | None, Field(max_length=64)] = None
    price_changed: bool | None = None
    location_text: Annotated[str | None, Field(max_length=255)] = None
    latitude: Annotated[Decimal | None, Field(ge=-90, le=90)] = None
    longitude: Annotated[Decimal | None, Field(ge=-180, le=180)] = None
    vin: str | None = None

    seller: SellerIn | None = None

    field_strategies: dict[str, str] = Field(default_factory=dict)
    raw_extract: dict | None = None

    @field_validator("vin")
    @classmethod
    def _vin_shape(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip().upper()
        if not VIN_RE.match(v):
            raise ValueError("vin must be 17 characters excluding I, O and Q")
        return v

    @field_validator(
        "make",
        "model",
        "trim_text",
        "location_text",
        "title_status",
        "trim_source",
        "seller_type",
        "transmission",
        "owner_count",
    )
    @classmethod
    def _blank_to_none(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        return v or None


class ExtractionIssueIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scope: Scope
    field_name: Annotated[str, Field(max_length=64)]
    status: IssueStatus
    expectation: Expectation
    strategies_attempted: list[Annotated[str, Field(max_length=64)]] = Field(default_factory=list)
    page_signature: Annotated[str | None, Field(max_length=64)] = None


class CaptureMeta(BaseModel):
    model_config = ConfigDict(extra="forbid")

    client_capture_id: str
    captured_at: datetime
    comp_search_query: dict | None = None


class CaptureIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    client: ClientInfo
    capture: CaptureMeta
    target: ObservationIn
    comps: list[ObservationIn] = Field(default_factory=list)
    extraction_report: list[ExtractionIssueIn] = Field(default_factory=list)

    @field_validator("target")
    @classmethod
    def _target_role(cls, v: ObservationIn) -> ObservationIn:
        if v.role != "target":
            raise ValueError("target observation must have role 'target'")
        return v

    @field_validator("comps")
    @classmethod
    def _comp_roles(cls, v: list[ObservationIn]) -> list[ObservationIn]:
        for c in v:
            if c.role != "comp":
                raise ValueError("comp observations must have role 'comp'")
        return v


class CaptureOut(BaseModel):
    capture_id: int
    client_capture_id: str
    duplicate: bool
    listings_ingested: int
    observations_written: int
    extraction_reports_written: int
    extraction_ok: bool


class FieldHealth(BaseModel):
    field_name: str
    role: Role
    observed: int
    populated: int
    fill_rate: float


class StrategyMix(BaseModel):
    field_name: str
    strategy: str
    count: int


class IssueCount(BaseModel):
    field_name: str
    scope: Scope
    status: IssueStatus
    expectation: Expectation
    count: int


class ExtractionHealthOut(BaseModel):
    since: datetime
    captures: int
    captures_with_issues: int
    fields: list[FieldHealth]
    strategy_mix: list[StrategyMix]
    issues: list[IssueCount]


# ---------------------------------------------------------------------------
# Evaluation (spec 7, build step 8)
# ---------------------------------------------------------------------------


class ScoreComponentOut(BaseModel):
    """One dimension behind the headline score.

    Spec 5.2: the composite "is a summary of the separated dimensions... not a
    replacement for them, and the UI should always show the breakdown alongside
    it." These ship with every evaluation so a renderer cannot show the number
    without having been handed the parts.
    """

    name: str
    weight: float
    value: float | None
    unavailable_reason: str | None


class DealScoreOut(BaseModel):
    score: float | None
    components: list[ScoreComponentOut]
    coverage: float
    suppressed_reason: str | None
    #: Spec 9: "present output as a beta signal, not an authoritative rating."
    beta: bool


class PricingOut(BaseModel):
    """Spec 5.1's four numbers. Every figure is an ASKING price (spec 4.5)."""

    ask_cents: int | None
    expected_asking_cents: int | None
    asking_interval_low_cents: int | None
    asking_interval_high_cents: int | None
    interval_coverage: float
    strong_offer_cents: int | None
    walk_away_above_cents: int | None
    residual_fraction: float | None
    rating: float | None
    rating_band: str | None
    rating_calibrated: bool
    estimator: str
    comps_included: int
    comps_with_mileage: int
    #: Above the default when progressive widening ran (spec 4.3).
    year_window: int
    year_window_widened: bool
    confidence: str
    confidence_reasons: list[str]
    #: The same limiters as machine-readable codes, in the same order.
    #:
    #: `confidence_reasons` is prose in append order, and the first entries are
    #: the structural limiters that fire on EVERY evaluation (no recency
    #: weighting, dealer filtering unavailable). A UI that leads with "the two
    #: biggest problems with this comp set" has to rank them by what they mean,
    #: which it cannot do from sentences.
    confidence_limiters: list[str]
    fallback_reasons: list[str]


class VehicleDetailsOut(BaseModel):
    """The target listing's stated facts, read straight off the capture.

    Separate from `VehicleRiskOut`: these are what the seller SAID (a fact),
    not a judgement about what those facts mean -- `title_status` here is the
    seller's own word ("Clean", "Rebuilt"), while `VehicleRiskOut.title_risk`
    is the graded reading of it.
    """

    year: int | None
    make: str | None
    model: str | None
    mileage: int | None
    title_status: str | None
    #: "private_party" / "dealer", normalised from Facebook's own
    #: `vehicle_seller_type` field (`PRIVATE_SELLER` / `DEALER`) -- see
    #: `serialize.py`'s `_seller_type_label`. None when Facebook did not state
    #: it, which is common enough that this must not be read as "private".
    seller_type: str | None
    #: "one" / "two" / "three_plus", normalised from Facebook's own
    #: `vehicle_number_of_owners` field -- see `serialize.py`'s
    #: `_owner_count_label`. None when Facebook did not state it.
    owner_count: str | None


class CompletenessOut(BaseModel):
    """Spec 5.2's information-completeness dimension, made legible.

    `present`/`missing` are the exact fields `flags/completeness.py` checks,
    in the same order it checks them -- not a quality judgement, a disclosure
    one. A sparse listing from an honest seller scores low here on purpose.
    """

    present: list[str]
    missing: list[str]


class VehicleRiskOut(BaseModel):
    title_risk: str
    title_message: str
    decoded_spec: str | None
    recall_count: int | None
    complaint_count: int | None
    top_complaint_components: list[tuple[str, int]]
    #: Split so a UI can put open-recall prose and complaint-density prose in
    #: separate places (spec 6.2 groups them together; the overlay's Risk
    #: section gives them their own subsections) without parsing sentences
    #: back apart from one combined list.
    recall_messages: list[str]
    complaint_messages: list[str]


class SellerRiskOut(BaseModel):
    """Spec 7.4: present only when there is something to say."""

    seller_type: str
    dealer_markers: list[str]
    scam_warning: bool
    scam_signals_fired: list[str]
    scam_signals_evaluable: int
    scam_signals_total: int
    scam_reduced_sensitivity: bool
    seller_rating_average: float | None = None
    seller_rating_count: int | None = None
    messages: list[str]


class OfferOut(BaseModel):
    """Spec 7.5's offer, as three figures rather than one (`negotiation/offer.py`).

    `basis` is load-bearing, not metadata: "comps" means the figures come from an
    expected asking price the comp set supported, and "ask" means they come from
    time on market and seller wording alone. Those are different claims of
    different strength, and a UI that prints them identically is misrepresenting
    one of them. `walk_away_cents` is null on an "ask" plan for the same reason --
    walking away is a statement about value, and there is no value estimate under
    an ask-anchored plan.
    """

    stance: str
    basis: str
    opening_cents: int | None
    target_cents: int | None
    walk_away_cents: int | None
    #: Actionable only: each sentence explains a figure.
    reasoning: list[str]
    #: The one statement of what the figures do NOT claim. Null when there is
    #: nothing to qualify. A renderer should place this at the end of the section,
    #: not between the figures and their reasoning.
    caveat: str | None
    withheld_reason: str | None


class NegotiationOut(BaseModel):
    leverage: str
    #: The 0-100 behind the leverage word. Uncalibrated and NOT a figure to put in
    #: front of a buyer -- it starts at `BASE_STRENGTH` and never reaches either
    #: end of its own scale, so "30/100 negotiating room" on a fresh listing reads
    #: as a measurement when it is an offset. Kept on the wire for telemetry and
    #: for spec 9's calibration pass; the overlay renders `days_listed` instead.
    strength: float
    days_listed: int | None
    time_on_market_score: float | None
    leverage_points: list[str]
    offer: OfferOut
    #: A drafted opening message (beyond the spec -- `negotiation/message.py`).
    #: Null when the plan has no figure to send.
    opening_message: str | None
    motivated_phrases: list[str]
    rigid_phrases: list[str]


class AlternativeOut(BaseModel):
    description: str
    url: str | None
    price_cents: int | None
    mileage: int | None
    location_text: str | None
    advantage: float
    mileage_tradeoff: bool


class WithheldAlternativeOut(BaseModel):
    """A better-priced comp that is not being recommended, and why.

    Shown rather than counted: announcing "3 cheaper listings withheld" without
    naming them tells a buyer something exists, declines to say what, and reads
    as concealment. The reason travels with each listing.
    """

    description: str
    url: str | None
    price_cents: int | None
    mileage: int | None
    location_text: str | None
    reason: str


class AlternativesOut(BaseModel):
    message: str
    target_is_best: bool
    items: list[AlternativeOut]
    withheld: list[WithheldAlternativeOut]


class KnownIssuesOut(BaseModel):
    """Spec 6.6/7.7: "what to check on this specific car".

    QUALITATIVE ONLY. Spec 6.6: "Do not attach dollar estimates." No field here
    may contain a figure, and `app/known_issues/guard.py` enforces that in code
    rather than trusting the prompt.

    Every list may legitimately be empty: plenty of vehicles have no documented
    widespread problem in a given mileage range, and padding the list would be
    exactly the unfalsifiable output spec 11 rejects.
    """

    summary: str
    failure_modes: list[str]
    inspect: list[str]
    ask: list[str]
    ownership_notes: list[str]

    #: Which model produced this and for which mileage band, so an answer can be
    #: traced and re-generated.
    model: str | None
    mileage_band: str | None
    generated_at: datetime | None
    #: True when this evaluation reused a stored answer and cost nothing. Spec
    #: 10's cache-hit rate is what makes the feature affordable.
    cached: bool


class EvaluationOut(BaseModel):
    """Spec 7's output structure, in its order."""

    capture_id: int
    headline: str
    vehicle: str
    deal_score: DealScoreOut
    pricing: PricingOut
    completeness: CompletenessOut
    vehicle_details: VehicleDetailsOut
    vehicle_risk: VehicleRiskOut
    #: None when there is nothing to say (spec 7.4).
    seller_risk: SellerRiskOut | None
    negotiation: NegotiationOut
    alternatives: AlternativesOut
    #: Spec 6.6. None whenever the section cannot be shown -- no API key, spec
    #: 10's cost gate, or a failed call -- and the reason then says which.
    known_issues: KnownIssuesOut | None
    known_issues_unavailable_reason: str | None
    #: Which KIND of absence, so a UI can tell spec 10's VERDICTS (salvage
    #: title, hard disqualifier, implausible discount -- findings a buyer needs)
    #: from deployment facts (no API key, call disabled, offline, call failed --
    #: which are about this server, not about the car, and should not be shown
    #: to a buyer at all). None when the section is present.
    known_issues_unavailable_code: str | None
    #: Beta, asking-price and liability notices. Spec 7 requires the liability
    #: framing "in the UI, not just the terms", so it travels with the payload.
    notices: list[str]
