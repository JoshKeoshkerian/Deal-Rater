"""POST /v1/attribution -- record which ad (if any) drove an extension install.

Called by the website's welcome page (`curbside-app/app/welcome`), which the
extension opens once on first install. Unauthenticated: the visitor has no
account yet, and the only thing this can write is one row keyed by a random
UUID. CORS is the app-wide allow-list (`DEAL_RATER_CORS_ORIGINS`), which
already includes the website.
"""

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.api.auth import _client_ip
from app.attribution import RateLimiter, record_install
from app.db import get_session
from app.schemas import AttributionIn, AttributionOut

router = APIRouter(prefix="/v1", tags=["attribution"])

#: A real visitor sends one of these per install. Thirty a minute per address
#: leaves room for an office behind one IP and stops a loop from flooding.
_limiter = RateLimiter(limit=30, window=60)


@router.post("/attribution", response_model=AttributionOut)
def post_attribution(
    payload: AttributionIn, request: Request, session: Session = Depends(get_session)
) -> AttributionOut:
    if not _limiter.allow(_client_ip(request) or "unknown"):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many requests."
        )
    created = record_install(session, payload)
    session.commit()
    return AttributionOut(install_id=str(payload.install_id), created=created)
