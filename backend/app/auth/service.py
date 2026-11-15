"""The magic-link state machine, with no HTTP in it.

Three operations:

    request_sign_in   email      -> a code, emailed. No account is created.
    verify_code       email+code -> a session token. Account created if needed.
    revoke_session    token      -> that session is dead.

Kept free of FastAPI so the rules are testable directly and so the two
transports -- the extension's bearer token and the website's cookie -- cannot
drift apart by each growing their own copy of a check.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import hashlib

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.billing import FREE_EVALUATIONS, GUEST_FREE_EVALUATIONS, grant_free_credits
from app.config import Settings
from app.models import AuthSession, Capture, MagicLinkToken, SavedEvaluation, User

from .tokens import (
    canonicalize_code,
    generate_code,
    generate_session_token,
    hash_secret,
    normalize_email,
    secrets_equal,
)


class AuthError(Exception):
    """A sign-in attempt that failed for a reason the caller may be told."""


class GuestLimitError(Exception):
    """A guest pass was refused by a rate limit. The message is user-facing."""


def _as_utc(value: datetime) -> datetime:
    """Normalise to an aware UTC datetime before comparing.

    Same reason as `services/ingest.py`'s: not every backend round-trips
    timezone information -- SQLite drops it entirely -- so a value read back can
    be naive even though it was written aware, and comparing the two raises.

    It matters more here than there. Every comparison in this module is an
    expiry check, and an expiry check that raises is a sign-in that fails with a
    500 rather than a session that is correctly refused.
    """
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


@dataclass(frozen=True)
class IssuedSession:
    token: str
    user: User
    expires_at: datetime


def request_sign_in(session: Session, settings: Settings, *, email: str) -> tuple[str, str]:
    """Create a challenge. Returns (normalised email, plaintext code).

    The code is returned rather than emailed here: sending is I/O against a
    third party, and a mail failure must not leave a consumed-looking row
    behind. The caller sends it and the caller decides what to do when that
    fails.

    Any earlier unconsumed challenge for the same address is expired first. Two
    live codes in one inbox is a UX trap -- people reliably type the older one
    -- and it doubles the guessing surface for no benefit.
    """
    normalized = normalize_email(email)
    now = datetime.now(UTC)

    for stale in session.scalars(
        select(MagicLinkToken).where(
            MagicLinkToken.email == normalized,
            MagicLinkToken.consumed_at.is_(None),
            MagicLinkToken.expires_at > now,
        )
    ):
        stale.expires_at = now

    code = generate_code()
    session.add(
        MagicLinkToken(
            email=normalized,
            code_hash=hash_secret(code),
            created_at=now,
            expires_at=now + timedelta(minutes=settings.magic_link_ttl_minutes),
            attempts=0,
        )
    )
    session.flush()
    return normalized, code


def verify_code(
    session: Session,
    settings: Settings,
    *,
    email: str,
    code: str,
    client: str = "unknown",
    guest: User | None = None,
) -> IssuedSession:
    """Exchange a code for a session, creating the account on first success.

    `guest` is the caller's current session user, if it is a live guest (the
    extension sends its guest token on this call). Then:
      - an email with no account yet UPGRADES the guest row in place, keeping
        its captures, and tops the free allowance up to `FREE_EVALUATIONS`;
      - an email that already has an account absorbs the guest's captures and
        saved evaluations (`_merge_guest`) and gets no extra free checks.
    """
    normalized = normalize_email(email)
    candidate = canonicalize_code(code)
    now = datetime.now(UTC)

    # Fetched by email rather than by code hash so a wrong code still lands on
    # a row whose `attempts` can be incremented. Looking up by hash would make
    # every wrong guess a miss against nothing, and the attempt cap would count
    # only the typos of people who got it right.
    challenge = session.scalars(
        select(MagicLinkToken)
        .where(
            MagicLinkToken.email == normalized,
            MagicLinkToken.consumed_at.is_(None),
        )
        .order_by(MagicLinkToken.created_at.desc())
        .limit(1)
    ).first()

    if challenge is None or _as_utc(challenge.expires_at) <= now:
        raise AuthError("That code has expired or was already used. Request a new one.")

    if challenge.attempts >= settings.magic_link_max_attempts:
        raise AuthError("Too many attempts on that code. Request a new one.")

    if not secrets_equal(challenge.code_hash, hash_secret(candidate)):
        challenge.attempts += 1
        # Committed by the caller alongside the raised error, so the increment
        # survives. A rolled-back attempt counter is not a counter.
        raise AuthError("That code is not right.")

    challenge.consumed_at = now

    live_guest = (
        guest
        if guest is not None and guest.is_guest and guest.merged_into_user_id is None
        else None
    )

    user = session.scalars(select(User).where(User.email == normalized)).first()
    if user is None and live_guest is not None:
        # Upgrade in place: same id, so the check they already ran (and the
        # evaluation on screen) stays theirs with no data to move.
        user = live_guest
        user.email = normalized
        user.is_guest = False
        user.guest_ip_hash = None
        session.flush()
        grant_free_credits(session, user, FREE_EVALUATIONS - GUEST_FREE_EVALUATIONS)
    elif user is None:
        user = User(email=normalized, created_at=now)
        session.add(user)
        session.flush()
        # Free checks are granted at account creation, not extension install.
        # See `billing/ledger.py`.
        grant_free_credits(session, user)
    elif live_guest is not None and live_guest.id != user.id:
        _merge_guest(session, live_guest, into=user, now=now)

    token = generate_session_token()
    expires_at = now + timedelta(days=settings.session_ttl_days)
    session.add(
        AuthSession(
            user_id=user.id,
            token_hash=hash_secret(token),
            created_at=now,
            expires_at=expires_at,
            last_seen_at=now,
            client=client if client in {"extension", "web"} else "unknown",
        )
    )
    session.flush()

    return IssuedSession(token=token, user=user, expires_at=expires_at)


def _merge_guest(session: Session, guest: User, *, into: User, now: datetime) -> None:
    """Fold a guest into an existing account.

    Captures and saved evaluations move over, so the evaluation the guest just
    ran stays readable after signing in. A saved evaluation the account already
    has for the same listing wins; the guest's duplicate is dropped. The guest's
    unused free check is NOT transferred -- the account already had its free
    allowance, and transferring would let reinstalls top an account up.

    The guest row itself is kept (its ledger rows point at it) with every
    session revoked, so its token stops working everywhere at once.
    """
    session.execute(update(Capture).where(Capture.user_id == guest.id).values(user_id=into.id))

    existing_listings = set(
        session.scalars(
            select(SavedEvaluation.listing_id).where(
                SavedEvaluation.user_id == into.id, SavedEvaluation.listing_id.is_not(None)
            )
        )
    )
    existing_sources = set(
        session.scalars(
            select(SavedEvaluation.source_capture_id).where(SavedEvaluation.user_id == into.id)
        )
    )
    for saved in session.scalars(
        select(SavedEvaluation).where(SavedEvaluation.user_id == guest.id)
    ).all():
        duplicate = (
            saved.listing_id is not None and saved.listing_id in existing_listings
        ) or saved.source_capture_id in existing_sources
        if duplicate:
            session.delete(saved)
        else:
            saved.user_id = into.id

    session.execute(
        update(AuthSession)
        .where(AuthSession.user_id == guest.id, AuthSession.revoked_at.is_(None))
        .values(revoked_at=now)
    )
    guest.merged_into_user_id = into.id
    session.flush()


def hash_guest_ip(settings: Settings, ip: str) -> str:
    return hashlib.sha256(f"{settings.guest_ip_salt}:{ip}".encode()).hexdigest()


def create_guest(
    session: Session,
    settings: Settings,
    *,
    ip: str | None,
    client: str = "extension",
) -> IssuedSession:
    """A guest account and a session for it: the first check without an email.

    Refused (`GuestLimitError`) past `guest_max_per_ip_per_day` for this
    network or `guest_max_per_day` overall. The caller decides what to do --
    the extension falls back to asking for an email, which is exactly the
    pre-guest behaviour, so a refusal never blocks anyone from the product.
    """
    now = datetime.now(UTC)
    since = now - timedelta(days=1)

    issued_today = session.scalar(
        select(func.count(User.id)).where(User.guest_ip_hash.is_not(None), User.created_at > since)
    )
    if (issued_today or 0) >= settings.guest_max_per_day:
        raise GuestLimitError("Guest checks are busy right now. Sign in with your email to continue.")

    ip_hash = hash_guest_ip(settings, ip or "unknown")
    from_this_ip = session.scalar(
        select(func.count(User.id)).where(User.guest_ip_hash == ip_hash, User.created_at > since)
    )
    if (from_this_ip or 0) >= settings.guest_max_per_ip_per_day:
        raise GuestLimitError(
            "This network has used its free guest checks today. "
            "Sign in with your email to get your free checks."
        )

    user = User(email=None, created_at=now, is_guest=True, guest_ip_hash=ip_hash)
    session.add(user)
    session.flush()
    grant_free_credits(session, user, GUEST_FREE_EVALUATIONS, reason="guest_grant")

    token = generate_session_token()
    expires_at = now + timedelta(days=settings.session_ttl_days)
    session.add(
        AuthSession(
            user_id=user.id,
            token_hash=hash_secret(token),
            created_at=now,
            expires_at=expires_at,
            last_seen_at=now,
            client=client if client in {"extension", "web"} else "unknown",
        )
    )
    session.flush()
    return IssuedSession(token=token, user=user, expires_at=expires_at)


#: How stale `last_seen_at` is allowed to get. A write on every authenticated
#: request would make this the busiest table in the database in order to record
#: something nothing reads more precisely than "recently".
LAST_SEEN_RESOLUTION = timedelta(hours=24)


def resolve_session(session: Session, token: str) -> User | None:
    """The one place a token becomes a user. Both transports end up here."""
    if not token:
        return None

    now = datetime.now(UTC)
    row = session.scalars(
        select(AuthSession).where(AuthSession.token_hash == hash_secret(token))
    ).first()

    if row is None or row.revoked_at is not None or _as_utc(row.expires_at) <= now:
        return None

    if now - _as_utc(row.last_seen_at) > LAST_SEEN_RESOLUTION:
        row.last_seen_at = now

    return session.get(User, row.user_id)


def revoke_session(session: Session, token: str) -> bool:
    row = session.scalars(
        select(AuthSession).where(AuthSession.token_hash == hash_secret(token))
    ).first()
    if row is None or row.revoked_at is not None:
        return False
    row.revoked_at = datetime.now(UTC)
    return True
