import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import auth, captures, evaluations, health, saved, telemetry
from app.config import get_settings

logger = logging.getLogger(__name__)

settings = get_settings()

app = FastAPI(
    title="Deal Rater capture API",
    version="0.1.0",
    description=(
        "Ingests marketplace listing observations and persists them as an "
        "append-only time series. Client-agnostic by design: any client that "
        "can produce the capture payload can post to it."
    ),
)

if settings.cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        # Required for the website's httpOnly session cookie to be sent at all.
        # Legal here only because `allow_origins` is an explicit list: the spec
        # forbids credentials alongside a `*` origin, and Starlette will emit
        # the literal "*" -- silently breaking every credentialed request -- if
        # one is ever added to that setting. Keep it a list of exact origins.
        allow_credentials=True,
        # DELETE for unsaving. OPTIONS is handled by the middleware itself.
        allow_methods=["GET", "POST", "DELETE"],
        # Authorization for the extension's bearer token; the cookie needs no
        # header entry, since browsers attach it themselves.
        allow_headers=["Content-Type", "Authorization"],
    )
else:
    # An empty origin list registers no middleware at all, so every browser
    # client fails preflight with "No 'Access-Control-Allow-Origin' header is
    # present" and NOTHING appears in this log. The usual cause is not a missing
    # setting but a working directory: `env_file=".env"` is resolved relative to
    # the process's cwd, so starting uvicorn from the repo root instead of
    # `backend/` silently loads no configuration at all.
    #
    # This warning exists to make that failure visible on the server, where it
    # can be diagnosed, rather than only in the extension's error panel, where
    # it cannot.
    env_path = Path.cwd() / ".env"
    logger.warning(
        "CORS is DISABLED: no allowed origins configured, so every browser "
        "request will fail preflight. Set DEAL_RATER_CORS_ORIGINS. Looked for "
        "an env file at %s (%s). Working directory is %s; it must be the "
        "directory containing .env, normally backend/.",
        env_path,
        "found" if env_path.is_file() else "NOT FOUND",
        Path.cwd(),
    )

# Spec 6.6's one LLM call is the only per-call cost in the product, so its
# on/off state at startup is worth a single unambiguous line rather than
# requiring a code read or a triggered evaluation to discover.
if not settings.known_issues_enabled:
    logger.info(
        "Known-issues LLM call (spec 6.6): DISABLED (DEAL_RATER_KNOWN_ISSUES_ENABLED=false)"
    )
elif not settings.anthropic_api_key:
    logger.info("Known-issues LLM call (spec 6.6): DISABLED (no Anthropic API key configured)")
else:
    logger.info("Known-issues LLM call (spec 6.6): ENABLED (model=%s)", settings.known_issues_model)

if not settings.resend_api_key:
    logger.info(
        "Sign-in (magic link): DISABLED (no DEAL_RATER_RESEND_API_KEY). "
        "/v1/auth/sign-in returns 503; saving an evaluation is unreachable."
    )
else:
    logger.info("Sign-in (magic link): ENABLED (from=%s)", settings.auth_from_email)

# The website's session cookie fails in exactly one visible way -- the user
# signs in, and is immediately signed out again -- and the cause is almost
# always this value. An empty domain yields a host-only cookie that `app.`
# cannot read when `api.` set it, which is correct locally and fatal in
# production. One line at startup beats deducing it from a browser's cookie jar.
if settings.session_cookie_domain:
    logger.info(
        "Website session cookie: %s scoped to %s",
        settings.session_cookie_name,
        settings.session_cookie_domain,
    )
else:
    logger.warning(
        "Website session cookie: %s is HOST-ONLY (DEAL_RATER_SESSION_COOKIE_DOMAIN is "
        "empty). Correct for local development. In production this means the website "
        "cannot read the cookie the API sets, and every web sign-in appears to fail.",
        settings.session_cookie_name,
    )

app.include_router(health.router)
app.include_router(captures.router)
app.include_router(telemetry.router)
app.include_router(evaluations.router)
app.include_router(auth.router)
app.include_router(saved.router)
