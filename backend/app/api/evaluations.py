"""Evaluation endpoints (spec 7, build step 8).

    GET  /v1/evaluations/{capture_id}
    POST /v1/evaluations/{capture_id}/known-issues

Reads a capture that was already ingested and returns the full assessment. The
extension posts a capture, gets an id back, then fetches this -- rather than the
capture POST returning an evaluation directly.

That split is deliberate. Ingestion is the durable act (spec 4.4's append-only
observations); evaluation is a derived read that can be re-run, re-fetched after
a model change, and cached. Coupling them would mean a scoring bug could fail an
ingest, losing data that cannot be re-collected without the user clicking again.

THE SECOND ROUTE, AND WHY IT EXISTS
------------------------------------
`evaluate_capture` never spends spec 6.6's per-call cost on its own any more --
it always calls `known_issues_reading(..., network_allowed=False)`, so a plain
`GET` above is free even on a cold vehicle. This route is the only place that
sets `network_allowed=True`: the overlay's AI Insights section calls it, and
only when the user actually clicks it open. See
`app/known_issues/client.py`'s module docstring for why that flag is separate
from every other reason the call might not happen.

It re-runs the gate with `pricing_band=None`, deliberately skipping only the
"implausible discount" disqualifier -- recomputing that would mean re-running
the whole comp-set regression on every click, which defeats the point of
deferring cost and latency to begin with. This is safe: the eager `GET` above
already gated on the real pricing band, so a listing that check would have
disqualified never reaches a `pending` state for the frontend to click on in
the first place, and `None` cannot match a band string, so this route can only
be as-or-more permissive than the eager pass, never contradict it.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_session
from app.evaluation import evaluate_capture
from app.flags import read_title_status
from app.known_issues import known_issues_reading
from app.pricing.loader import StoredCapture, load_captures
from app.schemas import EvaluationOut, KnownIssuesFetchOut
from app.services.serialize import evaluation_to_schema, known_issues_reading_to_schema

router = APIRouter(prefix="/v1", tags=["evaluations"])


def _load_capture(session: Session, capture_id: int) -> StoredCapture:
    captures = load_captures(session, [capture_id])
    if not captures:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No evaluable capture with id {capture_id}",
        )
    return captures[0]


@router.get("/evaluations/{capture_id}", response_model=EvaluationOut)
def get_evaluation(
    capture_id: int,
    offline: bool = Query(
        False,
        description="Skip NHTSA network calls and use only cached data.",
    ),
    session: Session = Depends(get_session),
) -> EvaluationOut:
    capture = _load_capture(session, capture_id)
    evaluation = evaluate_capture(session, capture, offline=offline)
    return evaluation_to_schema(capture, evaluation)


@router.post("/evaluations/{capture_id}/known-issues", response_model=KnownIssuesFetchOut)
def fetch_known_issues_for_capture(
    capture_id: int,
    offline: bool = Query(
        False,
        description="Cache lookup only; never calls the model even if the gate allows it.",
    ),
    session: Session = Depends(get_session),
) -> KnownIssuesFetchOut:
    capture = _load_capture(session, capture_id)
    settings = get_settings()
    title = read_title_status(capture.target_title_status)

    reading = known_issues_reading(
        session,
        settings,
        title=title,
        description=capture.target_description,
        year=capture.target.year,
        make=capture.target.make,
        model=capture.target.model,
        trim=capture.target.trim_text,
        mileage=capture.target.mileage,
        pricing_band=None,
        offline=offline,
        network_allowed=True,
    )
    return known_issues_reading_to_schema(reading)
