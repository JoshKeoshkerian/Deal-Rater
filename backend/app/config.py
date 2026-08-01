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

    # --- Accounts and saved evaluations -------------------------------------
    #
    # Auth is magic-link only: an emailed code is exchanged for a session token.
    # There is no password anywhere in this system and there should not be one.

    # Resend, chosen over Postmark purely for setup friction: an API key and a
    # single POST, with no per-domain approval step before the first send.
    # Unset means sign-in is DISABLED rather than silently broken -- the
    # magic-link endpoint returns 503 and says so, because an endpoint that
    # accepts an address and sends nothing is indistinguishable from a working
    # one that lost the mail.
    resend_api_key: str | None = None

    # Must be on a domain verified in Resend. The default is deliberately
    # invalid-looking so an unconfigured deployment fails at Resend rather than
    # sending from somewhere plausible.
    auth_from_email: str = "Curbside <login@example.invalid>"

    # Where the website lives, used to build the link in the email. The
    # extension's paste-a-code flow does not need it; the emailed link does.
    app_base_url: str = "https://app.curbsidescore.com"

    # Short by design: the code is in an inbox, and the whole flow is a person
    # switching to their mail app and back.
    magic_link_ttl_minutes: int = 15
    # How many wrong codes one challenge tolerates before it is dead.
    magic_link_max_attempts: int = 5

    # Long by design on the other side: re-authenticating a browser extension
    # is disproportionately annoying, and the token is revocable server-side.
    session_ttl_days: int = 90

    # --- Cookie transport (website) -----------------------------------------
    #
    # The website's session. `api.curbsidescore.com` and `app.curbsidescore.com`
    # share the registrable domain `curbsidescore.com`, which is what makes this
    # work at all -- the earlier *.up.railway.app host is on the Public Suffix
    # List, so a cookie scoped there was refused by the browser outright.
    #
    # Sharing an eTLD+1 also makes the two subdomains SAME-SITE, so `SameSite=Lax`
    # is sent on the website's fetches to the API. Lax restricts cross-SITE
    # requests, not cross-ORIGIN ones. `None` would work too and is strictly
    # weaker, so it is not used.
    session_cookie_name: str = "curbside_session"

    #: Leading dot: the cookie must be readable by `app.` while being SET by
    #: `api.`, which a host-only cookie is not.
    #:
    #: DEFAULTED TO PRODUCTION ON PURPOSE. Empty is a legal value that yields a
    #: host-only cookie -- correct for local development, and a silent, total
    #: sign-in failure on the website in production, visible only as "signed out
    #: immediately after signing in". A default that is wrong for dev fails
    #: loudly on one machine; a default that is wrong for production fails
    #: quietly for every user. `main.py` logs whichever value is in force at
    #: startup so this is never something to guess at.
    session_cookie_domain: str = ".curbsidescore.com"


@lru_cache
def get_settings() -> Settings:
    return Settings()
