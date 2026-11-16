from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.auth.dependencies import require_user
from app.billing import (
    get_or_create_account,
    has_checked_listing_before,
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

#: A guest who has used their free check. Still a 402 (the request was valid,
#: the balance is empty), but the next step is signing up, not paying -- the
#: extension recognises a guest session and shows the sign-in form instead.
GUEST_OUT_OF_CHECKS_DETAIL = (
    "You've used your free guest check. Sign in with your email to get more free checks."
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
    # WHEN A CHECK IS FREE. Decided before touching the balance, so a free
    # check never visibly costs (and then un-costs) a credit:
    #   - 'replay': a retried `client_capture_id` (a timeout the original
    #     request actually survived). `ingest_capture` returns the original
    #     capture and writes nothing new.
    #   - 'repeat': this user already checked this exact listing. Checking the
    #     same car twice costs one check, not two.
    #   - 'not_vehicle': nothing identifies a vehicle (no make, model or
    #     year). The extension refuses these before sending; this is the
    #     backstop for an older or different client.
    # A check that IS charged but can't be priced confidently is refunded
    # when its evaluation is fetched -- see `app/api/evaluations.py`.
    target = payload.target
    free_reason: str | None = None
    if find_existing_capture(session, payload.capture.client_capture_id) is not None:
        free_reason = "replay"
    elif target.make is None and target.model is None and target.year is None:
        free_reason = "not_vehicle"
    elif has_checked_listing_before(
        session, user.id, source=target.source, source_listing_id=target.source_listing_id
    ):
        free_reason = "repeat"
    elif is_unlimited(get_or_create_account(session, user.id)):
        free_reason = "unlimited"
    elif not try_reserve_credit(session, user.id):
        detail = GUEST_OUT_OF_CHECKS_DETAIL if user.is_guest else OUT_OF_CHECKS_DETAIL
        raise HTTPException(status_code=402, detail=detail)

    charged = free_reason is None
    result = ingest_capture(session, payload, user_id=user.id)
    if charged:
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
        charged=charged,
        free_reason=free_reason,
    )
