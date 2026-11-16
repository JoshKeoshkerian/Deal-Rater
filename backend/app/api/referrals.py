"""Referral link and progress.

    GET /v1/referrals/me    the signed-in user's share link and how it's doing

Behind `require_account`: a guest has nothing to refer anyone to yet, and the
reward lands on an account balance. The rules themselves live in
`app/referrals/service.py`; this route only reports them.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth.dependencies import require_account
from app.billing import REFERRAL_MAX_REWARDS, REFERRAL_REWARD_EVALUATIONS
from app.config import get_settings
from app.db import get_session
from app.models import User
from app.referrals import get_or_create_referral_code, referral_stats
from app.schemas import ReferralsMeOut

router = APIRouter(prefix="/v1", tags=["referrals"])


@router.get("/referrals/me", response_model=ReferralsMeOut)
def referrals_me(
    user: User = Depends(require_account),
    session: Session = Depends(get_session),
) -> ReferralsMeOut:
    code = get_or_create_referral_code(session, user)
    stats = referral_stats(session, user)
    session.commit()
    return ReferralsMeOut(
        code=code,
        url=f"{get_settings().app_base_url.rstrip('/')}/?ref={code}",
        rewarded=stats.rewarded,
        max_rewards=REFERRAL_MAX_REWARDS,
        checks_per_referral=REFERRAL_REWARD_EVALUATIONS,
        checks_earned=stats.checks_earned,
        pending=stats.pending,
    )
