"""Evaluation endpoint (spec 7, build step 8).

    GET /v1/evaluations/{capture_id}

Reads a capture that was already ingested and returns the full assessment. The
extension posts a capture, gets an id back, then fetches this -- rather than the
capture POST returning an evaluation directly.

That split is deliberate. Ingestion is the durable act (spec 4.4's append-only
observations); evaluation is a derived read that can be re-run, re-fetched after
a model change, and cached. Coupling them would mean a scoring bug could fail an
ingest, losing data that cannot be re-collected without the user clicking again.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db import get_session
from app.evaluation import evaluate_capture
from app.pricing.loader import load_captures
from app.schemas import EvaluationOut
from app.services.serialize import evaluation_to_schema

router = APIRouter(prefix="/v1", tags=["evaluations"])


@router.get("/evaluations/{capture_id}", response_model=EvaluationOut)
def get_evaluation(
    capture_id: int,
    offline: bool = Query(
        False,
        description="Skip NHTSA network calls and use only cached data.",
    ),
    session: Session = Depends(get_session),
) -> EvaluationOut:
    captures = load_captures(session, [capture_id])
    if not captures:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No evaluable capture with id {capture_id}",
        )

    evaluation = evaluate_capture(session, captures[0], offline=offline)
    return evaluation_to_schema(captures[0], evaluation)
