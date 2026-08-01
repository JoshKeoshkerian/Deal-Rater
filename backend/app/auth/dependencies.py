"""The FastAPI dependency that turns a request into a user.

ONE FUNCTION READS BOTH TRANSPORTS. The extension sends
`Authorization: Bearer <token>` because a cross-origin cookie from a
chrome-extension:// origin is not a thing; the website sends an httpOnly cookie
because a token in reachable JavaScript on a page is an XSS away from being
stolen. Those are different transports for the identical secret, and both are
resolved by `service.resolve_session`.

The alternative -- a bearer path and a cookie path, each with its own expiry and
revocation checks -- is exactly the duplicated client-side auth logic this
design exists to avoid. There is one lookup and one set of rules; the only thing
that varies is which header the string was pulled out of.

THE COOKIE BRANCH IS LIVE BUT NOTHING ISSUES A COOKIE YET. The API and the
website must share a registrable domain first, and the API is currently on
*.up.railway.app, which is on the Public Suffix List -- a cookie scoped there is
refused by the browser outright. Reading it now costs three lines and means the
website needs no change to this file when DNS is ready.
"""

from __future__ import annotations

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_session
from app.models import User

from .service import resolve_session


def bearer_token(request: Request) -> str | None:
    header = request.headers.get("Authorization")
    if not header:
        return None
    scheme, _, value = header.partition(" ")
    if scheme.lower() != "bearer" or not value.strip():
        return None
    return value.strip()


def session_token(request: Request) -> str | None:
    """The presented token, from whichever transport carried it.

    Header first: if a request somehow carries both, the explicit one wins over
    the ambient one. A cookie is attached by the browser without the caller
    asking, so it is the weaker claim about intent.
    """
    return bearer_token(request) or request.cookies.get(get_settings().session_cookie_name)


def current_user(
    request: Request,
    session: Session = Depends(get_session),
) -> User | None:
    """The signed-in user, or None. Never raises."""
    token = session_token(request)
    return resolve_session(session, token) if token else None


def require_user(user: User | None = Depends(current_user)) -> User:
    """The signed-in user, or 401.

    `WWW-Authenticate: Bearer` is set because that is what the header actually
    is; no browser will act on it, but a 401 without it is malformed.
    """
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sign in to do that.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user
