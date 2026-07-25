from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_session
from app.schemas import CaptureIn, CaptureOut
from app.services.ingest import ingest_capture

router = APIRouter(prefix="/v1", tags=["captures"])


@router.post("/captures", response_model=CaptureOut, status_code=status.HTTP_201_CREATED)
def post_capture(
    payload: CaptureIn,
    session: Session = Depends(get_session),
) -> CaptureOut:
    settings = get_settings()
    if len(payload.comps) > settings.max_comps_per_capture:
        raise HTTPException(
            status_code=413,
            detail=f"comps exceeds max_comps_per_capture ({settings.max_comps_per_capture})",
        )

    result = ingest_capture(session, payload)
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
