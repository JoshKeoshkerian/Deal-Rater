"""Persistence model for step 2 (extraction only).

Four layers, deliberately separated so that time-series does not have to be
retrofitted later (spec 4.4):

  identity     `listings`, `sellers`            upserted, stable keys
  observation  `listing_observations`,          APPEND ONLY, one row per scrape
               `seller_observations`
  provenance   `captures`                       one row per user click
  telemetry    `extraction_reports`             scraper health (spec 4.6)

Nothing volatile is ever updated in place. The single exception is
`listings.last_observed_at`, which is a cursor over the observation rows rather
than data in its own right.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

# JSONB on Postgres, plain JSON elsewhere so the suite can run without a server.
JsonCol = JSON().with_variant(JSONB(), "postgresql")

TZDateTime = DateTime(timezone=True)

# Matches the BIGINT identity columns in the migration, which is the source of
# truth for the real database. The SQLite variant is required because SQLite
# only auto-increments a column declared exactly INTEGER PRIMARY KEY.
PkType = BigInteger().with_variant(Integer(), "sqlite")


class Base(DeclarativeBase):
    pass


class Capture(Base):
    """One user click. Groups a target listing with the comps found for it."""

    __tablename__ = "captures"

    id: Mapped[int] = mapped_column(PkType, primary_key=True)
    client_capture_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), unique=True, nullable=False)

    # The API is client-agnostic (spec 8.1.4). These two columns are the only
    # place the identity of the caller is recorded, and nothing branches on them.
    client_name: Mapped[str] = mapped_column(String(64), nullable=False)
    client_version: Mapped[str] = mapped_column(String(32), nullable=False)

    captured_at: Mapped[datetime] = mapped_column(TZDateTime, nullable=False)
    received_at: Mapped[datetime] = mapped_column(TZDateTime, nullable=False)

    comp_search_query: Mapped[dict | None] = mapped_column(JsonCol)
    comp_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # False when a `required` field failed to extract anywhere in the capture —
    # an unambiguous scraper failure. `expected` misses are often real data (a
    # listing with no price) and do not flip this; watch their fill rate instead.
    # Derived server-side from extraction_reports, never sent by a client.
    extraction_ok: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    observations: Mapped[list[ListingObservation]] = relationship(back_populates="capture")


class Listing(Base):
    """Identity anchor for a listing. Holds only what does not change."""

    __tablename__ = "listings"

    id: Mapped[int] = mapped_column(PkType, primary_key=True)
    source: Mapped[str] = mapped_column(String(64), nullable=False, default="facebook_marketplace")
    source_listing_id: Mapped[str] = mapped_column(String(128), nullable=False)

    first_observed_at: Mapped[datetime] = mapped_column(TZDateTime, nullable=False)
    # Cursor, not data. Every observation still exists as its own row.
    last_observed_at: Mapped[datetime] = mapped_column(TZDateTime, nullable=False)

    vin: Mapped[str | None] = mapped_column(String(17))

    # Fuzzy identity for relisting detection (spec 4.4). Computed at ingest and
    # stored now; the matching logic that consumes it is phase three.
    relisting_key: Mapped[str | None] = mapped_column(String(40))

    __table_args__ = (
        UniqueConstraint("source", "source_listing_id", name="uq_listings_source_id"),
        Index("ix_listings_vin", "vin"),
        Index("ix_listings_relisting_key", "relisting_key"),
    )


class Seller(Base):
    """Privacy-minimal seller identity (spec 8.2).

    Two fields ever leave the browser: this hash and an integer count. Display
    names, profile URLs, photos and join dates are never transmitted or stored.
    The hash is a pseudonym, not an anonymisation: it is computed client-side
    with a pepper shipped in the client bundle, which is not secret. Rotation is
    possible via hash_version.
    """

    __tablename__ = "sellers"

    id: Mapped[int] = mapped_column(PkType, primary_key=True)
    seller_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    hash_version: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    first_seen_at: Mapped[datetime] = mapped_column(TZDateTime, nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(TZDateTime, nullable=False)

    __table_args__ = (
        UniqueConstraint("seller_hash", "hash_version", name="uq_sellers_hash_version"),
    )


class ListingObservation(Base):
    """Append-only. One row per listing per capture, target or comp alike.

    Comps and targets share this table on purpose: a comp today is a target
    tomorrow, and unifying them is what makes the section-1 dataset accumulate
    from every click rather than only from the car being evaluated.
    """

    __tablename__ = "listing_observations"

    id: Mapped[int] = mapped_column(PkType, primary_key=True)
    listing_id: Mapped[int] = mapped_column(
        ForeignKey("listings.id", ondelete="CASCADE"), nullable=False
    )
    capture_id: Mapped[int] = mapped_column(
        ForeignKey("captures.id", ondelete="CASCADE"), nullable=False
    )
    observed_at: Mapped[datetime] = mapped_column(TZDateTime, nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False)  # 'target' | 'comp'

    # --- spec 4.1 target listing fields -------------------------------------
    price_cents: Mapped[int | None] = mapped_column(Integer)
    currency: Mapped[str | None] = mapped_column(String(8))
    mileage: Mapped[int | None] = mapped_column(Integer)
    mileage_unit: Mapped[str | None] = mapped_column(String(4))  # 'mi' | 'km'
    year: Mapped[int | None] = mapped_column(SmallInteger)
    make: Mapped[str | None] = mapped_column(String(64))
    model: Mapped[str | None] = mapped_column(String(128))
    trim_text: Mapped[str | None] = mapped_column(String(128))

    # --- trim, decomposed (derived from trim_text at ingest) -----------------
    # `trim_text` above stays the verbatim audit trail. These are derived by
    # `services/vehicle_facts.decompose` because one free-text string encodes at
    # least four separate facts -- "2.0i Premium Sport Utility 4D" is trim level
    # Premium, body sport_utility, engine 2.0i -- and comparing the whole string
    # made a body-style mismatch indistinguishable from a trim-level one.
    #
    # Derived server-side rather than in the extension on purpose: spec 4.2
    # sequences VIN decode at build step 6, and it will overwrite `trim_level`
    # with the vPIC value. Keeping `trim_text` untouched means that can happen
    # without destroying what the seller actually wrote.
    trim_level: Mapped[str | None] = mapped_column(String(128))
    body_style: Mapped[str | None] = mapped_column(String(32))
    engine_text: Mapped[str | None] = mapped_column(String(16))
    drivetrain: Mapped[str | None] = mapped_column(String(8))
    #: Which tier produced `trim_text`: 'fb_catalog' | 'title_text' |
    #: 'description'. Facebook's catalog string is written identically every
    #: time; a seller-typed one is not, and until this column existed the two
    #: were indistinguishable once stored.
    trim_source: Mapped[str | None] = mapped_column(String(16))

    #: Marketplace's own 'PRIVATE_SELLER' / 'DEALER'. Spec 4.3's dealer
    #: exclusion, which this project long recorded as impossible to obtain --
    #: the payload key was simply never read. NULL on every observation captured
    #: before that fix, which is why `DealerSignal` still has an UNAVAILABLE.
    seller_type: Mapped[str | None] = mapped_column(String(32))
    #: 'AUTOMATIC' / 'MANUAL' from the payload, not the trim-text regex.
    transmission: Mapped[str | None] = mapped_column(String(32))

    title_status: Mapped[str | None] = mapped_column(String(32))
    description: Mapped[str | None] = mapped_column(Text)
    photo_count: Mapped[int | None] = mapped_column(Integer)
    posted_at: Mapped[datetime | None] = mapped_column(TZDateTime)
    # Kept verbatim: "listed 3 weeks ago" is coarser than a timestamp, and
    # rounding it into posted_at loses the fact that it was ever approximate.
    posted_relative_text: Mapped[str | None] = mapped_column(String(64))
    price_changed: Mapped[bool | None] = mapped_column(Boolean)
    location_text: Mapped[str | None] = mapped_column(String(255))
    latitude: Mapped[float | None] = mapped_column(Numeric(9, 6))
    longitude: Mapped[float | None] = mapped_column(Numeric(9, 6))
    listing_url: Mapped[str | None] = mapped_column(Text)

    seller_id: Mapped[int | None] = mapped_column(ForeignKey("sellers.id", ondelete="SET NULL"))

    # Which extraction tier produced each field, e.g. {"price": "json_payload"}.
    # The early-warning signal for scraper decay (spec 4.6): fields degrading
    # from json_payload to text_pattern precedes them going null entirely.
    field_strategies: Mapped[dict] = mapped_column(JsonCol, nullable=False, default=dict)

    # Normalised pre-validation blob, so a parsing fix can be re-derived against
    # observations already collected instead of needing a fresh scrape.
    raw_extract: Mapped[dict | None] = mapped_column(JsonCol)

    capture: Mapped[Capture] = relationship(back_populates="observations")

    __table_args__ = (
        UniqueConstraint("listing_id", "capture_id", name="uq_observation_listing_capture"),
        Index("ix_observations_listing_time", "listing_id", "observed_at"),
        Index("ix_observations_capture", "capture_id"),
        Index("ix_observations_seller", "seller_id"),
    )


class SellerObservation(Base):
    """Append-only count of a seller's concurrently active vehicle listings,
    and their Marketplace star rating.

    The rating is the same kind of exception `SellerPayload` documents on the
    extension side: a reputation NUMBER Marketplace already shows on the
    listing page itself, not identity, so it is exempt from spec 8.2's
    "never collected" list (display name, profile URL, photo, join date) the
    same way `active_vehicle_listing_count` already was.
    """

    __tablename__ = "seller_observations"

    id: Mapped[int] = mapped_column(PkType, primary_key=True)
    seller_id: Mapped[int] = mapped_column(
        ForeignKey("sellers.id", ondelete="CASCADE"), nullable=False
    )
    capture_id: Mapped[int] = mapped_column(
        ForeignKey("captures.id", ondelete="CASCADE"), nullable=False
    )
    observed_at: Mapped[datetime] = mapped_column(TZDateTime, nullable=False)
    active_vehicle_listing_count: Mapped[int | None] = mapped_column(Integer)
    # Precise average as Marketplace's own aria-label states it (e.g. 2.4),
    # not the value the star icons visually round to for display.
    rating_average: Mapped[Decimal | None] = mapped_column(Numeric(3, 2))
    rating_count: Mapped[int | None] = mapped_column(Integer)

    __table_args__ = (
        UniqueConstraint("seller_id", "capture_id", name="uq_seller_observation_capture"),
    )


class GroundTruthLabel(Base):
    """A human verdict on one observed listing (spec 9.1).

    Spec 9.1 is step 3's success criterion: "Evaluate 50 to 100 listings by hand
    as an experienced buyer would (good deal / fair / overpriced / avoid). Score
    with the engine and measure agreement." Spec 9.4 then uses the same set to
    locate the discount curve's plateau and decline, which are placeholders
    until it exists.

    The label attaches to an OBSERVATION, not to a listing. A listing's asking
    price changes over time and a verdict is a verdict about a price, so a label
    pinned to the listing would silently become a claim about a different offer
    after the next price drop.

    Labels are entered by a person via `python -m app.cli.label`. Nothing in
    this codebase writes a row here automatically, and nothing should: a
    machine-generated label would make the agreement measurement circular, which
    is the one thing spec 9 exists to prevent.
    """

    __tablename__ = "ground_truth_labels"

    id: Mapped[int] = mapped_column(PkType, primary_key=True)
    observation_id: Mapped[int] = mapped_column(
        ForeignKey("listing_observations.id", ondelete="CASCADE"), nullable=False
    )

    # 'good_deal' | 'fair' | 'overpriced' | 'avoid', per spec 9.1.
    label: Mapped[str] = mapped_column(String(16), nullable=False)

    labeled_at: Mapped[datetime] = mapped_column(TZDateTime, nullable=False)
    # Who labelled, so inter-rater disagreement is separable from model error if
    # a second labeller is ever added. Free text, not a user account.
    labeler: Mapped[str] = mapped_column(String(64), nullable=False)
    # Why. The disagreements are the useful part of spec 9.1 -- they locate the
    # wrong weights -- and a verdict without a reason cannot do that work.
    note: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (
        # One verdict per labeller per observed price. Re-labelling updates in
        # place; this table is judgement, not time-series.
        UniqueConstraint("observation_id", "labeler", name="uq_label_observation_labeler"),
        Index("ix_labels_observation", "observation_id"),
    )


class VinDecode(Base):
    """Cached NHTSA vPIC decode for one VIN (spec 4.2, 10).

    Spec 10: "Cache VIN decodes indefinitely. VIN-to-specification mapping never
    changes." There is deliberately no expiry column: a 2017 RAV4's factory
    drivetrain is not going to be revised.

    Spec 4.2's primary value is comp matching, not recalls: "Trim and drivetrain
    ambiguity is the hardest accuracy problem here... vPIC decodes a VIN into
    exact trim, engine, drivetrain, transmission and body style." Those columns
    are broken out so step 3's comp filter can read them without parsing JSON,
    with the full response kept alongside.
    """

    __tablename__ = "vin_decodes"

    vin: Mapped[str] = mapped_column(String(17), primary_key=True)
    decoded_at: Mapped[datetime] = mapped_column(TZDateTime, nullable=False)

    make: Mapped[str | None] = mapped_column(String(64))
    model: Mapped[str | None] = mapped_column(String(128))
    model_year: Mapped[int | None] = mapped_column(SmallInteger)
    trim: Mapped[str | None] = mapped_column(String(128))
    series: Mapped[str | None] = mapped_column(String(128))
    drive_type: Mapped[str | None] = mapped_column(String(32))
    transmission: Mapped[str | None] = mapped_column(String(64))
    engine_cylinders: Mapped[int | None] = mapped_column(SmallInteger)
    displacement_l: Mapped[float | None] = mapped_column(Numeric(4, 1))
    body_class: Mapped[str | None] = mapped_column(String(128))
    fuel_type: Mapped[str | None] = mapped_column(String(64))

    #: vPIC's own error code. "0" means a clean decode; anything else means the
    #: fields above are partial and should not be trusted as exact.
    error_code: Mapped[str | None] = mapped_column(String(32))
    raw: Mapped[dict | None] = mapped_column(JsonCol)


class VehicleSafetyLookup(Base):
    """Cached recall and complaint data, keyed by YEAR/MAKE/MODEL.

    NOT BY VIN, and that is a correction to the spec rather than a shortcut.

    Spec 4.2 says "Open recalls by VIN via NHTSA's recall API" and spec 6.2 says
    "Open unrepaired safety recalls (VIN required)". NHTSA's free public API does
    not offer that. `api.nhtsa.gov/recalls/recallsByVehicle` takes make, model
    and modelYear, and returns recall CAMPAIGNS for that vehicle -- not whether
    this particular car had them performed. Per-VIN repair status comes from the
    manufacturer, behind no free public API.

    The distinction is load-bearing in the same way asking-vs-transaction price
    is (spec 4.5). "This model has 3 open recall campaigns" is a much weaker
    claim than "this car has 3 unrepaired recalls", and presenting the first as
    the second would be exactly the false authority spec 9 exists to prevent.

    Spec 10: "recall lookups for 30 days" -- hence `fetched_at` and an expiry
    the caller enforces.
    """

    __tablename__ = "vehicle_safety_lookups"

    id: Mapped[int] = mapped_column(PkType, primary_key=True)
    model_year: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    make: Mapped[str] = mapped_column(String(64), nullable=False)
    model: Mapped[str] = mapped_column(String(128), nullable=False)

    fetched_at: Mapped[datetime] = mapped_column(TZDateTime, nullable=False)

    recall_count: Mapped[int | None] = mapped_column(Integer)
    complaint_count: Mapped[int | None] = mapped_column(Integer)
    #: Complaint counts per component, so "301 complaints" can be broken into
    #: what they were actually about.
    complaints_by_component: Mapped[dict | None] = mapped_column(JsonCol)
    recalls: Mapped[list | None] = mapped_column(JsonCol)

    __table_args__ = (
        UniqueConstraint("model_year", "make", "model", name="uq_safety_year_make_model"),
    )


class KnownIssuesEntry(Base):
    """Cached ownership-cost context for one VEHICLE, not one listing (spec 6.6, 10).

    Spec 10: "Cache known-issues text by YEAR/MAKE/MODEL/TRIM/MILEAGE-BAND, not
    per listing. Every 2013 Focus at 90k miles gets the same answer, so most
    calls collapse into cache hits almost immediately."

    That is the whole cost model. The per-evaluation price of this feature is
    not the price of a completion; it is the price of a completion divided by
    how many listings share a row, and that ratio improves for as long as the
    product runs. Keying by listing id would have made it a per-evaluation cost
    forever.

    KEY SHAPE
    ---------
    The unique key includes `llm_model` and `prompt_version` alongside the
    vehicle. Changing either produces different text, so both belong to identity
    rather than to the payload -- a prompt revision invalidates the cache by
    missing it, with no purge step and no migration, and the superseded rows
    stay readable for cost comparison between versions.

    `trim` is an EMPTY STRING when unknown, never NULL, because NULLs do not
    compare equal in a unique constraint and every no-trim listing would
    otherwise write its own row on every evaluation.

    COST INSTRUMENTATION (spec 10)
    ------------------------------
    "Instrument cost per evaluation from day one. This number determines whether
    the product can be free, freemium, or paid."

    `cost_microdollars` is what the generating call cost; `served_count` is how
    many evaluations that one call has answered. Cost per evaluation across the
    corpus is SUM(cost_microdollars) / SUM(served_count) -- both halves have to
    be stored, because a cache hit is free and counting only calls would flatter
    the number badly. `python -m app.cli.cost` reports it.
    """

    __tablename__ = "known_issues_entries"

    id: Mapped[int] = mapped_column(PkType, primary_key=True)

    # --- cache key ----------------------------------------------------------
    model_year: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    make: Mapped[str] = mapped_column(String(64), nullable=False)
    model: Mapped[str] = mapped_column(String(128), nullable=False)
    #: "" when the listing states no trim. See the class docstring.
    trim: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    #: e.g. "75-100k", "200k+", "unknown". See known_issues/params.py.
    mileage_band: Mapped[str] = mapped_column(String(16), nullable=False)
    llm_model: Mapped[str] = mapped_column(String(64), nullable=False)
    prompt_version: Mapped[int] = mapped_column(SmallInteger, nullable=False)

    generated_at: Mapped[datetime] = mapped_column(TZDateTime, nullable=False)

    # --- payload (spec 6.6: qualitative only, never a dollar figure) --------
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    failure_modes: Mapped[list] = mapped_column(JsonCol, nullable=False, default=list)
    inspect: Mapped[list] = mapped_column(JsonCol, nullable=False, default=list)
    ask: Mapped[list] = mapped_column(JsonCol, nullable=False, default=list)
    ownership_notes: Mapped[list] = mapped_column(JsonCol, nullable=False, default=list)

    #: How many bullets `known_issues/guard.py` removed for naming a money
    #: figure. Non-zero means the model ignored an explicit instruction, which
    #: is worth knowing about before it happens in a field the guard cannot
    #: drop without discarding the whole answer.
    currency_items_dropped: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # --- cost (spec 10) -----------------------------------------------------
    input_tokens: Mapped[int | None] = mapped_column(Integer)
    output_tokens: Mapped[int | None] = mapped_column(Integer)
    cost_microdollars: Mapped[int | None] = mapped_column(Integer)

    #: Evaluations answered by this row, including the one that generated it.
    served_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_served_at: Mapped[datetime | None] = mapped_column(TZDateTime)

    __table_args__ = (
        UniqueConstraint(
            "model_year",
            "make",
            "model",
            "trim",
            "mileage_band",
            "llm_model",
            "prompt_version",
            name="uq_known_issues_vehicle_key",
        ),
    )


class ExtractionReport(Base):
    """Scraper self-check output (spec 4.6).

    Written even when the capture itself fails validation, because a capture
    that fails validation is exactly the event worth knowing about.
    """

    __tablename__ = "extraction_reports"

    id: Mapped[int] = mapped_column(PkType, primary_key=True)
    capture_id: Mapped[int] = mapped_column(
        ForeignKey("captures.id", ondelete="CASCADE"), nullable=False
    )
    observed_at: Mapped[datetime] = mapped_column(TZDateTime, nullable=False)
    scope: Mapped[str] = mapped_column(String(32), nullable=False)
    field_name: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    expectation: Mapped[str] = mapped_column(String(16), nullable=False)
    strategies_attempted: Mapped[list | None] = mapped_column(JsonCol)
    # Coarse structural fingerprint of the page, so a spike in reports can be
    # correlated with a specific Facebook layout change.
    page_signature: Mapped[str | None] = mapped_column(String(64))

    __table_args__ = (
        Index("ix_reports_capture", "capture_id"),
        Index("ix_reports_field_time", "field_name", "observed_at"),
    )
