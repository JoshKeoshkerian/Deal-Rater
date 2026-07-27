"""The cached text call itself (spec 3, 6.6, 10).

    read cache  ->  hit?  ->  serve, cost 0
                     |
                    miss  ->  one Claude call  ->  guard  ->  store  ->  serve

Every path returns a `KnownIssuesReading`. Nothing here raises: an outage, a
missing key, a malformed response and a refusal all degrade to a reading with an
`unavailable_reason` attached, exactly as the NHTSA client degrades on a failed
decode. The pricing model must not be able to fail because a text call did.

WHY THE ENTIRE FEATURE IS OPT-IN
--------------------------------
Spec 3's billing note: "A Claude.ai subscription and Claude API access are
separate products... Without vision the per-evaluation cost is small, but
instrument it from day one." With no key configured the evaluation is exactly
what it was before this module existed, and says so.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import Settings
from ..models import KnownIssuesEntry
from . import params
from .guard import SUMMARY_WITHHELD, contains_currency, scrub_bullets
from .prompt import SYSTEM_PROMPT, KnownIssuesReport, build_user_prompt

logger = logging.getLogger(__name__)

#: Long enough for a cold Haiku call, short enough that a hung connection does
#: not hold an evaluation request open.
REQUEST_TIMEOUT_SECONDS = 30

NOT_CONFIGURED_REASON = (
    "Not available: no Claude API key is configured. Spec 6.6's model-specific "
    "known issues are the one part of this evaluation with a per-call cost, so "
    "they are off unless a key is set."
)

DISABLED_REASON = (
    "Not available: the known-issues call is switched off in this deployment's "
    "configuration."
)

OFFLINE_REASON = (
    "Not available: this evaluation ran offline, and no cached answer exists for "
    "this vehicle and mileage band yet."
)

FAILED_REASON = (
    "Not available: the known-issues call did not complete. The rest of this "
    "evaluation is unaffected -- it is all computed from the listing and its "
    "comps."
)

#: The default on an `Evaluation` assembled without this section at all, e.g. by
#: a CLI or a test that never asked for it. Distinct from the reasons above so
#: that "nobody looked" is never mistaken for "we looked and there is nothing".
NOT_REQUESTED_REASON = "Not available: this evaluation did not request known issues."


@dataclass(frozen=True)
class KnownIssuesReading:
    """What the evaluation carries for spec 7's item 7.

    `report` is None whenever the section cannot be shown, and
    `unavailable_reason` then explains which of the several reasons applies.
    Both are always present so a renderer never has to guess.
    """

    report: KnownIssuesReport | None = None
    unavailable_reason: str | None = None

    #: Populated on success, for display and for auditing which model spoke.
    llm_model: str | None = None
    mileage_band: str | None = None
    generated_at: datetime | None = None

    #: True when this evaluation cost nothing. Spec 10's cache-hit rate is the
    #: number that decides whether this feature is affordable.
    cache_hit: bool = False

    #: Set when the gate declined to spend a call (spec 10), so telemetry can
    #: separate "we chose not to" from "it failed".
    skip_code: str | None = None

    @property
    def available(self) -> bool:
        return self.report is not None


def _normalize(value: str) -> str:
    return " ".join(value.strip().lower().split())


def _lookup(
    session: Session,
    *,
    year: int,
    make: str,
    model: str,
    trim: str,
    band: str,
    llm_model: str,
) -> KnownIssuesEntry | None:
    return session.scalars(
        select(KnownIssuesEntry).where(
            KnownIssuesEntry.model_year == year,
            KnownIssuesEntry.make == make,
            KnownIssuesEntry.model == model,
            KnownIssuesEntry.trim == trim,
            KnownIssuesEntry.mileage_band == band,
            KnownIssuesEntry.llm_model == llm_model,
            KnownIssuesEntry.prompt_version == params.PROMPT_VERSION,
        )
    ).first()


def _to_report(entry: KnownIssuesEntry) -> KnownIssuesReport:
    return KnownIssuesReport(
        summary=entry.summary,
        failure_modes=list(entry.failure_modes or []),
        inspect=list(entry.inspect or []),
        ask=list(entry.ask or []),
        ownership_notes=list(entry.ownership_notes or []),
    )


def _serve(session: Session, entry: KnownIssuesEntry, *, cache_hit: bool) -> KnownIssuesReading:
    """Record that this row answered an evaluation, then return it.

    The counter is why spec 10's cost-per-evaluation is computable: a cache hit
    is free, so dividing total spend by call count would understate the real
    per-evaluation cost by the cache-hit rate.
    """
    entry.served_count = (entry.served_count or 0) + 1
    entry.last_served_at = datetime.now(UTC)
    session.add(entry)
    session.commit()

    return KnownIssuesReading(
        report=_to_report(entry),
        llm_model=entry.llm_model,
        mileage_band=entry.mileage_band,
        generated_at=entry.generated_at,
        cache_hit=cache_hit,
    )


@dataclass(frozen=True)
class _Completion:
    """One model response, already parsed and validated."""

    report: KnownIssuesReport
    input_tokens: int
    output_tokens: int


def _call_model(
    *,
    api_key: str,
    llm_model: str,
    user_prompt: str,
) -> _Completion | None:
    """One structured Claude call. Returns None on any failure.

    `anthropic` is imported here rather than at module scope so the package is
    only needed by deployments that have the feature switched on, and so the
    test suite -- which never reaches this function -- does not depend on it.

    Structured output is used rather than free prose so that a truncated or
    off-format answer fails to validate here instead of reaching a user as a
    half sentence.
    """
    try:
        import anthropic
    except ImportError:
        logger.warning("known-issues call skipped: the `anthropic` package is not installed")
        return None

    try:
        client = anthropic.Anthropic(api_key=api_key, timeout=REQUEST_TIMEOUT_SECONDS)
        response = client.messages.parse(
            model=llm_model,
            max_tokens=params.MAX_TOKENS,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_prompt}],
            output_format=KnownIssuesReport,
        )
    except Exception as exc:  # noqa: BLE001 - see the module docstring
        # Deliberately broad. Auth errors, rate limits, timeouts, connection
        # failures and validation errors all have the same consequence for the
        # caller: this section is unavailable and nothing else changes.
        logger.warning("known-issues call failed (%s): %s", type(exc).__name__, exc)
        return None

    if response.stop_reason == "refusal":
        logger.warning("known-issues call refused by safety classifiers")
        return None

    report = response.parsed_output
    if report is None:
        logger.warning("known-issues call returned unparseable output")
        return None

    usage = response.usage
    return _Completion(
        report=report,
        input_tokens=getattr(usage, "input_tokens", 0) or 0,
        output_tokens=getattr(usage, "output_tokens", 0) or 0,
    )


def _apply_guard(report: KnownIssuesReport) -> tuple[KnownIssuesReport | None, int]:
    """Enforce spec 6.6's no-dollar-figures rule. See `guard.py`.

    Offending items are removed, not rewritten -- there is no safe way to edit a
    fabricated figure out of a sentence and still trust what is left of it.

    A bad SUMMARY does not discard the answer, provided some finding survives:
    the summary is replaced with `SUMMARY_WITHHELD`, which is this codebase
    speaking rather than the model, and says so. Discarding everything would
    throw away good findings AND re-pay for the call on the next evaluation,
    since nothing gets cached -- and the vehicles that provoke this are the
    expensive ones, where the findings are worth the most.

    Only when nothing at all survives is the answer refused.
    """
    failure_modes, d1 = scrub_bullets(report.failure_modes)
    inspect, d2 = scrub_bullets(report.inspect)
    ask, d3 = scrub_bullets(report.ask)
    ownership_notes, d4 = scrub_bullets(report.ownership_notes)
    dropped = d1 + d2 + d3 + d4

    summary = report.summary
    if contains_currency(summary):
        if not (failure_modes or inspect or ask or ownership_notes):
            logger.warning(
                "known-issues answer discarded: the summary stated a money figure and "
                "no finding survived"
            )
            return None, 0
        logger.warning("known-issues answer: summary withheld for stating a money figure")
        summary = SUMMARY_WITHHELD
        dropped += 1

    if dropped:
        logger.warning("known-issues answer: removed %d item(s) stating money figures", dropped)

    return (
        KnownIssuesReport(
            summary=summary,
            failure_modes=list(failure_modes),
            inspect=list(inspect),
            ask=list(ask),
            ownership_notes=list(ownership_notes),
        ),
        dropped,
    )


def fetch_known_issues(
    session: Session,
    settings: Settings,
    *,
    year: int,
    make: str,
    model: str,
    trim: str | None,
    mileage: int | None,
    offline: bool = False,
) -> KnownIssuesReading:
    """Cached ownership-cost context for one vehicle (spec 6.6).

    The caller is responsible for spec 10's gate (`gate.py`); by the time this
    runs, the decision to allow a call has already been made. What is decided
    here is only whether the answer already exists.
    """
    llm_model = settings.known_issues_model
    band = params.mileage_band(mileage)
    key = {
        "year": year,
        "make": _normalize(make),
        "model": _normalize(model),
        "trim": _normalize(trim) if trim else "",
        "band": band,
        "llm_model": llm_model,
    }

    cached = _lookup(session, **key)
    if cached is not None:
        return _serve(session, cached, cache_hit=True)

    if not settings.known_issues_enabled:
        return KnownIssuesReading(unavailable_reason=DISABLED_REASON, mileage_band=band)
    if offline:
        return KnownIssuesReading(unavailable_reason=OFFLINE_REASON, mileage_band=band)
    if not settings.anthropic_api_key:
        return KnownIssuesReading(unavailable_reason=NOT_CONFIGURED_REASON, mileage_band=band)

    completion = _call_model(
        api_key=settings.anthropic_api_key,
        llm_model=llm_model,
        user_prompt=build_user_prompt(
            year=year,
            make=make.strip(),
            model=model.strip(),
            trim=trim.strip() if trim else None,
            mileage_band=band,
        ),
    )
    if completion is None:
        return KnownIssuesReading(unavailable_reason=FAILED_REASON, mileage_band=band)

    guarded, dropped = _apply_guard(completion.report)
    if guarded is None:
        # Not cached: storing it would make one bad answer permanent, and the
        # next attempt may well be clean.
        return KnownIssuesReading(unavailable_reason=FAILED_REASON, mileage_band=band)

    entry = KnownIssuesEntry(
        model_year=year,
        make=key["make"],
        model=key["model"],
        trim=key["trim"],
        mileage_band=band,
        llm_model=llm_model,
        prompt_version=params.PROMPT_VERSION,
        generated_at=datetime.now(UTC),
        summary=guarded.summary,
        failure_modes=list(guarded.failure_modes),
        inspect=list(guarded.inspect),
        ask=list(guarded.ask),
        ownership_notes=list(guarded.ownership_notes),
        currency_items_dropped=dropped,
        input_tokens=completion.input_tokens,
        output_tokens=completion.output_tokens,
        cost_microdollars=params.cost_microdollars(
            completion.input_tokens, completion.output_tokens
        ),
        served_count=0,
    )
    session.add(entry)
    session.commit()

    return _serve(session, entry, cache_hit=False)
