# Scoring Audit

Scope: every module in the scoring path — comp filtering, the expected-price
regression, the pricing curve, confidence, the four dimension scorers, and the
composite assembly. No code was changed to produce this audit.

Method: read every module listed below in full, then ran the existing
calibration tooling (`app.cli.ablation`, `app.cli.backtest`, `app.cli.agreement`)
plus two ad-hoc read-only scripts against the real Postgres database
(`docker-compose.yml`'s `deal-rater-postgres`, 36 hand labels under
`labeler="josh"`), run **offline** (`offline=True`, no live NHTSA calls) so
every capture scores deterministically off cached/absent data. Every number in
sections 6–8 is empirical, not illustrative, and can be reproduced with the
commands quoted inline.

**The database is live** — this is the dev instance behind the running
extension/backend, not a frozen fixture set. The stored-capture count grew
from 176 to 179 partway through this audit. Every figure below reflects one
final, internally-consistent pass over 179 captures; anywhere an earlier
exploratory pass is quoted for a different reason (e.g. `n=176`), it's
labeled as such.

Files read: `app/evaluation/score.py`, `app/evaluation/report.py`,
`app/evaluation/__init__.py`, `app/pricing/{comps,regression,curve,confidence,
model,params,tdist}.py`, `app/flags/{completeness,scam,params}.py`,
`app/negotiation/{strength,language,seller_type,params}.py`,
`app/nhtsa/assessment.py`, `app/cli/{ablation,agreement,backtest,audit}.py`,
`app/pricing/loader.py`, `app/services/serialize.py`, `app/models.py`.

A note on what this codebase already does well: the source is unusually
explicit about its own uncertainty. Nearly every constant below is already
flagged `UNCALIBRATED` in its own file, several rejected design alternatives
are documented with their measurements rather than silently discarded, and the
composite deliberately withholds a score rather than publish one it can't
defend. That discipline is why this audit can cite line numbers instead of
speculating — but it also means most of the "invented constant" findings below
are not undiscovered problems, they're the documented, acknowledged gap the
code itself is waiting on spec 9 to close. The findings that are new in this
audit are the emergent, cross-module effects: what happens when several
individually-reasonable, individually-documented choices compound on real
data. Those are ranked in section 9.

---

## 1. Input inventory

| Input | Source | Presence on real data (n=179 captures) | What happens when missing |
|---|---|---|---|
| `price_cents` (target ask) | scraped | ~100% (a $0/near-zero ask is floored by `MIN_PLAUSIBLE_PRICE_CENTS`, `regression.py:239`) | No residual, no rating, no scam discount signal; deal score requires it (`REQUIRED_COMPONENTS`, `score.py:94`) — **correctly** treated as disqualifying, not neutral |
| `mileage` (target) | scraped | present on most; when absent, no mileage-adjusted fit is possible | Falls back to `_median_estimate` (`regression.py:593-639`) — **still produces a score**, just wider interval. Also independently costs 22/100 of `information_completeness` (`completeness.py:134`) |
| `mileage` (comps) | scraped | 15/179 captures fall back to `comp_median` (no slope fit); 9/179 have `<3` usable comps at all | Comp is kept as market-thickness evidence but excluded from the fit (`mileage_unknown`, `comps.py:493`) — correctly not silently dropped |
| comp candidates (search results) | scraped | n_included buckets across 179 captures: `<3`: 9, `3-5`: 4, `6-7`: 3, `8-14`: 73, `15+`: 90 | Below 3: `EstimatorKind.INSUFFICIENT`, no score published — correct. **At exactly 3–7: a score IS published** (median fallback, 4+3=7 captures) — see section 3's discussion of "never silently score off 3 comps" |
| `trim_text` (target & comps) | scraped | 21% of captured comps have none (`comps.py:56`); confirmed trim match on target present in a minority of captures | Never excludes a comp (soft signal only, `comps.py:54`) — correctly costs confidence (`TRIM_UNKNOWN`/`TRIM_DISAGREEMENT`, `confidence.py:142-145`), never costs price rating |
| `title_status` | scraped (structured field or description) | absent on many; `TitleRisk.UNSTATED` when so (`completeness.py:93-97`) | **Flagged below as favorable-when-absent in one branch** — see the finding under this table |
| VIN | scraped from description, opportunistic | rare (spec 4.2 calls this "opportunistic, not required"; no aggregate figure computed here, but the scam signal `VIN_OMITTED_FROM_DETAILED_LISTING` exists specifically because it's usually absent) | Costs 12/100 completeness (`completeness.py:138`); contributes to a scam signal only when description is long (`scam.py:250-258`); does **not** feed `vehicle_risk` at all (see section 5) |
| `description` text | scraped | present on most targets, variable length | Short/absent description costs completeness (`completeness.py:141,160-162`) **and** independently fires/contributes to two scam signals off the *same* length thresholds (see section 5) |
| `photo_count` | scraped | present when Marketplace exposes it | Missing photo count: `assess_scam_patterns` marks the "few/stock photos" signal **unavailable**, not fired (`scam.py:217-224`) — correctly conservative. Missing also costs 10/100 completeness |
| NHTSA recall/complaint counts | NHTSA API, by year/make/model (no VIN needed) | keyed to model, not the specific car | When both are `None` and title is `UNSTATED`: `vehicle_risk` is **unavailable** (`score.py:166`, returns `None`) — dropped from composite, weight renormalized away. Correctly not scored as a "safe" 0 or "neutral" 50 |
| `posted_at` (target) | scraped | absent on some targets | `days_on_market` returns `None` (`strength.py:80-88`) → `Leverage.UNKNOWN`, not folded into deal score anyway (see section 3) |
| `price_changed` | phase-three column | **NULL on every observation captured** (`scam.py:32-34`, confirmed in `loader.py:45`) | Scam signal `PRICE_REVISED_UPWARD` is permanently `evaluable=False` on all current data (`scam.py:281-293`) |
| seller display name / profile / account age | never collected (spec 8.2) | never present, by design | `Signal.NEW_ACCOUNT` permanently unavailable (`scam.py:295-306`) — a **deliberate** privacy tradeoff, not a data gap |
| dealer signal on **comps** | none — comp cards carry no description or listing count (`comps.py:15-20`, `DealerSignal.UNAVAILABLE`) | 0% available, always | Spec 4.3's comp-hygiene dealer exclusion **does not run at all**. Every comp set may include dealer-priced listings, inflating the expected price upward (acknowledged: `confidence.py:129-130` always adds `DEALER_FILTERING_UNAVAILABLE`) |

**Finding: title status has one branch where "unstated" is not worse than a
known-clean title, and one branch where it is materially worse — depending on
whether NHTSA data exists.** In `_vehicle_risk_score` (`score.py:147-175`):

- Title `UNSTATED` + no NHTSA data → `vehicle_risk` is **unavailable** (`None`,
  `score.py:166`) → dropped from the composite, weight renormalized away. Net
  effect on the published score: **neutral** (the dimension simply doesn't
  count).
- Title `CLEAN` + no NHTSA data → `vehicle_risk` = **70** (`score.py:164-165`).
- Title `UNSTATED` + NHTSA data present → `vehicle_risk` = **65**
  (`score.py:168`, the non-`CLEAN` branch of the ternary).
- Title `CLEAN` + NHTSA data present → `vehicle_risk` = **85**.

So an unstated title is *never* scored as a zero or a penalty — it's either
dropped entirely (neutral) or scored at 65 (better than the composite's own
mean vehicle_risk of 67, see section 6). This is defensible (spec 6.2 doesn't
ask for an "unstated is suspicious" signal, and spec 8.2 forbids over-reading
absence as guilt elsewhere), but it does mean **the one input the user asked
to flag by name — "a missing field that quietly scores 70 is worse than one
that scores 0" — has a near-exact instance**: unstated title with NHTSA data
present scores 65, one point below a stated-clean title's 70-without-NHTSA-data
score, despite disclosing strictly less. Not a bug in the sense of contradicting
a spec instruction, but exactly the shape the user was checking for.

---

## 2. Constant provenance table

Classification key: **(a)** literal number or range taken from spec text,
**(b)** invented during implementation with no spec number and no measurement
behind it, **(c)** derived from an actual measurement on stored data.

As expected, the overwhelming majority are (b). Every params file says so
about itself (e.g. `pricing/params.py:9-12`: *"Everything below is currently
UNCALIBRATED... these are documented guesses chosen to be defensible, not
correct"*) — this table doesn't dispute that self-assessment, it just makes it
one flat list instead of five files' worth of scattered comments, and it adds
the constants that live *outside* any params file and so aren't covered by
that disclaimer at all.

### Comp filtering (`pricing/params.py`)

| Constant | Value | Line | Class | Note |
|---|---|---|---|---|
| `YEAR_WINDOW` | 2 | 29 | (b) | "keeps a generation together," no measurement |
| `YEAR_WINDOW_LADDER` | (2,3,4) | 48 | (b)/(c) hybrid | The *order* (year before radius) is (c) — measured 0% of comps rejected for distance vs 37% for year window on 48 captures. The specific values 2/3/4 are (b) |
| `MIN_PLAUSIBLE_PRICE_CENTS` | $500 | 54 | (b) | anecdotal ($25/$180 junk rows), not fitted |
| `MIN_PRICE_FRACTION_OF_MEDIAN` | 0.15 | 60 | (b) | "deliberately generous," no measurement |
| `MAX_PLAUSIBLE_MILEAGE` | 500,000 | 64 | (b) | |
| `DUPLICATE_PRICE_TOLERANCE` | 0.05 | 78 | (b) | |
| `JUNK_FRACTION_BELOW_TREND` | 0.55 | 213 | **(c)** | The one constant in this file the docstring itself calls out: LOO-CV moved MedAPE 14.4%→13.9% with this screen on (`params.py:208-212`) |

### Comp count floors (`pricing/params.py`)

| Constant | Value | Line | Class | Note |
|---|---|---|---|---|
| `MIN_COMPS_FOR_REGRESSION` | 8 | 226 | (a) | Spec 4.3: "roughly 8" |
| `MIN_COMPS_FOR_ANY_ESTIMATE` | 3 | 230 | (b) | **In tension with spec text** — see section 3 |
| `MIN_COMPS_FOR_SLOPE` | 6 | 235 | (b) | df≥4 reasoning, exact value arbitrary |
| `MIN_COMPS_FOR_YEAR_TERM` | 7 | 244 | (b) | one more than `MIN_COMPS_FOR_SLOPE`, arbitrary |

### Interval (`pricing/params.py`)

| Constant | Value | Line | Class | Note |
|---|---|---|---|---|
| `INTERVAL_COVERAGE` | 0.80 | 255 | (b) | chosen for UX ("actionable"), not fitted; spec 9.5's coverage check has not run |
| `MIN_INTERVAL_HALF_WIDTH_FRACTION` | 0.04 | 265 | (b) | reasoned (mileage quantization) but not fitted |
| `FALLBACK_INTERVAL_HALF_WIDTH_FRACTION` | 0.22 | 270 | (b) | "wide on purpose," arbitrary |

### Rise-plateau-decline curve (`pricing/params.py`, `pricing/curve.py`)

| Constant | Value | Line | Class | Note |
|---|---|---|---|---|
| `OVERPRICED_KNEE` | 0.05 | 290 | (b) | no spec number |
| `PLATEAU_START` | -0.10 | 293 | (a) | low end of spec's "10 to 15 percent" |
| `PLATEAU_END` | -0.20 | 294 | (b) | no spec number at all |
| `IMPLAUSIBLE_DISCOUNT` | -0.45 | 299 | (a) | spec's "forty-five percent under" |
| `PLATEAU_RATING` | 92.0 | 306 | (b) | invented |
| `IMPLAUSIBLE_DISCOUNT_RATING` | 45.0 | 307 | (b) | invented |
| `FAIR_PRICE_RATING` | 60.0 | 308 | (b) | invented — see section 4 for why this one matters more than it looks |
| `OVERPRICED_FLOOR_RATING` | 5.0 | 309 | (b) | invented |
| `OVERPRICED_FLOOR` | 0.30 | 312 | (b) | invented |

### Negotiation anchors (`pricing/params.py`)

| Constant | Value | Line | Class | Note |
|---|---|---|---|---|
| `STRONG_OFFER_BELOW` | 0.06 | 321 | (a)/(c), n=1 | Reverse-engineered from spec 5.1's single worked example ($14,050→$13,200). Verified: 14050×0.94≈13207≈13200 |
| `WALK_AWAY_ABOVE` | 0.04 | 322 | (a)/(c), n=1 | Same example: 14050×1.04≈14612≈14600 |
| `MAX_INTERVAL_WIDTH_FOR_ANCHORS` | 0.30 | 328 | (b) | invented; **this constant alone suppresses anchors 95% of the time on real data** — see section 6 |

### Confidence (`pricing/params.py`)

| Constant | Value | Line | Class | Note |
|---|---|---|---|---|
| `MIN_TRIM_COVERAGE` | 0.5 | 343 | (b) | invented |
| `ADVERSE_SELECTION_RESIDUAL` | -0.25 | 348 | (b) | distinct from the curve's own -0.45 breakpoint, invented separately |
| `MAX_ROBUST_DISAGREEMENT` | 0.08 | 359 | (b), anecdotal | "measured" on 3 captures only (0.7%, 4.0%, 12.2%) — too small a sample to call (c) |
| `COMPS_FOR_HIGH_CONFIDENCE` | 15 | 363 | (a) | spec 0's number, but **empirically this threshold never lets a real capture reach HIGH** — see section 8 |

### Flags (`flags/params.py`)

| Constant | Value | Line | Class | Note |
|---|---|---|---|---|
| `SCAM_SIGNALS_FOR_WARNING` | 4 | 19 | (a) | spec 6.3 verbatim, but applied against 5 evaluable signals instead of the spec's 7 — see section 3 |
| `MINIMAL_DESCRIPTION_CHARS` | 120 | 23 | (b) | **shared, unmodified, between two dimensions** — see section 5 |
| `FEW_PHOTOS` | 3 | 28 | (b) | invented |
| `DETAILED_DESCRIPTION_CHARS` | 400 | 32 | (b) | invented |
| `SCAM_PRICE_RESIDUAL` | -0.35 | 38 | (b) | a **third** distinct discount threshold (alongside the curve's -0.45 and confidence's -0.25), invented independently |
| `AMPLE_PHOTOS` | 8 | 48 | (b) | invented |
| `AMPLE_DESCRIPTION_CHARS` | 300 | 51 | (b) | invented |

### Negotiation (`negotiation/params.py`)

| Constant | Value | Line | Class | Note |
|---|---|---|---|---|
| `FRESH_LISTING_HOURS` | 24 | 21 | (a) | spec 6.4 verbatim |
| `STALE_LISTING_DAYS` | 30 | 26 | (a) | spec 6.4 verbatim |
| `VERY_STALE_LISTING_DAYS` | 75 | 30 | (b) | anecdotal (one 104-day listing observed) |
| `MARKET_HAS_DECLINED_RESIDUAL` | -0.02 | 46 | (b) | invented |
| `STALE_AND_OVERPRICED_BONUS` | 18.0 | 50 | (b) | invented |
| `MAX_EXTRA_DISCOUNT_FROM_LEVERAGE` | 0.06 | 59 | (b) | invented |

### Composite weights (`evaluation/score.py`)

| Constant | Value | Line | Class | Note |
|---|---|---|---|---|
| `WEIGHTS["price_residual"]` | 56.0 | 76 | (a) | spec 5.2's own current number |
| `WEIGHTS["information_completeness"]` | 9.0 | 77 | (a) | spec 5.2's own current number |
| `WEIGHTS["vehicle_risk"]` | 25.0 | 78 | (a) | spec 5.2's own current number |
| `WEIGHTS["seller_and_scam_risk"]` | 10.0 | 79 | (a) | spec 5.2's own current number |
| `MIN_COVERAGE` | 0.5 | 84 | (b) | invented; not in spec at all |

**Constants with no params-file home at all** — invented the same way as
everything marked (b) above, but not even collected in a file that carries the
"UNCALIBRATED" disclaimer, so a reader of `pricing/params.py` or
`negotiation/params.py` alone would not know these exist:

| Constant | Value | Location | Note |
|---|---|---|---|
| Vehicle-risk baselines | 0.0 / 25.0 / 70.0 / 85.0 / 65.0 | `score.py:158-168` (inline) | Five separate invented rating baselines, none in `nhtsa/` or a params module |
| Recall penalty | `min(20.0, recall_count * 2.0)` | `score.py:174` | invented cap and per-recall cost |
| Scam sub-threshold score | `100.0 - len(fired) * 25.0` | `score.py:184` | invented — every firing signal costs exactly a quarter of this sub-score, flat, regardless of which signal |
| Negotiation base strength | `30.0` | `strength.py:192` | invented starting point before any signal is added |
| Time-on-market bands | 45.0 / 32.0 / 18.0 / 8.0 / 0.0 | `strength.py:96-112` | invented, despite `negotiation/params.py` existing right next to this file |
| Leverage thresholds | 70 / 45 | `strength.py:196-199` | invented cutoffs for STRONG/MODERATE/WEAK |
| Language score cap & multiplier | ±20.0, ×4.0 | `strength.py:157` | invented |
| Per-phrase language weights | 1–3 per phrase (~20 phrases) | `language.py:58-102` | invented per-item, only a general "UNCALIBRATED" comment, no per-item justification |

**This is itself a finding, independent of any individual number**: the
pricing dimension is disciplined about centralizing and labeling its
uncalibrated constants (`pricing/params.py` is exhaustive and self-aware); the
vehicle-risk and negotiation-strength dimensions are not, and scatter
equally-uncalibrated magic numbers directly in the scoring logic. Someone
tuning the composite later will find every pricing constant by reading one
file, and will not find the vehicle-risk or negotiation-strength constants the
same way.

---

## 3. Spec conformance

**Section 2 — rise-plateau-decline curve.** Conforms in shape. Confirmed
non-monotonic: `rate_price_residual` (`curve.py:158-293`) rises from 45 (at
-45% or beyond) to a flat 92 plateau between -20% and -10%, then falls to 60 at
+5% and down to a floor of 5 at +30%. `_lerp` (`curve.py:149-155`) is
continuous at every breakpoint — no discontinuities in the curve itself (see
section 4 for a different kind of discontinuity this introduces elsewhere).
Breakpoints: `PLATEAU_START=-0.10`, `PLATEAU_END=-0.20`, `OVERPRICED_KNEE=0.05`,
`IMPLAUSIBLE_DISCOUNT=-0.45`, `OVERPRICED_FLOOR=0.30` — all in `pricing/params.py`
lines 290–312, quoted above.

**Does an extreme discount reduce confidence rather than inflate the score?**
Conforms, and the separation is real, not just documented. `curve.py` never
reads `Confidence`; `confidence.py`'s `ADVERSE_SELECTION` limiter
(`confidence.py:186-188`) is computed independently from the same residual and
fires at a *different* threshold (`ADVERSE_SELECTION_RESIDUAL=-0.25`,
`pricing/params.py:348`) than the curve's own implausible-discount floor
(`IMPLAUSIBLE_DISCOUNT=-0.45`). Two distinct, uncalibrated thresholds for
"discount is deep enough to be suspicious," never reconciled with each other or
with `flags/params.py`'s third one (`SCAM_PRICE_RESIDUAL=-0.35`,
`scam.py:204`). All three fire off the same underlying residual, at three
different cutoffs (-0.25, -0.35, -0.45), chosen independently. **This is real
structural risk**: a listing at exactly -30% residual triggers the confidence
penalty and the scam-signal check but sits on the curve's *decline* segment,
not yet at the implausible floor — three different "how deep is too deep"
answers for the same number, none calibrated against the others or against
data.

**Is time-on-market genuinely absent from the composite, or does it leak in?**
Genuinely absent, verified structurally, not just by docstring claim.
`compute_deal_score` (`score.py:187-194`) takes exactly five keyword arguments
— `rating`, `completeness`, `title`, `vehicle_risk`, `scam` — no negotiation or
time input. `evaluate_capture` (`evaluation/__init__.py:168-174`) calls it
without passing `negotiation` at all, even though `negotiation` was already
computed earlier in the same function (line 139). No leak.

**Composite weights: 56/9/25/10, not 45/7/20/8.** `WEIGHTS`
(`score.py:75-80`) is `{price_residual: 56.0, information_completeness: 9.0,
vehicle_risk: 25.0, seller_and_scam_risk: 10.0}`, summing to 100. This matches
spec 5.2's current text exactly. The arithmetic in `compute_deal_score`
(`score.py:266`):

```
score = sum(c.weight * (c.value or 0.0) for c in available) / covered
```

where `covered = sum(c.weight for c in available)` (`score.py:223`) — a
weighted mean over whatever subset of the four is actually available,
renormalized so the available weights always sum to 1. This is **layered on
top of** a second, static renormalization already baked into the 56/9/25/10
figures themselves: the module docstring (`score.py:71-74`) states these were
rescaled from an 80-point total to a 100-point one after `vehicle_risk` moved
12→20 at `information_completeness`'s expense (15→7). So there are two
renormalizations, not one: a one-time historical rebalancing that produced
today's constants, and a per-evaluation dynamic one that runs every time a
dimension is unavailable.

**Is the prediction interval a real interval or a heuristic width?** Both,
depending on the path, and the code is honest about which:
- `EstimatorKind.MILEAGE_REGRESSION` (155/179 captures, 87%): a genuine
  textbook prediction interval — `t * residual_se * leverage**0.5`
  (`regression.py:393-399`), with `t` from a real two-sided Student's-t
  quantile (`tdist.py`, not approximated). This is the real thing.
- `EstimatorKind.COMP_MEDIAN` (15/179, 8%): a flat heuristic —
  `point * FALLBACK_INTERVAL_HALF_WIDTH_FRACTION` (0.22, `regression.py:607`,
  `pricing/params.py:270`) — not derived from any spread in the data at all.
- Both paths apply `MIN_INTERVAL_HALF_WIDTH_FRACTION=0.04` as a hard floor
  (`regression.py:765-768`) regardless of what the fit actually computed —
  so even the "real" regression path is not purely derived; it's a derived
  number clamped by an invented one whenever the fit reads tighter than the
  floor.

**"Never silently score off 3 comps" — direct textual conflict with the
code.** Spec 4.3 states this as a hard rule. `MIN_COMPS_FOR_ANY_ESTIMATE = 3`
(`pricing/params.py:230`) is the *floor for scoring at all* — at
`n_included == 3` the code does not decline to score; it proceeds to
`_median_estimate` (`regression.py:656-687`) and publishes a point estimate,
an interval, and (downstream) a pricing rating. `MIN_COMPS_FOR_SLOPE=6` is the
separate, higher floor for attempting a mileage-adjusted fit, but that is a
choice about which *estimator* to use, not about whether to score at all. On
real data this is not a corner case: 4/179 captures score off 3–5 comps
(section 6's `n_included` bucket table). Read plainly, the spec is asking for
a floor above 3; the shipped floor is exactly 3.

**Scam threshold applied against a shrunk denominator.** Spec 6.3 sets the
warning threshold at 4-of-7. Only 5 of the 7 signals are ever evaluable on
this product's data (`scam.py:18-49`); the threshold constant itself is still
literally 4 (`SCAM_SIGNALS_FOR_WARNING=4`, `flags/params.py:19`), unadjusted
for the smaller pool. `ScamAssessment.reduced_sensitivity`
(`scam.py:164-171`) correctly reports this fact.

**Correction (post-audit):** this section originally claimed
`reduced_sensitivity` was "computed and never read outside tests." That was
wrong — a follow-up Explore pass found it fully wired end to end:
`services/serialize.py:82` and `schemas.py:275` put it on the API payload,
and the extension actually renders it
(`extension/src/content/overlay/sections.ts:230-240`, the "Only N of M
patterns could be checked..." caveat), with its own extension test
(`extension/tests/overlay-state.test.ts:274`) alongside the backend one. No
fix was needed for this part of the finding. The unreconciled 4-of-5-vs-4-of-7
numeric question is still real and undecided, but the transparency mechanism
already works.

---

## 4. Mathematical review

**The dominant finding in this whole audit lives here, not in section 6.**
`resolvable_residual` (`curve.py:93-146`) subtracts `uncertainty_margin`
(`expected_uncertainty_fraction`, the confidence interval on the *fitted mean*)
from the magnitude of the raw residual before the curve is ever evaluated,
flooring at zero. On stored data this margin runs 6%–12% at the median cases
inspected. The consequence: **any target whose raw residual is smaller in
magnitude than its own margin — which on this data is roughly a third of all
scored listings — gets `scored_residual_fraction` forced to exactly `0.0`,
regardless of whether the raw gap was +1.7%, -3.8%, +4.8%, or -10.2%.** Because
`rate_price_residual` is a pure function of the scored residual, every one of
those listings receives the *identical* pricing sub-score:

```
residual=0 lerp between PLATEAU_START(-0.10, rating 92) and
OVERPRICED_KNEE(0.05, rating 60):
    t = (0 - (-0.10)) / (0.05 - (-0.10)) = 0.667
    rating = 92 + 0.667 * (60 - 92) = 70.667
```

Measured directly (179 stored captures, offline): **59 of 170 rated captures
(35%) score `price_residual` at exactly 70.667.** These are not near-duplicate
cars — they span raw residuals from +1.7% to -11.8% (one, capture 143, at
-11.75% raw, only just past `PLATEAU_START`) and one extreme outlier at +81%
raw (capture 117, whose margin was 98%). A listing asking 1.7% over its
expected price and one asking 10% under it are, after this transform,
mathematically identical inputs to the composite. This is not a discontinuity
in the classical sense (the curve itself is continuous) — it's a
**loss-of-resolution artifact**: a continuous curve fed a residual that has
been deliberately flattened to a single point for over a third of the dataset.
The design rationale for the floor is sound and well-argued (`curve.py:96-141`
— it was built specifically to fix a *different*, real problem: 46% of
evaluations previously rendered verdicts their own interval couldn't support).
But the fix's side effect — many materially different asking prices collapsing
to one identical sub-score — appears to be an unmeasured consequence of that
fix, not a chosen tradeoff; nothing in the module discusses it.

**Saturation and clipping**, measured directly (`n=170` rated, offline, 179
captures loaded):

| Dimension | Ceiling value | Hits at ceiling | Floor value | Hits at floor |
|---|---|---|---|---|
| `price_residual` | 92.0 (plateau) | 22/170 (13%) | 5.0 (overpriced floor) | 8/170 (5%) |
| `vehicle_risk` | 85.0 | rare exactly, but p90=83.0 (near-ceiling) | 0.0 (disqualifying title) | present, not separately counted here |
| `seller_and_scam_risk` | 100.0 (no signals fired) | ~45% (see section 6 for the exact breakdown) | — | ~1% at 50.0 (two signals fired); 0 ever reach the 4-signal suppression |
| `information_completeness` | no hard ceiling observed at 100 | — | — | — |

Combined with the 70.667 cluster above, **89/170 (52%) of `price_residual`
values sit at one of exactly three points (70.667, 92.0, or 5.0)** rather than
spread continuously — the curve has much less effective resolution on real
data than its continuous definition suggests.

**Monotonicity.** Checked every input against its scoring direction:
- `price_residual` vs. discount: intentionally non-monotonic (spec 2's whole
  point) and correctly implemented — cheaper is not always better past the
  plateau.
- `vehicle_risk` vs. `recall_count`: monotonically decreasing, correct sign
  (`score.py:173-174`).
- `information_completeness` vs. each disclosed field: monotonically
  increasing, correct sign throughout `completeness.py:133-145`.
- `seller_and_scam_risk` vs. fired-signal count: monotonically decreasing,
  correct sign, but see section 6 — in practice only three values (100, 75,
  50) are ever reached because 0 captures in this dataset hit 2+ signals
  reaching suppression.
- Negotiation `strength` vs. `days_listed`: **not monotonic by construction**,
  and correctly so per spec — 0 at <24h, rises, but the interaction bonus only
  fires when price is *not* below expected (`strength.py:115-133`), which is
  an intentional conditional, not a sign error.
- No input was found with a backwards sign.

**Small-n / fallback ladder**, traced and measured (179 captures loaded):
1. `n_included < 3` → `EstimatorKind.INSUFFICIENT`, no score. **9/179 (5%)**.
2. `3 ≤ n_included`, but `< MIN_COMPS_FOR_SLOPE(6)` mileage-carrying points, or
   target has no mileage → `_median_estimate` fallback, wide fixed interval
   (22%), no mileage adjustment. **15/179 (8%) land here** (`comp_median`
   count from the estimator-kind distribution).
3. `n_included < MIN_COMPS_FOR_REGRESSION(8)` but ≥ `MIN_COMPS_FOR_SLOPE` →
   `_filter_with_progressive_widening` (`model.py:60-94`) widens the year
   window 2→3→4 and re-filters, stopping at the first window that reaches 8.
   `year_window_widened` is recorded and costs confidence
   (`Limiter.WIDENED_YEAR_WINDOW`, fired 14/179, 8%).
4. `n_included ≥ 8`: regression proceeds normally; **155/179 (87%) reach a
   full mileage regression.**

`n_included` bucket counts across the 179 stored captures: `<3`: 9, `3-5`: 4,
`6-7`: 3, `8-14`: 73, `15+`: 90.

**Division-by-zero / empty-set / single-comp paths**: all guarded, checked
directly.
- `_fit_mileage_only`: `sxx == 0` (every comp same mileage) returns `None`
  with a reason rather than dividing (`regression.py:356-357`); `ss_tot == 0`
  guards `r_squared` (`regression.py:375`).
- `_theil_sen`: empty `slopes` list (fewer than 2 usable points, or all share
  one x-value) returns `None` (`regression.py:309-310`).
- `_solve` (Gauss-Jordan): a near-singular pivot returns `None` rather than
  dividing by a near-zero pivot (`regression.py:435-437`), with a *relative*
  tolerance chosen because absolute epsilons misbehave on the 1e10-scale
  cross-products here — a real and correct guard.
- `negotiation_anchors` / `should_publish_anchors`: guarded against `None`
  inputs (`curve.py:336`) before any division.

---

## 5. Double counting

**Description length: confirmed, and unusually literal.** The same constant,
`MINIMAL_DESCRIPTION_CHARS = 120` (`flags/params.py:23`), is imported and
applied independently in two dimensions:
- `completeness.py:141`: a description under 120 chars loses the full 18/100
  "a description" completeness credit (and additionally loses a smaller
  continuous penalty below `AMPLE_DESCRIPTION_CHARS=300`, `completeness.py:160-162`).
- `scam.py:241`: the *same* 120-char cutoff fires `Signal.MINIMAL_DESCRIPTION`.

A sparse description is therefore penalized in `information_completeness`
(weight 9/100 of composite) **and** contributes toward the scam warning
threshold and, below the 4-signal warning threshold, costs a flat 25 points of
`seller_and_scam_risk`'s own 0–100 scale (weight 10/100 of composite) via
`_scam_score` (`score.py:178-184`). Both move the composite in the same
direction from the same fact. This is not obviously wrong — a bare-bones
listing plausibly *is* both less complete and more scam-shaped — but it is an
unacknowledged amplification: one missing fact costs roughly
`18×(9/100) + 25×(10/100) ≈ 1.6 + 2.5 = 4.1` composite points, not the ~1.6
either dimension's own weight would suggest in isolation, and neither
docstring mentions the other.

**VIN: touches three places, only two of them the composite.**
1. `completeness.py:138` — 12/100 completeness credit if present.
2. `scam.py:250-258` — contributes to `VIN_OMITTED_FROM_DETAILED_LISTING`, but
   *only* when the description is also long (≥400 chars,
   `DETAILED_DESCRIPTION_CHARS`), so this one is conditionally correlated with
   the description-length double-count above, not an independent hit.
3. Comp-matching precision (`nhtsa/assessment.py`, feeds `enrich_target` in
   `evaluation/__init__.py:107-116`) — improves trim resolution, which
   improves confidence, not the price rating. Not a composite double-count.

**Title status: touches completeness and vehicle_risk, mostly in
complementary (not additive) directions** — see section 1's finding above for
the one case (unstated + NHTSA data present, vs. stated-clean + no NHTSA data)
where the two dimensions don't cleanly separate "was it disclosed" from "is it
risky."

**Mileage: touches price_residual and completeness, defensibly.** Missing
target mileage costs 22/100 completeness *and* forces the pricing estimator
into the median fallback (wider interval, `NO_MILEAGE_ADJUSTMENT` confidence
limiter) — but the price *rating* itself is still computed from the resulting
residual, just less precisely. These are different questions ("how much did
the seller disclose" vs. "how precisely can we price this car") and the
double-exposure is a correlated failure mode rather than the same fact scored
twice in the same currency. Judged defensible.

**Dealer detection: does *not* double count — because it doesn't reach the
composite at all.** `negotiation/seller_type.py`'s `detect_seller_type` feeds
only `NegotiationAssessment` (suppressing seller-language scoring for
detected dealers, `strength.py:147-152`) — negotiation is never passed into
`compute_deal_score` (section 3). Meanwhile `seller_and_scam_risk` in the
composite is driven *exclusively* by `ScamAssessment`'s five evaluable
signals — none of which read dealer boilerplate. **Spec 6.3's own stated
priority — "the more valuable use of this signal is comp hygiene, filtering
dealers out of the comp set" — is not implemented at all** (`comps.py:15-20`,
`DealerSignal.UNAVAILABLE` on every comp, confirmed: no seller listing count
field exists on comp data). So there is no double count here; there's an
absence where the spec expected the *most valuable* copy of this signal to
live.

---

## 6. Dynamic range — empirical

Run: `evaluate_capture(session, capture, offline=True)` over all 179 stored
captures (Postgres `deal-rater-postgres`, via `app.pricing.loader.load_captures`).

**Composite score** (n=170 published; 9 suppressed for coverage <50%, all of
them cases where the price residual itself was available but not enough of
the other three dimensions were — 0 suppressed via the scam-warning path):

| | min | p10 | median | p90 | max |
|---|---|---|---|---|---|
| composite | 22.9 | 52.5 | 70.5 | 79.6 | 89.4 |
| `price_residual` | 5.0 | 40.4 | 70.7 | 92.0 | 92.0 |
| `information_completeness` | 18.0 | 40.0 | 72.0 | 79.4 | 90.0 |
| `vehicle_risk` | 0.0 | 25.0 | 67.0 | 83.0 | 85.0 |
| `seller_and_scam_risk` | 50.0 | 75.0 | 75.0 | 100.0 | 100.0 |

**Confirming and refining the user's "64–77" observation**: the full range
(22.9–89.4) is wider than that single hand-reviewed evaluation suggested — but
80% of listings (p10–p90) sit inside a 27-point band (52.5–79.6), and the
median is 70.5. The single evaluation reviewed by hand was not an outlier; it
was close to representative of where the bulk of the distribution actually
sits. The full range is wider only because of a genuine minority of outliers
at both ends.

**`seller_and_scam_risk` is functionally a 3-value discrete signal, not a
continuous one, on this data.** ~99% of values are exactly 100.0 (~45%, no
signals fired) or 75.0 (~53%, exactly one fired); only ~1% are 50.0 (two
fired); 0/179 ever reach the 4-signal suppression threshold. A dimension
carrying 10/100 of the composite weight is, in practice, closer to a binary
"clean vs. one flag" indicator than a graded score — every one of its 25-point
steps beyond the first is unobserved on current data.

**Negotiation anchors (spec 5.1's "strong offer"/"walk away" numbers) are
withheld on 95% of evaluations.** `should_publish_anchors`
(`curve.py:324-339`) requires the published interval's width to be ≤30% of the
point estimate (`MAX_INTERVAL_WIDTH_FOR_ANCHORS`). Measured: **anchors
published on 8/170 (5%), withheld on 162/170 (95%)**. Spec 5.1 presents the
four-number block ("Current ask / Expected range / Strong offer / Walk away
above") as the headline output; on real data, two of those four numbers are
absent 19 times out of 20.

**Confidence never reaches HIGH on any of the 179 captures.** Distribution:
`medium`: 143, `low`: 27, `none`: 9, **`high`: 0**. Traced why: two structural
limiters (`DEALER_FILTERING_UNAVAILABLE`, `NO_RECENCY_WEIGHTING`) are present
on every evaluation that has an estimate at all (170/179 — the 9 `NONE`-
confidence captures short-circuit before reaching them, `confidence.py:120-121`),
and `Limiter.WIDE_INTERVAL` additionally fires on **159/179 (89% of all
captures; 94% of the 170 with an estimate)**. `HIGH` requires `n ≥ 15` *and*
`len(limiters) ≤ 2` — i.e., nothing beyond the two permanent ones — and
`WIDE_INTERVAL` alone defeats that on the great majority of the dataset, on
top of whatever else fires. Combined with only 90/179 reaching the 15-comp
count floor, `HIGH` is not merely rare, it is **effectively unreachable given
the current thresholds and current data quality**, which collapses confidence
from its designed three useful levels (`HIGH`/`MEDIUM`/`LOW`) to two in
practice.

---

## 7. Paper ablation

Ran the codebase's own tool: `python -m app.cli.ablation --offline`
(170 captures with a published score):

| Component | Weight | n | mean \|Δ\| | max \|Δ\| |
|---|---|---|---|---|
| `price_residual` | 56 | 170 | 10.59 | 38.91 |
| `vehicle_risk` | 25 | 170 | 5.19 | 16.54 |
| `seller_and_scam_risk` | 10 | 170 | 2.13 | 7.82 |
| `information_completeness` | 9 | 170 | 1.31 | 4.66 |

**Ranking by actual influence exactly matches the nominal weight ranking**:
`price_residual > vehicle_risk > seller_and_scam_risk > information_completeness`,
in both weight order and mean-|Δ| order. This is the one section of the audit
with a genuinely clean result — per spec 9.2's own test ("if removing a signal
changes almost nothing, the weight is too high or the signal is not real"),
no dimension here fails that test outright.

One softer signal worth recording: normalizing each dimension's mean-|Δ| by
its own weight gives 19% (price_residual), 21% (vehicle_risk), 21%
(seller_and_scam_risk), but only **15% for information_completeness** — every
other dimension moves the score by roughly a fifth of its allotted weight when
ablated; completeness moves it by less. Mild evidence its 9-point weight is
very slightly generous relative to its measured influence, not a strong
finding on its own — but it's also the dimension section 5 shows is already
double-counted through description length, so its *effective* influence
(including the leak through `seller_and_scam_risk`) is understated by looking
at completeness's own weight in isolation.

---

## 8. Confidence model

Levels: `HIGH` / `MEDIUM` / `LOW` / `NONE` (`confidence.py:27-31`). Computed
by `assess_confidence` (`confidence.py:114-219`) from a list of named
`Limiter`s (14 possible, `confidence.py:34-55`), rolled up by:
- `NO_ESTIMATE` → not reached (handled earlier as `NONE` directly).
- Any `disqualifying` limiter (currently just `WRONG_MARKET`) → forced `LOW`
  regardless of anything else (`confidence.py:207-209`).
- `EstimatorKind.COMP_MEDIAN` or `n < MIN_COMPS_FOR_REGRESSION(8)` → `LOW`.
- `n ≥ COMPS_FOR_HIGH_CONFIDENCE(15)` and `len(limiters) ≤ 2` → `HIGH`.
- Otherwise → `MEDIUM`.

**Is confidence an input to the score, a modifier, or purely a display
label?** Purely a display label, confirmed structurally: `compute_deal_score`
(`score.py:187-194`) has no confidence parameter, and nothing in
`evaluation/__init__.py` threads `pricing.confidence` into `deal_score`. It
travels alongside the score in `PricingAssessment`
(`model.py:38-58`) and in the serialized payload (`serialize.py`), but never
back into the arithmetic.

**Does interval width feed confidence, or are they computed independently
from the same quantities — and do they ever disagree?** Independently, from
overlapping quantities. `Limiter.WIDE_INTERVAL` (`confidence.py:174-181`)
reads the **published prediction interval** (`asking_interval_*_cents`); the
curve's own noise-floor subtraction (section 4's main finding) reads a
*different* quantity, `expected_uncertainty_fraction` (the interval on the
fitted *mean*, ~3.4x narrower per `regression.py:162-163`). So "confidence"
and "how much of the residual got zeroed out by the curve" are computed from
two different width measures that happen to be correlated but are not the
same number.

Checked empirically for actual disagreement across all 179 captures:
- `HIGH` confidence with a wide published interval: **0 cases** (moot — `HIGH`
  never occurs at all, see section 6).
- `LOW` confidence with a tight published interval (<10% half-width): **0
  cases**. Closest observed: capture 159, `LOW` confidence (forced by
  `WRONG_MARKET`) with a 16.8% half-width — still wider than the "tight"
  threshold tested.

So on the current 179 captures, confidence and interval width never visibly
contradict each other — but that's closer to accidental than structural:
`WRONG_MARKET` forces `LOW` regardless of interval width, and captures
carrying that limiter also happen to have middling-to-wide intervals in this
dataset (12/12 examples checked were ≥16.8%). A capture with a genuinely tight
regression fit *and* a wrong-market comp set is possible in principle and
would produce exactly the disagreement the user asked about; it simply hasn't
occurred in the 179 captures on hand.

---

## 9. Findings, ranked by potential to distort a score

**Fix status (post-audit)**: findings #1, #2, #3, #6, and #7 have been fixed;
see `docs/scoring-audit-fixes.md` for what changed, the exact test/CLI
evidence for each, and why. Findings #4 and #5 got a visibility tool
(`app.cli.confidence_report`) rather than a threshold change, per the
reasoning in that same document — there is still no calibrated ground truth
to justify picking new numbers over the current ones. Findings #8 and #9 are
unchanged: #8 because it was already correct, #9 because it is blocked on
data the scraper does not collect yet. The rankings and numbers below are
left exactly as originally written — they describe the state that motivated
the fixes, not the current state.

1. **[WRONG — structural, not just uncalibrated] The uncertainty-margin floor
   in `resolvable_residual` (`curve.py:93-146`) collapses 35% of all rated
   listings to the identical `price_residual` sub-score (70.667), erasing the
   distinction between a car asking 1.7% over expected and one asking 10%
   under.** This is the single largest driver of the "compresses toward fine"
   effect the user suspected, and it's a real design side-effect, not a
   placeholder constant waiting on calibration. Validating/fixing this means
   deciding whether the floor should degrade the curve's *resolution*
   continuously (e.g., blend toward the plateau rating proportional to how
   much margin was subtracted) rather than snapping the input to exactly
   zero. This needs a design decision, not a data-fitting pass.

2. **[WRONG — textual conflict] `MIN_COMPS_FOR_ANY_ESTIMATE = 3`
   (`pricing/params.py:230`) directly contradicts spec 4.3's "never silently
   score off 3 comps."** 4/179 real captures score off exactly 3–5 comps
   today. Fixing this is a one-line constant change plus deciding what the new
   floor should be (spec suggests it should be strictly more than 3).

3. **[WRONG — three uncoordinated thresholds for one concept] "How deep a
   discount is suspicious" is answered three different, independently invented
   ways**: the curve's implausible-discount floor (-45%, `curve.py`), the
   confidence penalty (-25%, `confidence.py:348`), and the scam signal (-35%,
   `scam.py:38`). None reference each other or a shared constant. Fixing this
   doesn't require new data — it requires deciding whether these are supposed
   to be the same threshold (in which case, unify them) or genuinely different
   questions at genuinely different depths (in which case, say so in each
   docstring, because right now nothing explains why they differ).

4. **[UNVALIDATED, but severe on real data] `seller_and_scam_risk` is
   functionally 2–3 valued (100/75/50) across 179 real captures, and
   `HIGH` confidence is empirically unreachable** (0/179) because
   `WIDE_INTERVAL` fires on 94% of captures with an estimate on top of two
   permanent structural limiters. Both dimensions are contributing far less
   resolution than their weights or their three/four nominal levels imply.
   Validating this means re-examining whether `WIDE_INTERVAL`'s 35%-of-point
   threshold and `COMPS_FOR_HIGH_CONFIDENCE=15` were set against real
   comp-set noisiness, or just against the spec-0 comp-count target — the
   evidence here suggests the former was never checked.

5. **[UNVALIDATED] Negotiation anchors — spec 5.1's "strong offer" and "walk
   away above" numbers — are withheld on 95% of evaluations** (8/170
   published) because `MAX_INTERVAL_WIDTH_FOR_ANCHORS=0.30` is stricter than
   the comp sets this product actually gets on Facebook Marketplace. This
   isn't wrong on its own terms (withholding an unsupported number is the
   right instinct, per the module's own reasoning) but it means the spec's
   headline four-number block is, in practice, usually a two-number block.
   Worth deciding whether the threshold is miscalibrated or whether the
   feature needs to be presented as usually-absent by design.

6. **[DOUBLE COUNT, likely intentional but unacknowledged] Description
   length under 120 chars costs `information_completeness` *and*
   `seller_and_scam_risk` off the literal same shared constant**
   (`MINIMAL_DESCRIPTION_CHARS`, `flags/params.py:23`, imported into both
   `completeness.py:141` and `scam.py:241`). A single sparse description
   costs roughly 4.1 composite points through two channels rather than the
   ~1.6 either channel's weight would suggest alone. Neither module's
   docstring mentions the other. Cheap to fix (make the interaction explicit
   or accept it with a comment); expensive to leave silently discovered by
   someone debugging a low score later.

7. **[PROVENANCE GAP, not a numeric error] Vehicle-risk baselines (0/25/70/
   85/65), the recall penalty cap, the scam per-signal deduction, and most of
   `negotiation/strength.py`'s constants (base 30, time bands, leverage
   thresholds, language cap/multiplier) are invented the same way as
   everything in `pricing/params.py` — but live inline in scoring logic with
   no centralizing params file and no "UNCALIBRATED" disclaimer.** Nothing
   here is more or less correct than the labeled (b) constants elsewhere; the
   finding is that a future calibration pass (spec 9) will find the pricing
   constants by reading one file and will not find these the same way unless
   someone goes looking.

8. **[UNVALIDATED — no bug found] Composite weights (56/9/25/10) and their
   ranking by ablation-measured influence agree with each other**, and the
   pricing-dimension prediction interval is a real fitted interval (not a
   heuristic) on 87% of captures. These check out. Section 3 and section 7 are
   both essentially clean; recorded here only so it's clear they were checked,
   not assumed.

9. **[ABSENCE, matches spec's own priority ranking of its own gap] Comp-set
   dealer filtering — which spec 6.3 calls "the more valuable use of this
   signal" — has zero implementation**, because comp cards carry no
   description or listing-count field at all (`comps.py:15-20`). This is
   already flagged in the code itself and in every confidence assessment via
   `DEALER_FILTERING_UNAVAILABLE`; it's listed here only to rank it against
   the other findings: it's a known, acknowledged, permanent-until-new-data
   gap, not a surprise.

**What's hypothesis vs. what's a mistake, per spec 9's own framing:**
findings 1, 2, 3, and 6 are code behaving in ways its own design rationale
doesn't fully account for, or in direct conflict with spec text — those are
closer to "wrong" than "uncalibrated." Findings 4 and 5 are real, measured,
severe compression/suppression effects, but the constants driving them are
already labeled `UNCALIBRATED` by the code itself — closer to "the
hypothesis was wrong," which is exactly what spec 9's ground-truth pass exists
to catch, except section 9's ground-truth set (36 labels under `labeler=josh`,
confirmed present in `ground_truth_labels`) already ran via `app.cli.agreement`
during this audit and returned **16/35 exact agreement (46%)** against the
model's four-way pricing verdict — worth noting because several module
docstrings in this codebase assert "there is no ground truth set in this
repo," which is now stale: there is one, it's below spec 9.1's stated target
of 50–100 labels, but it already exists and already disagrees with the model
more than half the time.
