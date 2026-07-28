# Scoring audit: fixes applied

Companion to `docs/scoring-audit.md`. Documents what changed for each
addressed finding, the before/after evidence, and why findings #4/#5/#8/#9
were left alone. Plan approved and executed in the same session as the audit;
see `backend/tests/` for the updated test coverage each fix carries.

## Fix 1 — `resolvable_residual`'s hard floor → continuous shrinkage (finding #1)

**Files**: `backend/app/pricing/curve.py`, `backend/app/pricing/params.py`
(new `NOISE_FLOOR_TIEBREAKER_SCALE = 0.03`), `backend/tests/test_pricing_curve.py`.

**What changed**: `resolvable_residual` used to floor any residual smaller
than its own uncertainty margin to exactly `0.0`. That was correct in what it
forbade (a confident verdict past the noise floor) but also merged every such
residual into one identical output. Only the exactly-zero case changed: when
the raw gap is fully absorbed by its margin, a small, bounded,
sign-preserving perturbation (`NOISE_FLOOR_TIEBREAKER_SCALE * 4 * ratio *
(1 - ratio)`, where `ratio = |residual| / margin`) stands in for literal zero.
It's designed to vanish continuously at the boundary where the "real signal"
branch also goes to zero (no cliff), and its peak is capped below
`min(OVERPRICED_KNEE, |PLATEAU_START|)` so it can never push a rating out of
the "fair" band on its own. `rate_price_residual`'s `absorbed`/`within_noise`
computation was changed to read the original `abs(raw) <= margin` condition
directly instead of checking the (now rarely-exact) floored value for
equality to `0.0` — its meaning is unchanged, only how it's computed.

**Test changes**: of the ~9 tests in `TestResolvableResidual` and
`TestRatingRespectsUncertainty`, only 3 needed new expected values
(`test_a_gap_smaller_than_the_margin_is_mostly_erased_but_not_flattened`,
`test_it_degrades_continuously_rather_than_at_a_cliff`,
`test_the_raw_gap_is_still_reported`) — every other existing assertion,
including the band-membership invariant "an uncertain comp set cannot call a
listing overpriced" (`test_an_uncertain_comp_set_cannot_call_a_listing_overpriced`),
passed unchanged because the fix was scoped to leave every already-informative
path untouched. Two new tests were added:
`test_different_raw_gaps_under_the_same_margin_no_longer_tie` and
`test_two_different_small_residuals_no_longer_earn_an_identical_rating`,
using the exact raw/margin pairs from the audit's own measurement.

**Verified**:
- `backend/tests/test_pricing_curve.py`: 48/48 pass.
- Full suite: 492/492 pass.
- `python -m app.cli.backtest --json`: MedAPE unchanged to within normal
  DB-drift noise (curve.py is never in the regression path).
- **Dynamic-range recheck, the actual success metric**: before the fix, 59 of
  170 rated captures (35%) shared the identical rating 70.667. After: only
  2 of 168 (1.2%) land within 0.5 points of that old value, and none share
  the identical rating anymore — 107 distinct values across 168 rated
  captures, versus a single value dominating over a third of them.
- `python -m app.cli.ablation --offline`: `price_residual`'s mean |Δ| rose
  from 10.59 to 10.94 (weight unchanged at 56), consistent with the dimension
  now carrying more resolution than before — exactly the direction predicted
  before implementing.

## Fix 2 — `MIN_COMPS_FOR_ANY_ESTIMATE`: 3 → 4 (finding #2)

**Files**: `backend/app/pricing/params.py`, `backend/tests/test_pricing_regression.py`.

One-line constant change resolving the direct textual conflict with spec
4.3's "never silently score off 3 comps" — the floor used to be exactly 3.
`test_below_the_floor_publishes_no_estimate_at_all` now covers both 2 and 3
comps as `INSUFFICIENT`; a new
`test_the_floor_itself_is_enough_to_publish_something` covers the new
boundary at 4. `test_comps_without_mileage_still_count_toward_the_floor`
(built on exactly 4 comps) needed no change since it already sat on the new
floor. 49/49 tests pass in `test_pricing_regression.py`.

## Fix 3 — Decoupled the scam/completeness description-length threshold (finding #6)

**Files**: `backend/app/flags/params.py`, `backend/app/flags/scam.py`.

A sparse description used to cost `information_completeness` and fire the
scam `MINIMAL_DESCRIPTION` signal off the literal same imported constant
(`MINIMAL_DESCRIPTION_CHARS`), amplifying one missing fact into two composite
penalties without anything documenting the overlap. `scam.py` now reads its
own `SCAM_MINIMAL_DESCRIPTION_CHARS` (flags/params.py), independent of
completeness's `MINIMAL_DESCRIPTION_CHARS`. Both are 120 today — no scoring
behavior changed — but they can now be tuned independently, and each
constant's comment cross-references the other so the relationship reads as
intentional rather than coincidental. 36/36 tests pass in `test_flags.py`.

## Fix 4 — Reconciled the three independent discount thresholds (finding #3)

**Files**: `backend/app/pricing/params.py`, `backend/app/flags/params.py`,
new `backend/tests/test_discount_threshold_ordering.py`.

`IMPLAUSIBLE_DISCOUNT` (-0.45), `SCAM_PRICE_RESIDUAL` (-0.35), and
`ADVERSE_SELECTION_RESIDUAL` (-0.25) remain three separate constants — they
answer genuinely different questions (a rating floor, a scam signal, a
confidence penalty) and merging them would lose real signal. What changed is
that their current values already form a sensible graduated response
(confidence gets nervous first, the scam signal fires next, the pricing
curve's full "give up" floor is last), and that's now stated explicitly in
each constant's comment with cross-references to the other two, plus a new
test (`test_discount_thresholds_form_the_intended_graduated_response`)
asserting the ordering numerically so a future edit can't silently invert it.
No behavior change.

## Fix 5 — Centralized scattered magic numbers (finding #7)

**Files**: `backend/app/evaluation/score.py`, `backend/app/negotiation/params.py`,
`backend/app/negotiation/strength.py`, `backend/app/negotiation/language.py`.

Pure refactor, no value changes:
- `score.py`'s vehicle-risk baselines, recall penalty, and scam
  sub-threshold deduction moved from inline literals to named,
  UNCALIBRATED-labeled module constants (`VEHICLE_RISK_*`,
  `SCAM_SUBTHRESHOLD_PENALTY_PER_SIGNAL`).
- `negotiation/strength.py`'s base strength, time-on-market bands, leverage
  cutoffs, and language cap/multiplier moved into `negotiation/params.py`
  (`BASE_STRENGTH`, `TIME_COMPONENT_*`, `LEVERAGE_*`, `LANGUAGE_SCORE_*`),
  which already existed and already held this module's other constants —
  `strength.py` now imports from it the same way `curve.py` imports from
  `pricing/params.py`.
- `negotiation/language.py`'s per-phrase weights were left inline (splitting
  weight from phrase/pattern would hurt readability more than centralizing
  helps) but now carry an explicit UNCALIBRATED disclaimer, cross-referenced
  from `negotiation/params.py`'s docstring.

Grepped for any test importing the moved constants by their old location —
none found. Full suite: 492/492 pass, confirming no behavior change.

## Fix 6 — Visibility for confidence/anchor thresholds (findings #4, #5)

**Files**: new `backend/app/cli/confidence_report.py`, doc comments at
`COMPS_FOR_HIGH_CONFIDENCE` and `MAX_INTERVAL_WIDTH_FOR_ANCHORS` in
`pricing/params.py`.

No threshold values changed — there is still no calibrated ground truth
(36 of the spec's target 50-100 labels) to justify picking new numbers over
the current ones, and changing them now would just swap one unvalidated guess
for another. Instead, `python -m app.cli.confidence_report [--offline]` now
reports the confidence-level distribution, limiter firing frequency, and
anchor publication rate across every stored capture, following the same
`load_captures` → `evaluate_capture` → aggregate pattern as `ablation.py` and
`backtest.py`. This turns the audit's one-off analysis script into a
checked-in tool that can be re-run after any future change to confirm nothing
shifted unexpectedly. `COMPS_FOR_HIGH_CONFIDENCE` and
`MAX_INTERVAL_WIDTH_FOR_ANCHORS` each carry a comment pointing at the measured
effect and this tool.

## Left unchanged

- **Finding #4/#5's actual threshold values** — `WIDE_INTERVAL`'s cutoff,
  `COMPS_FOR_HIGH_CONFIDENCE=15`, `MAX_INTERVAL_WIDTH_FOR_ANCHORS=0.30`.
  Confirmed via `confidence_report` that HIGH confidence still doesn't occur
  on any stored capture and anchors are still withheld on the large majority
  of evaluations. This is unresolved by design — spec 9's calibration pass is
  the right place to pick new numbers, not a guess made without ground truth.
- **Finding #8** (composite weights, ablation ranking, prediction-interval
  quality) — already correct, no action needed.
- **Finding #9** (comp-set dealer filtering) — blocked on comp cards carrying
  no description or listing-count field; a data-acquisition gap, not
  something a scoring change can fix.
