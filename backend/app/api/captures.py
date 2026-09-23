from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.auth.dependencies import require_user
from app.billing import (
    get_or_create_account,
    is_unlimited,
    record_evaluation_spend,
    try_reserve_credit,
)
from app.config import get_settings
from app.db import get_session
from app.models import User
from app.schemas import CaptureIn, CaptureOut
from app.services.ingest import find_existing_capture, ingest_capture

router = APIRouter(prefix="/v1", tags=["captures"])

OUT_OF_CHECKS_DETAIL = (
    "You're out of checks. Buy more at curbsidescore.com/pricing to keep evaluating."
)


@router.post("/captures", response_model=CaptureOut, status_code=status.HTTP_201_CREATED)
def post_capture(
    payload: CaptureIn,
    user: User = Depends(require_user),
    session: Session = Depends(get_session),
) -> CaptureOut:
    settings = get_settings()
    if len(payload.comps) > settings.max_comps_per_capture:
        raise HTTPException(
            status_code=413,
            detail=f"comps exceeds max_comps_per_capture ({settings.max_comps_per_capture})",
        )

    # A retried `client_capture_id` (a timeout the original request actually
    # survived) is a free replay, exactly as it was before billing existed --
    # `ingest_capture` returns the original capture and writes nothing new, so
    # nothing should be charged for it either. Checked here, before touching
    # the balance, rather than after ingestion: charging first and refunding
    # on a duplicate would make a transient network retry visibly cost (and
    # then un-cost) a credit.
    replay = find_existing_capture(session, payload.capture.client_capture_id) is not None

    if not replay:
        account = get_or_create_account(session, user.id)
        unlimited = is_unlimited(account)
        if not unlimited and not try_reserve_credit(session, user.id):
            raise HTTPException(status_code=402, detail=OUT_OF_CHECKS_DETAIL)
    else:
        unlimited = True  # irrelevant on a replay -- nothing is charged either way

    result = ingest_capture(session, payload, user_id=user.id)
    if not replay and not unlimited:
        record_evaluation_spend(session, user.id, result.capture.id)
    session.commit()

    return CaptureOut(
        capture_id=result.capture.id,
        client_capture_id=result.capture.client_capture_id,
        duplicate=result.duplicate,
        listings_ingested=result.listings_ingested,
        observations_written=result.observations_written,
        extraction_reports_written=result.extraction_reports_written,
        extraction_ok=result.capture.extraction_ok,
    )
