"""Ownership cost context: spec 6.6's cached LLM call, and spec 10's controls.

NO TEST HERE REACHES THE NETWORK. The one function that would (`_call_model`)
is replaced everywhere, so the suite stays free, fast and deterministic -- which
is also the point of the design under test: the call is behind a gate, a cache
and a guard, and all three are testable without it.

The claims under test:

  1. Spec 6.6's hard rule holds: no dollar figure ever reaches a user.
  2. Spec 10's gate refuses to spend a call, and says why.
  3. Spec 10's cache is keyed by VEHICLE, not by listing.
  4. Cost is instrumented, including the denominator that makes it meaningful.
  5. A failure of any kind degrades this section and nothing else.
"""

from __future__ import annotations

import sys
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

from app.config import Settings
from app.flags import read_title_status
from app.known_issues import client as ki_client
from app.known_issues import params
from app.known_issues.client import (
    NOT_CONFIGURED_REASON,
    OFFLINE_REASON,
    _Completion,
    fetch_known_issues,
)
from app.known_issues.gate import evaluate_gate, find_disqualifier
from app.known_issues.guard import SUMMARY_WITHHELD, contains_currency, scrub_bullets
from app.known_issues.prompt import SYSTEM_PROMPT, KnownIssuesReport, build_user_prompt
from app.models import KnownIssuesEntry


def settings(**overrides) -> Settings:
    base = {
        "anthropic_api_key": "sk-ant-test",
        "known_issues_model": "claude-haiku-4-5",
        "known_issues_enabled": True,
    }
    base.update(overrides)
    return Settings(**base)


def report(**overrides) -> KnownIssuesReport:
    base = {
        "summary": "This generation is generally durable, with one known weak point.",
        "failure_modes": ["The dual-clutch transmission shudders at low speed."],
        "inspect": ["Drive it from a stop in traffic and feel for shudder."],
        "ask": ["Ask whether the clutch pack has been replaced."],
        "ownership_notes": ["Transmission work on this car is dealer-only in most areas."],
    }
    base.update(overrides)
    return KnownIssuesReport(**base)


def fake_call(completion: _Completion | None, calls: list):
    def _call(**kwargs):
        calls.append(kwargs)
        return completion

    return _call


def fake_call_sequence(completions: list, calls: list):
    """One `_call_model` stub per call, in order -- for exercising the retry."""
    it = iter(completions)

    def _call(**kwargs):
        calls.append(kwargs)
        return next(it)

    return _call


def completion(rep: KnownIssuesReport | None = None, *, inp=1200, out=300) -> _Completion:
    return _Completion(report=rep or report(), input_tokens=inp, output_tokens=out)


def fetch(session, monkeypatch, *, completion_=..., cfg=None, **overrides):
    """Run one fetch with the network replaced. Returns (reading, calls_made)."""
    calls: list = []
    monkeypatch.setattr(
        ki_client,
        "_call_model",
        fake_call(completion() if completion_ is ... else completion_, calls),
    )
    args = {
        "year": 2013,
        "make": "Ford",
        "model": "Focus",
        "trim": "SE",
        "mileage": 90_000,
    }
    args.update(overrides)
    reading = fetch_known_issues(session, cfg or settings(), **args)
    return reading, calls


def fetch_seq(session, monkeypatch, completions: list, *, cfg=None, **overrides):
    """Like `fetch`, but each `_call_model` invocation gets the next completion
    in `completions` -- for tests where the first and retry answers differ."""
    calls: list = []
    monkeypatch.setattr(ki_client, "_call_model", fake_call_sequence(completions, calls))
    args = {
        "year": 2013,
        "make": "Ford",
        "model": "Focus",
        "trim": "SE",
        "mileage": 90_000,
    }
    args.update(overrides)
    reading = fetch_known_issues(session, cfg or settings(), **args)
    return reading, calls


class TestNoDollarFiguresEverReachAUser:
    """Spec 6.6: "Do not attach dollar estimates." Enforced in code, not prompt."""

    @pytest.mark.parametrize(
        "text",
        [
            "Expect $2,800 to $4,600 for the repair.",
            "The clutch pack runs about 1500 dollars.",
            "Budget a few hundred dollars a year.",
            "Roughly 900 USD at an independent shop.",
            "It's a couple grand to fix.",
            "Around 300 bucks.",
            "Typically 2k to 4k depending on the shop.",
        ],
    )
    def test_money_in_any_form_is_detected(self, text):
        assert contains_currency(text)

    @pytest.mark.parametrize(
        "text",
        [
            "The dual-clutch transmission shudders at low speed.",
            "Ask for service records covering the timing belt.",
            "Parts are widely available and servicing is not specialist work.",
            # Mileage and model years must not trip the guard.
            "Failures cluster around 90,000 miles on 2012-2014 cars.",
        ],
    )
    def test_ordinary_qualitative_advice_is_not(self, text):
        assert not contains_currency(text)

    def test_an_offending_bullet_is_dropped_and_counted(self):
        kept, dropped = scrub_bullets(
            ["Clutch packs fail early.", "A replacement costs about $2,000."]
        )
        assert kept == ("Clutch packs fail early.",)
        assert dropped == 1

    def test_a_bad_summary_is_replaced_and_the_findings_survive(self, session, monkeypatch):
        # Discarding everything would lose good findings AND re-pay for the call
        # on the next evaluation. The substitute says it is the tool speaking.
        bad = report(summary="Plan on $3,000 of transmission work.")
        reading, _ = fetch(session, monkeypatch, completion_=completion(bad))

        assert reading.available
        assert reading.report.summary == SUMMARY_WITHHELD
        assert not contains_currency(reading.report.summary)
        assert reading.report.failure_modes == report().failure_modes
        assert session.query(KnownIssuesEntry).one().currency_items_dropped == 1

    def test_an_answer_that_is_nothing_but_a_figure_is_refused(self, session, monkeypatch):
        # Nothing survives, so there is nothing to salvage and nothing to cache:
        # one bad answer must not become permanent.
        bad = KnownIssuesReport(summary="Budget about $3,000.", failure_modes=["Costs $900."])
        reading, _ = fetch(session, monkeypatch, completion_=completion(bad))

        assert not reading.available
        assert reading.unavailable_reason
        assert session.query(KnownIssuesEntry).count() == 0

    def test_a_bad_bullet_is_recorded_on_the_cache_row(self, session, monkeypatch):
        # Non-zero here means the prompt is not holding on its own, which is
        # worth knowing before it happens in a field the guard cannot scrub.
        bad = report(ownership_notes=["Insurance runs about $2,400 a year."])
        reading, _ = fetch(session, monkeypatch, completion_=completion(bad))

        assert reading.available
        assert reading.report.ownership_notes == []
        assert session.query(KnownIssuesEntry).one().currency_items_dropped == 1

    def test_the_prompt_also_forbids_it(self):
        # Belt and braces: the guard is the guarantee, the prompt is the ask.
        assert "NEVER STATE A COST" in SYSTEM_PROMPT


class TestCorrectiveRetry:
    """A dollar figure on the first attempt earns one retry before the guard's
    scrub becomes the answer cached indefinitely for this vehicle and band."""

    def test_a_clean_retry_replaces_the_tainted_first_answer(self, session, monkeypatch):
        bad = report(summary="Budget about $3,000 for the clutch.")
        clean = report(summary="This generation is durable with proper maintenance.")
        reading, calls = fetch_seq(session, monkeypatch, [completion(bad), completion(clean)])

        assert len(calls) == 2
        assert "dollar figure" not in calls[0]["user_prompt"].lower()
        assert "dollar figure" in calls[1]["user_prompt"].lower()
        assert reading.available
        assert reading.report.summary == clean.summary
        assert reading.report.summary != SUMMARY_WITHHELD
        assert session.query(KnownIssuesEntry).one().currency_items_dropped == 0

    def test_a_second_violation_falls_back_to_the_guard(self, session, monkeypatch):
        bad = report(summary="Budget about $3,000 for the clutch.")
        reading, calls = fetch_seq(session, monkeypatch, [completion(bad), completion(bad)])

        assert len(calls) == 2
        assert reading.available
        assert reading.report.summary == SUMMARY_WITHHELD

    def test_a_clean_first_answer_never_retries(self, session, monkeypatch):
        # A second `next()` on the sequence would raise if a retry fired here.
        reading, calls = fetch_seq(session, monkeypatch, [completion()])
        assert len(calls) == 1
        assert reading.report.summary == report().summary

    def test_cost_covers_both_calls_when_a_retry_happens(self, session, monkeypatch):
        bad = report(summary="Budget about $3,000 for the clutch.")
        clean = report(summary="This generation is durable with proper maintenance.")
        fetch_seq(
            session,
            monkeypatch,
            [completion(bad, inp=1000, out=200), completion(clean, inp=900, out=250)],
        )
        row = session.query(KnownIssuesEntry).one()
        assert (row.input_tokens, row.output_tokens) == (1900, 450)
        assert row.cost_microdollars == params.cost_microdollars(1900, 450)

    def test_a_failed_retry_call_falls_back_to_the_first_guarded_answer(self, session, monkeypatch):
        # The retry's network call itself comes back empty rather than with a
        # bad report -- the first attempt's guarded result must still be used,
        # not treated as if nothing was ever produced.
        bad = report(summary="Budget about $3,000 for the clutch.")
        reading, calls = fetch_seq(session, monkeypatch, [completion(bad), None])

        assert len(calls) == 2
        assert reading.available
        assert reading.report.summary == SUMMARY_WITHHELD

    def test_a_total_wash_still_gets_a_retry_despite_zero_dropped(self, session, monkeypatch):
        # `_apply_guard` reports `dropped=0` on a total refusal (nothing
        # survived to count), which is exactly the case the retry trigger must
        # not miss by checking `dropped` alone.
        all_money = KnownIssuesReport(summary="Budget about $3,000.", failure_modes=["Costs $900."])
        clean = report(summary="This generation is durable with proper maintenance.")
        reading, calls = fetch_seq(session, monkeypatch, [completion(all_money), completion(clean)])

        assert len(calls) == 2
        assert reading.available
        assert reading.report.summary == clean.summary


class TestSpecTenGate:
    """"Gate the LLM call behind deterministic checks" -- and say why."""

    def allow_args(self, **overrides):
        base = {
            "title": read_title_status("clean"),
            "description": "Runs great, well maintained.",
            "pricing_band": "fair",
            "year": 2013,
            "make": "Ford",
            "model": "Focus",
        }
        base.update(overrides)
        return base

    def test_an_ordinary_listing_is_allowed(self):
        assert evaluate_gate(**self.allow_args()).allowed

    def test_a_disqualifying_title_skips_the_call(self):
        decision = evaluate_gate(**self.allow_args(title=read_title_status("salvage")))
        assert not decision.allowed
        assert decision.code == "title_disqualifier"

    @pytest.mark.parametrize(
        "description",
        [
            "Selling for parts, engine is out.",
            "PARTS ONLY - no title",
            "Blown engine, mechanic special",
            "Does not run, needs work",
        ],
    )
    def test_a_hard_disqualifier_in_the_description_skips_the_call(self, description):
        # Spec 10 names exactly this case: salvage, "for parts".
        decision = evaluate_gate(**self.allow_args(description=description))
        assert not decision.allowed
        assert decision.code == "hard_disqualifier"

    def test_an_implausible_discount_skips_the_call(self):
        # Spec 10: "if pricing is disqualifying". Spec 2: an unexplained
        # discount this deep is more likely a problem than a bargain, and the
        # verdict is the discount, not the maintenance history.
        decision = evaluate_gate(**self.allow_args(pricing_band="implausible_discount"))
        assert not decision.allowed
        assert decision.code == "pricing_disqualifier"

    @pytest.mark.parametrize("missing", ["year", "make", "model"])
    def test_an_unidentifiable_vehicle_skips_the_call(self, missing):
        # Nothing to key the cache on, and nothing to ask about.
        decision = evaluate_gate(**self.allow_args(**{missing: None}))
        assert not decision.allowed
        assert decision.code == "insufficient_vehicle_data"

    def test_a_disqualifier_wins_over_missing_data(self):
        # Report the salvage title, not "insufficient vehicle data": the first
        # is the answer, the second is a shrug.
        decision = evaluate_gate(
            **self.allow_args(title=read_title_status("salvage"), make=None)
        )
        assert decision.code == "title_disqualifier"

    def test_every_skip_carries_a_user_facing_verdict(self):
        # Spec 10: "return the VERDICT without a model call", not a blank.
        for args in (
            {"title": read_title_status("no_title")},
            {"description": "parts car"},
            {"pricing_band": "implausible_discount"},
            {"model": None},
        ):
            decision = evaluate_gate(**self.allow_args(**args))
            assert decision.reason and len(decision.reason) > 40

    def test_ordinary_worry_words_do_not_trip_the_gate(self):
        # "Needs work" is for the free flags to weigh, not for a paid gate to
        # veto on. The list stays tight on purpose.
        assert find_disqualifier("Sold as is, needs some work and new tires") is None


class TestCacheIsKeyedByVehicleNotListing:
    """Spec 10: "cache by year/make/model/trim/mileage-band, not per listing"."""

    @pytest.mark.parametrize(
        ("mileage", "band"),
        [
            (None, "unknown"),
            (0, "0-25k"),
            (24_999, "0-25k"),
            (25_000, "25-50k"),
            (90_000, "75-100k"),
            (199_999, "175-200k"),
            (200_000, "200k+"),
            (350_000, "200k+"),
        ],
    )
    def test_mileage_bands(self, mileage, band):
        assert params.mileage_band(mileage) == band

    def test_a_second_listing_for_the_same_vehicle_costs_nothing(self, session, monkeypatch):
        first, calls = fetch(session, monkeypatch)
        assert first.available and not first.cache_hit
        assert len(calls) == 1

        # Different listing, same vehicle and band: 90,100 miles, not 90,000.
        second, calls2 = fetch(session, monkeypatch, mileage=90_100)
        assert second.available and second.cache_hit
        assert calls2 == []
        assert session.query(KnownIssuesEntry).count() == 1

    def test_the_key_is_case_and_whitespace_insensitive(self, session, monkeypatch):
        fetch(session, monkeypatch)
        reading, calls = fetch(session, monkeypatch, make="  FORD ", model="focus", trim="se")
        assert reading.cache_hit
        assert calls == []

    def test_a_different_mileage_band_is_a_different_answer(self, session, monkeypatch):
        fetch(session, monkeypatch, mileage=90_000)
        reading, calls = fetch(session, monkeypatch, mileage=180_000)
        assert not reading.cache_hit
        assert len(calls) == 1
        assert session.query(KnownIssuesEntry).count() == 2

    def test_a_missing_trim_does_not_duplicate_rows(self, session, monkeypatch):
        # Stored as "" rather than NULL, because NULLs do not compare equal in
        # a unique constraint and every no-trim listing would insert its own row.
        fetch(session, monkeypatch, trim=None)
        reading, calls = fetch(session, monkeypatch, trim=None)
        assert reading.cache_hit and calls == []
        assert session.query(KnownIssuesEntry).one().trim == ""

    def test_a_prompt_revision_invalidates_by_missing(self, session, monkeypatch):
        fetch(session, monkeypatch)
        monkeypatch.setattr(params, "PROMPT_VERSION", params.PROMPT_VERSION + 1)
        reading, calls = fetch(session, monkeypatch)
        assert not reading.cache_hit
        assert len(calls) == 1

    def test_a_model_change_invalidates_by_missing(self, session, monkeypatch):
        fetch(session, monkeypatch)
        reading, calls = fetch(
            session, monkeypatch, cfg=settings(known_issues_model="claude-sonnet-5")
        )
        assert not reading.cache_hit
        assert len(calls) == 1

    def test_the_cached_row_is_served_verbatim(self, session, monkeypatch):
        fetch(session, monkeypatch)
        reading, _ = fetch(session, monkeypatch)
        assert reading.report.summary == report().summary
        assert reading.report.failure_modes == report().failure_modes


class TestCostInstrumentation:
    """Spec 10: "Instrument cost per evaluation from day one"."""

    def test_haiku_rates_are_exact_integers(self):
        # $1.00 / $5.00 per million tokens, in millionths of a dollar per token.
        assert params.cost_microdollars(1_000_000, 0) == 1_000_000
        assert params.cost_microdollars(0, 1_000_000) == 5_000_000
        assert params.cost_microdollars(1200, 300) == 1200 + 1500

    def test_tokens_and_cost_are_recorded(self, session, monkeypatch):
        fetch(session, monkeypatch, completion_=completion(inp=1200, out=300))
        row = session.query(KnownIssuesEntry).one()
        assert (row.input_tokens, row.output_tokens) == (1200, 300)
        assert row.cost_microdollars == 2700

    def test_the_denominator_counts_evaluations_not_calls(self, session, monkeypatch):
        # A cache hit is free, so cost per evaluation is total spend over
        # evaluations SERVED. Counting only calls would flatter it by the hit
        # rate, which is the whole bet spec 10 is making.
        fetch(session, monkeypatch)
        for _ in range(4):
            fetch(session, monkeypatch)

        row = session.query(KnownIssuesEntry).one()
        assert row.served_count == 5
        assert row.cost_microdollars == 2700
        assert row.cost_microdollars / row.served_count == 540

    def test_serving_stamps_a_time(self, session, monkeypatch):
        before = datetime.now(UTC)
        fetch(session, monkeypatch)
        row = session.query(KnownIssuesEntry).one()
        served = row.last_served_at
        if served.tzinfo is None:
            served = served.replace(tzinfo=UTC)
        assert served >= before


class TestFailureDegradesNothingElse:
    def test_no_api_key_means_no_call_and_a_reason(self, session, monkeypatch):
        reading, calls = fetch(session, monkeypatch, cfg=settings(anthropic_api_key=None))
        assert not reading.available
        assert reading.unavailable_reason == NOT_CONFIGURED_REASON
        assert calls == []

    def test_the_feature_can_be_switched_off_with_a_key_present(self, session, monkeypatch):
        reading, calls = fetch(session, monkeypatch, cfg=settings(known_issues_enabled=False))
        assert not reading.available
        assert calls == []

    def test_offline_serves_the_cache_but_never_the_network(self, session, monkeypatch):
        reading, calls = fetch(session, monkeypatch, offline=True)
        assert not reading.available
        assert reading.unavailable_reason == OFFLINE_REASON
        assert calls == []

        # A cached answer is still available offline -- that is the point of it.
        fetch(session, monkeypatch)
        cached, calls2 = fetch(session, monkeypatch, offline=True)
        assert cached.available and cached.cache_hit
        assert calls2 == []

    def test_a_failed_call_returns_a_reason_and_caches_nothing(self, session, monkeypatch):
        reading, calls = fetch(session, monkeypatch, completion_=None)
        assert not reading.available
        assert reading.unavailable_reason
        assert len(calls) == 1
        assert session.query(KnownIssuesEntry).count() == 0

    def test_a_thrown_exception_never_escapes_the_real_wrapper(self, session, monkeypatch):
        # Exercises the REAL `_call_model`, with a stub SDK in place of the
        # network. Whatever the SDK raises -- auth, rate limit, timeout, socket
        # -- has the same consequence: this section is unavailable, the rest of
        # the evaluation is untouched, and nothing propagates.
        class _Boom:
            def __init__(self, **kwargs):
                raise RuntimeError("connection reset by peer")

        monkeypatch.setitem(sys.modules, "anthropic", SimpleNamespace(Anthropic=_Boom))

        reading = fetch_known_issues(
            session,
            settings(),
            year=2013,
            make="Ford",
            model="Focus",
            trim=None,
            mileage=90_000,
        )
        assert not reading.available
        assert reading.unavailable_reason
        assert session.query(KnownIssuesEntry).count() == 0

    def test_a_refusal_is_treated_as_a_failure_not_as_content(self, session, monkeypatch):
        # Spec 6.6 output is qualitative text; a `stop_reason: "refusal"`
        # response has no usable content and must not be cached as if it did.
        class _Messages:
            def parse(self, **kwargs):
                return SimpleNamespace(
                    stop_reason="refusal", parsed_output=None, usage=SimpleNamespace()
                )

        class _Client:
            def __init__(self, **kwargs):
                self.messages = _Messages()

        monkeypatch.setitem(sys.modules, "anthropic", SimpleNamespace(Anthropic=_Client))

        reading = fetch_known_issues(
            session,
            settings(),
            year=2013,
            make="Ford",
            model="Focus",
            trim=None,
            mileage=90_000,
        )
        assert not reading.available
        assert session.query(KnownIssuesEntry).count() == 0


class TestPrompt:
    def test_the_vehicle_and_band_are_both_in_the_prompt(self):
        text = build_user_prompt(
            year=2013, make="Ford", model="Focus", trim="SE", mileage_band="75-100k"
        )
        assert "2013 Ford Focus SE" in text
        assert "75,000 to 100,000 miles" in text

    def test_unknown_mileage_is_stated_rather_than_guessed(self):
        text = build_user_prompt(
            year=2013, make="Ford", model="Focus", trim=None, mileage_band="unknown"
        )
        assert "not stated" in text

    def test_the_same_vehicle_produces_a_byte_identical_prompt(self):
        # Which is what makes the cache key and the prompt agree.
        a = build_user_prompt(
            year=2013, make="Ford", model="Focus", trim="SE", mileage_band="75-100k"
        )
        b = build_user_prompt(
            year=2013, make="Ford", model="Focus", trim="SE", mileage_band="75-100k"
        )
        assert a == b

    def test_empty_lists_are_explicitly_permitted(self):
        # Spec 11's lesson: a model asked to find something will find it whether
        # or not it exists. Silence has to be the easy answer.
        assert "RETURNING EMPTY LISTS IS A CORRECT AND EXPECTED ANSWER" in SYSTEM_PROMPT

    def test_generic_advice_is_excluded(self):
        assert "generic advice that would apply to any used car" in SYSTEM_PROMPT
