from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="DEAL_RATER_",
        extra="ignore",
    )

    database_url: str = "postgresql+psycopg://dealrater:dealrater@localhost:5432/dealrater"

    # Spec 8.2: "Set a retention window and enforce it programmatically."
    # Enforcement lives in app/retention.py and must be run on a schedule you own.
    retention_days: int = 400

    # Any client that posts captures needs its origin listed here. The API has no
    # knowledge of which client is calling beyond the `client` block on the payload.
    cors_origins: list[str] = []

    # Cap on comps accepted in a single capture. A search result page yields well
    # under this; a payload above it means something is wrong upstream.
    max_comps_per_capture: int = 200


@lru_cache
def get_settings() -> Settings:
    return Settings()
