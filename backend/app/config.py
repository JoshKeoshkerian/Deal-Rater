from functools import lru_cache

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="DEAL_RATER_",
        extra="ignore",
        # `anthropic_api_key` carries a validation alias so the bare
        # ANTHROPIC_API_KEY is also honoured. Without this, that alias would
        # become the ONLY accepted name and `Settings(anthropic_api_key=...)`
        # would silently fall back to the default -- which is how a test, or a
        # caller constructing settings directly, ends up unconfigured for
        # reasons that are invisible at the call site.
        populate_by_name=True,
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

    # --- Spec 6.6 / 10: the one LLM call ------------------------------------
    #
    # Spec 3's billing note: "A Claude.ai subscription and Claude API access are
    # separate products... runtime calls require a separate Console account at
    # standard API rates." Unset means the known-issues section is simply absent
    # and every other dimension is unaffected.
    #
    # Also accepted under the bare ANTHROPIC_API_KEY that the Anthropic SDK and
    # CLI already use, so a machine that can talk to the API does not need the
    # same secret written twice under two names.
    anthropic_api_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices("DEAL_RATER_ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY"),
    )

    # Cheapest current Claude model, which is the right tier for recall of
    # documented failure modes plus a short summary. See known_issues/params.py
    # -- CHANGING THIS ALSO REQUIRES UPDATING THE COST RATES THERE, which are
    # per-token and model-specific.
    known_issues_model: str = "claude-haiku-4-5"

    # Kill switch independent of the key, so the call can be turned off for a
    # deployment without removing credentials from it.
    known_issues_enabled: bool = True


@lru_cache
def get_settings() -> Settings:
    return Settings()
