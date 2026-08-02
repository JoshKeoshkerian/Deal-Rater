"""Accounts and sessions (magic link only -- no passwords, by decision)."""

from .dependencies import bearer_token, current_user, require_user, session_token
from .service import (
    AuthError,
    IssuedSession,
    request_sign_in,
    resolve_session,
    revoke_session,
    verify_code,
)

__all__ = [
    "AuthError",
    "IssuedSession",
    "bearer_token",
    "current_user",
    "request_sign_in",
    "require_user",
    "resolve_session",
    "revoke_session",
    "session_token",
    "verify_code",
]
