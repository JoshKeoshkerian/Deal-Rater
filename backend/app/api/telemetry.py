"""Scraper health, per spec 4.6: breakage should surface here rather than as
user complaints.

Three views, in increasing order of how early they warn you:

  issues        fields that came back null. The complaint you already have.
  fields        fill rate per field over time. Drift before total failure.
  strategy_mix  which extraction tier is winning per field. This moves first:
                when `price` stops resolving via json_payload and starts
                falling back to text_pattern, Facebook has already changed
                something, even though the field is still populated.
"""

from collections import Counter
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_session
from app.models import Capture, ExtractionReport, ListingObservation
from app.schemas import ExtractionHealthOut, FieldHealth, IssueCount, StrategyMix

router = APIRouter(prefix="/v1/telemetry", tags=["telemetry"])

# Fields the extractor is expected to produce. Kept explicit rather than derived
# from the table so that adding a column does not silently change the report.
TRACKED_FIELDS = (
    "price_cents",
    "mileage",
    "year",
    "make",
    "model",
    "trim_text",
    "title_status",
    "description",
    "photo_count",
    "posted_at",
    "location_text",
    "listing_url",
    "seller_id",
)

# Guard against unbounded in-Python aggregation of field_strategies. Well above
# step-2 volume; revisit with a Postgres-native jsonb_each_text query if the
# window ever exceeds it.
STRATEGY_SCAN_LIMIT = 50_000


@router.get("/extraction-health", response_model=ExtractionHealthOut)
def extraction_health(
    days: int = Query(7, ge=1, le=365),
    session: Session = Depends(get_session),
) -> ExtractionHealthOut:
    since = datetime.now(UTC) - timedelta(days=days)

    capture_count = (
        session.scalar(
            select(func.count()).select_from(Capture).where(Capture.captured_at >= since)
        )
        or 0
    )
    captures_with_issues = (
        session.scalar(
            select(func.count())
            .select_from(Capture)
            .where(Capture.captured_at >= since, Capture.extraction_ok.is_(False))
        )
        or 0
    )

    fields = _field_health(session, since)
    strategy_mix = _strategy_mix(session, since)
    issues = _issue_counts(session, since)

    return ExtractionHealthOut(
        since=since,
        captures=capture_count,
        captures_with_issues=captures_with_issues,
        fields=fields,
        strategy_mix=strategy_mix,
        issues=issues,
    )


def _field_health(session: Session, since: datetime) -> list[FieldHealth]:
    columns = [
        func.count(getattr(ListingObservation, name)).label(name) for name in TRACKED_FIELDS
    ]
    rows = session.execute(
        select(ListingObservation.role, func.count().label("observed"), *columns)
        .where(ListingObservation.observed_at >= since)
        .group_by(ListingObservation.role)
    ).all()

    out: list[FieldHealth] = []
    for row in rows:
        mapping = row._mapping
        observed = mapping["observed"]
        for name in TRACKED_FIELDS:
            populated = mapping[name]
            out.append(
                FieldHealth(
                    field_name=name,
                    role=mapping["role"],
                    observed=observed,
                    populated=populated,
                    fill_rate=round(populated / observed, 4) if observed else 0.0,
                )
            )
    # Worst fill rate first: the report should lead with what is breaking.
    out.sort(key=lambda f: (f.fill_rate, f.field_name))
    return out


def _strategy_mix(session: Session, since: datetime) -> list[StrategyMix]:
    rows = session.scalars(
        select(ListingObservation.field_strategies)
        .where(ListingObservation.observed_at >= since)
        .order_by(ListingObservation.observed_at.desc())
        .limit(STRATEGY_SCAN_LIMIT)
    ).all()

    counter: Counter[tuple[str, str]] = Counter()
    for strategies in rows:
        if not strategies:
            continue
        for field_name, strategy in strategies.items():
            counter[(str(field_name), str(strategy))] += 1

    return [
        StrategyMix(field_name=field_name, strategy=strategy, count=count)
        for (field_name, strategy), count in counter.most_common()
    ]


def _issue_counts(session: Session, since: datetime) -> list[IssueCount]:
    rows = session.execute(
        select(
            ExtractionReport.field_name,
            ExtractionReport.scope,
            ExtractionReport.status,
            ExtractionReport.expectation,
            func.count().label("count"),
        )
        .where(ExtractionReport.observed_at >= since)
        .group_by(
            ExtractionReport.field_name,
            ExtractionReport.scope,
            ExtractionReport.status,
            ExtractionReport.expectation,
        )
        .order_by(func.count().desc())
    ).all()

    return [
        IssueCount(
            field_name=r.field_name,
            scope=r.scope,
            status=r.status,
            expectation=r.expectation,
            count=r.count,
        )
        for r in rows
    ]
