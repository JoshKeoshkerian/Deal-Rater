from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import captures, health, telemetry
from app.config import get_settings

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

app.include_router(health.router)
app.include_router(captures.router)
app.include_router(telemetry.router)
