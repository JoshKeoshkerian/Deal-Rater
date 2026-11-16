"""Referral codes, attribution, and the reward. No HTTP in here.

THE RULE: a referrer earns `REFERRAL_REWARD_EVALUATIONS` checks when someone
they referred INSTALLS THE EXTENSION AND SIGNS UP WITH AN EMAIL, at most
`REFERRAL_MAX_REWARDS` times.

That happens in two steps, because the two halves can arrive in either order:

  1. ATTRIBUTION (`attach_referrer`) -- when `verify_code` creates an account
     (a new email, or a guest upgrading in place), the referral code it was
     given is resolved and stored as `users.referred_by_user_id`. Only on
     creation: signing in to an existing account never picks up a referrer,
     or anyone could farm checks by "referring" their friends' old accounts.

  2. REWARD (`maybe_reward_referrer`) -- on that account's first sign-in
     through the EXTENSION. That is the evidence of an install the backend
     actually has: a guest session only ever comes from the extension, and a
     `client: "extension"` verify only ever comes from it too. Someone who
     signs up on the website first is attributed then and rewarded later,
     when they install and sign in there.

`users.referral_rewarded_at` makes step 2 pay out once per referred user.
The cap is counted from `credit_ledger` rows (reason `referral_reward`), so
it is the ledger -- not a counter that could drift -- that says how many
times an account has been paid.
"""

from __future__ import annotations

import secrets
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.billing import (
    REFERRAL_MAX_REWARDS,
    REFERRAL_REWARD_EVALUATIONS,
    get_or_create_account,
    grant_free_credits,
)
from app.models import BillingAccount, CreditLedger, User

REWARD_REASON = "referral_reward"

#: No 0/O, 1/I/L: people read these codes out loud and retype them.
_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
_CODE_LENGTH = 8


def _generate_code() -> str:
    return "".join(secrets.choice(_ALPHABET) for _ in range(_CODE_LENGTH))


def normalize_referral_code(raw: str | None) -> str | None:
    """Upper-cased and stripped, or None if it cannot possibly be a code.

    Rejecting malformed input here means a junk cookie never costs a query.
    """
    if not raw:
        return None
    code = raw.strip().upper()
    if len(code) != _CODE_LENGTH or any(ch not in _ALPHABET for ch in code):
        return None
    return code


def get_or_create_referral_code(session: Session, user: User) -> str:
    """This user's share code, minted on first request.

    A collision on the unique index (31^8 ~ 8.5e11 codes, so practically
    never) is retried with a fresh code inside a savepoint, so it cannot roll
    back anything else the caller has pending.
    """
    if user.referral_code:
        return user.referral_code
    for _ in range(5):
        candidate = _generate_code()
        try:
            with session.begin_nested():
                user.referral_code = candidate
                session.flush()
            return candidate
        except IntegrityError:
            user.referral_code = None
    raise RuntimeError("Could not allocate a unique referral code.")


def attach_referrer(session: Session, user: User, raw_code: str | None) -> bool:
    """Record who referred a JUST-CREATED account. Returns whether one was set.

    Silently ignores anything that is not a usable referral: an unknown or
    malformed code, the user's own code, a referrer that is a guest or a
    merged-away guest row, or an account that already has a referrer.
    """
    code = normalize_referral_code(raw_code)
    if code is None or user.referred_by_user_id is not None:
        return False
    referrer = session.scalars(select(User).where(User.referral_code == code)).first()
    if (
        referrer is None
        or referrer.id == user.id
        or referrer.is_guest
        or referrer.merged_into_user_id is not None
    ):
        return False
    user.referred_by_user_id = referrer.id
    session.flush()
    return True


def _rewards_paid(session: Session, referrer_id: int) -> int:
    return (
        session.scalar(
            select(func.count(CreditLedger.id)).where(
                CreditLedger.user_id == referrer_id, CreditLedger.reason == REWARD_REASON
            )
        )
        or 0
    )


def maybe_reward_referrer(session: Session, user: User) -> bool:
    """Credit `user`'s referrer, if this is the first time and they're under the cap.

    Call only when `user` has just signed in THROUGH THE EXTENSION and has an
    email (see the module docstring). Returns whether checks were granted.

    The referrer's billing row is locked (`SELECT ... FOR UPDATE` on Postgres;
    a no-op on SQLite) before the cap is counted, so two people the same
    referrer brought in, signing up at the same instant, cannot both read
    "4 paid" and take the account to 6.
    """
    if (
        user.referred_by_user_id is None
        or user.referral_rewarded_at is not None
        or user.is_guest
        or not user.email
    ):
        return False

    referrer = session.get(User, user.referred_by_user_id)
    if referrer is None or referrer.is_guest or referrer.merged_into_user_id is not None:
        return False

    get_or_create_account(session, referrer.id)
    session.execute(
        select(BillingAccount.user_id)
        .where(BillingAccount.user_id == referrer.id)
        .with_for_update()
    )
    if _rewards_paid(session, referrer.id) >= REFERRAL_MAX_REWARDS:
        return False

    grant_free_credits(session, referrer, REFERRAL_REWARD_EVALUATIONS, reason=REWARD_REASON)
    user.referral_rewarded_at = datetime.now(UTC)
    session.flush()
    return True


@dataclass(frozen=True)
class ReferralStats:
    rewarded: int
    pending: int

    @property
    def checks_earned(self) -> int:
        return self.rewarded * REFERRAL_REWARD_EVALUATIONS


def referral_stats(session: Session, user: User) -> ReferralStats:
    """How many referrals have paid out, and how many are waiting on an install.

    `pending` is people attributed to this user whose extension sign-in
    hasn't happened yet. Once the cap is reached it is reported as 0: they
    will never pay out, so calling them pending would be a promise.
    """
    rewarded = _rewards_paid(session, user.id)
    pending = 0
    if rewarded < REFERRAL_MAX_REWARDS:
        pending = (
            session.scalar(
                select(func.count(User.id)).where(
                    User.referred_by_user_id == user.id,
                    User.referral_rewarded_at.is_(None),
                )
            )
            or 0
        )
    return ReferralStats(rewarded=rewarded, pending=pending)
