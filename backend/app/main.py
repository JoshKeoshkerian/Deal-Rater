import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import captures, evaluations, health, telemetry
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
        allow_credentials=False,
        allow_methods=["POST", "GET"],
        allow_headers=["Content-Type"],
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

app.include_router(health.router)
app.include_router(captures.router)
app.include_router(telemetry.router)
app.include_router(evaluations.router)
