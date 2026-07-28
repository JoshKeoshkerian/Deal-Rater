# Calibration pass 1

Companion to `docs/scoring-audit.md` / `docs/scoring-audit-fixes.md`. Where
those documented a code-reading audit plus 36 hand labels, this documents the
first real run of spec 9's calibration pass once the label set crossed spec
9.1's floor: **75 labels, all `labeler="josh"`**, against **206 stored
captures**, run offline (`offline=True`) against the live Postgres instance.

## What ran

The existing toolchain, unchanged: `python -m app.cli.{agreement,ablation,
backtest,confidence_report}`. Headline numbers at 75 labels, for the record:

- `agreement`: 27/72 exact (38%), 27/66 excluding `avoid` (41%).
- `ablation`: influence ranking still matches weight ranking exactly
  (`price_residual > vehicle_risk > seller_and_scam_risk >
  information_completeness`), same as at 36 labels.
- `backtest`: 15.3% MedAPE, 4,133 out-of-sample predictions, materially
  unchanged from the audit's 15.6%.
- `confidence_report`: `HIGH` still unreached on any of 206 captures; anchors
  still published on ~5% of evaluations. Unchanged.

None of this alone was new. What's new is a follow-up question the 38%
agreement figure raises but doesn't answer: **is the disagreement telling us
the curve breakpoints are wrong, or that price residual isn't the right thing
to compare against these particular labels at all?**

## Finding: price residual does not track the hand labels

Spearman correlation between the raw comp-based price residual and the
human's four-way verdict, ordered `good_deal < fair < overpriced ~ avoid`:
**+0.022** across the 72 scorable labels -- indistinguishable from zero. It
goes slightly *negative* (-0.13) restricted to the best-supported captures
(15+ comps), which rules out "thin comp sets are diluting the signal": the
correlation isn't buried in noisy cases, it's absent even in the clean ones.

Three further stratified checks (same method `backtest.py` already uses to
stratify MedAPE, applied to agreement instead) confirm the same thing from a
different angle -- and each one is the *opposite* of what a "dirty comps are
the problem" theory would predict:

| Split | Agreement |
|---|---|
| Target mileage outside the comp set's fit range (extrapolation) | 71% (5/7) |
| Target mileage inside the range | 37% (22/59) |
| Comp count 15+ | 25% (4/16) |
| Comp count 8-14 | 45% (21/47) |
| Uncertainty margin < 8% (tightest fit) | 33% (9/27) |
| Uncertainty margin 15%+ (widest fit) | 50% (9/18) |

Bigger, statistically tighter comp sets agree *less* with the human verdict,
not more. Spot-checking the worst individual misses (a 2015 CX-5, a 2014
Mazda6, a 2018 Outlander Sport, a 2014 Maserati Ghibli -- capture ids 119, 83,
114, 88) turned up real comp-set contamination in each one (junk-priced
outliers, a 0-mile placeholder comp, a comp whose "price" was actually a
financing down payment, mixed trims), but fixing the one clearly-wrong bug
among them (below) didn't move the aggregate figures, and the broader
stratification says it wouldn't have: the disagreement is spread evenly
across clean and dirty comp sets alike, not concentrated in identifiable bad
data a filter could catch.

**Conclusion, confirmed directly with the labeler:** these labels encode "would
I buy it / does this seem sketchy," not "is this priced accurately" -- the
labeler doesn't have the market knowledge to judge the latter independently of
the comp comparison the model already runs, so hand-labeling price accuracy
would just be a noisier version of the same comparison. That's a legitimate
reason price residual doesn't correlate with these particular labels, not a
sign the curve breakpoints are miscalibrated.

## What correlates instead

Same 72 labels, same Spearman method, against each composite component's own
0-100 rating (not the raw residual -- the already-curve-shaped value that
feeds `evaluation/score.py`):

| Component | Spearman | Shape across good_deal / fair / overpriced / avoid |
|---|---|---|
| `vehicle_risk` | **+0.367** | 75 / 69 / 61 / 52 -- clean, monotonic |
| `seller_and_scam_risk` | +0.338 | 87.5 / 88.0 / 82.2 / 84.4 -- **not monotonic**: `avoid` scores above `overpriced` |
| `information_completeness` | +0.213 | 72 / 69 / 67 / 57 -- monotonic |
| `price_residual` (curve rating) | +0.149 | 68.6 / 71.0 / 61.9 / 62.3 -- not monotonic: `fair` scores above `good_deal` |
| composite score | +0.284 | 72.5 / 72.0 / 64.0 / 60.3 -- `good_deal`/`fair` barely distinguishable |

`vehicle_risk` is the one real, validated result of this pass: it's the
best-correlated dimension and the only one that's cleanly monotonic across all
four buckets, which lines up with what the labeler is actually reading off a
listing (recalls, complaints, title status) when deciding whether to trust it.
`information_completeness` holds up too, more weakly.

`seller_and_scam_risk` does not track `avoid` at all -- traced to why:
`minimal_description` and `vin_omitted_from_detailed_listing` (the only two
signals that ever fire on this data, per the original audit's finding #4) fire
about as often on ordinary terse private-party listings as on the ones the
labeler flagged `avoid`. They're selective for "a typical thin FB listing," not
for "sketchy." Spec 6.3's 4-signal warning threshold is never reached on any
stored capture, so no listing ever gets the intended prominent warning either.
**Could not be fixed this pass**: only 2 of 75 labels carry a note explaining
the call ("no price listed", "sketchy listing"), not enough text to infer what
the labeler is actually keying off of. Filling in the one-line "why" prompt
(`app.cli.label` already asks for it) going forward is what would unblock a
redesign here.

## Decision: pricing is validated by `backtest`/`outcomes`, not by these labels

No change to `pricing/params.py`'s curve breakpoints or `evaluation/score.py`'s
composite weights from this pass. Fitting breakpoints to a label set with ~0
correlation to the thing they'd be fit against would produce numbers that look
calibrated and aren't -- precisely the failure spec 9.5 already warns about for
intervals, applied here to breakpoints instead.

Pricing accuracy has its own legitimate, already-running validation channels,
both objective (sourced from real market data, not a labeler's opinion):

- `python -m app.cli.backtest` -- leave-one-out cross-validation against real
  held-out asking prices. This is the number to re-run after any change to
  comp filtering or the regression.
- `python -m app.cli.outcomes` -- spec 9.3's recheck tracker, already live on
  this data (48/101 captured listings have at least one recheck). Whether a
  "good deal" verdict tends to hold/sell and an "overpriced" one tends to sit
  and drop is the eventual source of ground truth for the curve breakpoints,
  and it accumulates without requiring anyone's pricing expertise -- just time
  and rechecks.

## Fix shipped this pass

**Financing-language comp filter** (`pricing/comps.py`,
`looks_like_a_financing_offer`, new `Exclusion.NOT_AN_ASKING_PRICE`). One of
capture 88's Maserati comps had `price_cents` set from a "$4,000" figure that
was actually a down payment ("!!DOWN PAYMENT!!" was the whole of what the
extractor recovered as trim text), not an asking price. Excluded the same way
`looks_like_a_part` already excludes accessory listings. Checked against both
`title` and `trim_text` since the real example carried the marker in the
latter. Rare on captured data (3 of 6,736 stored comp observations), so it's a
correctness fix, not something expected to move `backtest`/`agreement`
aggregates -- confirmed: both are unchanged after shipping it. 8 new tests in
`tests/test_pricing_comps.py::TestFinancingLanguage`; full suite 510/510.

## Where this leaves labeling going forward

Keep labeling the way it's already being done -- buy/sketchy judgment, not
price-accuracy judgment. That's genuine, non-redundant signal for
`vehicle_risk` and (eventually, once notes exist) `seller_and_scam_risk`. Add
the one-line "why" note on `avoid` and `overpriced` calls specifically; that's
the one piece of data this pass didn't have enough of.
