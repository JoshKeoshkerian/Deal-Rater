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

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Settings
from app.models import AuthSession, MagicLinkToken, User

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
) -> IssuedSession:
    """Exchange a code for a session, creating the account on first success."""
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

    user = session.scalars(select(User).where(User.email == normalized)).first()
    if user is None:
        user = User(email=normalized, created_at=now)
        session.add(user)
        session.flush()

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
