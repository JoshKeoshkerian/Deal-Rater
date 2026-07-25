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
    """Spec 8.2: a hashed identifier and an integer. There is no third field,
    and there is not meant to be one."""

    model_config = ConfigDict(extra="forbid")

    seller_hash: str
    hash_version: Annotated[int, Field(ge=1, le=32767)]
    active_vehicle_listing_count: Annotated[int | None, Field(ge=0, le=10_000)] = None

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
    title_status: Annotated[str | None, Field(max_length=32)] = None
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

    @field_validator("make", "model", "trim_text", "location_text", "title_status")
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
