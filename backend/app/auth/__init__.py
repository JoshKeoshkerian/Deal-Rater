"""Accounts and sessions (magic link only -- no passwords, by decision)."""

from .dependencies import current_user, require_user, session_token
from .service import AuthError, IssuedSession, request_sign_in, revoke_session, verify_code

__all__ = [
    "AuthError",
    "IssuedSession",
    "current_user",
    "request_sign_in",
    "require_user",
    "revoke_session",
    "session_token",
    "verify_code",
]
