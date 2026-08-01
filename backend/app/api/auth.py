"""Sign-in endpoints.

    POST /v1/auth/sign-in    request a code by email
    POST /v1/auth/verify     exchange the code for a session token
    POST /v1/auth/sign-out   revoke the presented session
    GET  /v1/users/me        who the presented session belongs to

Magic link only. There is no password endpoint here and adding one would
undo the point: a product that stores no password cannot leak one.

TWO TRANSPORTS, DECIDED BY `client`, AND ONLY ONE OF THEM EVER SEES THE TOKEN
-----------------------------------------------------------------------------
`client: "extension"` gets the token in the response body, because a
chrome-extension:// origin cannot usefully carry a cookie; it stores it in
`chrome.storage.local`.

`client: "web"` gets an httpOnly cookie and `token: null`. Page JavaScript that
can read a session token is one XSS away from handing it over, and the website
has no need to hold it: the browser attaches the cookie by itself.

The session behind both is identical, and `auth/dependencies.py` resolves them
through one lookup. `client` chooses a transport, never a permission -- it is an
unauthenticated string from the caller, and nothing here trusts it for anything
else.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.auth import AuthError, request_sign_in, revoke_session, session_token, verify_code
from app.auth.dependencies import require_user
from app.auth.mailer import MailerError, send_sign_in_email
from app.config import get_settings
from app.db import get_session
from app.models import User
from app.schemas import SessionOut, SignInRequestIn, SignInRequestOut, UserOut, VerifyCodeIn

router = APIRouter(prefix="/v1", tags=["auth"])


def _set_session_cookie(response: Response, settings, token: str) -> None:
    """Attach the website's session cookie.

    `secure=True` unconditionally: the cookie is only ever issued over HTTPS in
    production, and Chrome and Firefox both permit Secure cookies on
    http://localhost, so local development is not a reason to weaken it.

    `samesite="lax"` rather than "none". `app.` and `api.` share the registrable
    domain, so requests between them are same-SITE even though they are
    cross-ORIGIN, and Lax only restricts the former. "none" would also work and
    is strictly weaker, which is reason enough not to use it.
    """
    response.set_cookie(
        key=settings.session_cookie_name,
        value=token,
        max_age=settings.session_ttl_days * 24 * 60 * 60,
        httponly=True,
        secure=True,
        samesite="lax",
        path="/",
        # Empty means a host-only cookie, which is correct for local dev and
        # which `app.` could not read in production. See `config.py`.
        domain=settings.session_cookie_domain or None,
    )


@router.post("/auth/sign-in", response_model=SignInRequestOut)
def sign_in(payload: SignInRequestIn, session: Session = Depends(get_session)) -> SignInRequestOut:
    settings = get_settings()

    if not settings.resend_api_key:
        # 503 rather than a cheerful 200. An endpoint that accepts an address
        # and sends nothing is indistinguishable, from the user's side, from a
        # working one whose mail was lost -- and they will wait for the email
        # either way.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Sign-in is not available: this server has no email provider configured.",
        )

    email, code = request_sign_in(session, settings, email=payload.email)

    try:
        send_sign_in_email(settings, to=email, code=code)
    except MailerError as error:
        # The challenge row stays uncommitted, so a failed send leaves no
        # orphaned code behind and the next attempt starts clean.
        session.rollback()
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Could not send the sign-in email: {error}",
        ) from error

    session.commit()

    return SignInRequestOut(
        message=(
            "If that address can receive mail, a sign-in code is on its way. "
            "It works once, and only for this address."
        ),
        expires_in_minutes=settings.magic_link_ttl_minutes,
    )


@router.post("/auth/verify", response_model=SessionOut)
def verify(
    payload: VerifyCodeIn,
    response: Response,
    session: Session = Depends(get_session),
) -> SessionOut:
    settings = get_settings()
    try:
        issued = verify_code(
            session,
            settings,
            email=payload.email,
            code=payload.code,
            client=payload.client,
        )
    except AuthError as error:
        # Committed rather than rolled back: a wrong code increments the
        # attempt counter, and an attempt counter that unwinds on failure is
        # not a counter. The 401 is raised after the write is durable.
        session.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail=str(error)
        ) from error

    session.commit()

    web = payload.client == "web"
    if web:
        _set_session_cookie(response, settings, issued.token)

    return SessionOut(
        # Withheld from the website deliberately: it already has the session, in
        # the one place page scripts cannot read it.
        token=None if web else issued.token,
        expires_at=issued.expires_at,
        user=UserOut(
            id=issued.user.id, email=issued.user.email, created_at=issued.user.created_at
        ),
    )


@router.post("/auth/sign-out", status_code=status.HTTP_204_NO_CONTENT)
def sign_out(
    request: Request,
    response: Response,
    session: Session = Depends(get_session),
) -> None:
    """Revoke the presented session.

    Deliberately NOT behind `require_user`: signing out with a token that is
    already expired or revoked should be a no-op that succeeds, not a 401 that
    leaves the client unsure whether it is still signed in.
    """
    token = session_token(request)
    if token:
        revoke_session(session, token)
        session.commit()

    # Cleared unconditionally, and with the SAME domain and path it was set
    # with -- a delete_cookie whose attributes do not match writes a second,
    # different cookie and leaves the original in place, which reads as a
    # sign-out that did not work.
    #
    # Revoking server-side is what actually ends the session; this stops the
    # browser from sending a dead token on every subsequent request.
    settings = get_settings()
    response.delete_cookie(
        key=settings.session_cookie_name,
        path="/",
        domain=settings.session_cookie_domain or None,
    )


@router.get("/users/me", response_model=UserOut)
def me(user: User = Depends(require_user)) -> UserOut:
    return UserOut(id=user.id, email=user.email, created_at=user.created_at)
