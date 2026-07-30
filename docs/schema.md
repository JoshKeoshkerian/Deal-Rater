# Schema

Built for spec §4.4: every observation of a listing is a timestamped row, never
an update in place. None of the features that consume this ship in v1 — they are
phase three (§12) — but retrofitting time-series onto a flat table is painful,
so the shape has to be right now.

Four layers, deliberately separated:

| layer | tables | write pattern |
|---|---|---|
| identity | `listings`, `sellers` | upserted, stable keys |
| observation | `listing_observations`, `seller_observations` | **append only** |
| provenance | `captures` | one row per user click |
| telemetry | `extraction_reports` | scraper health (§4.6) |

## The one in-place update

`listings.last_observed_at` (and `first_observed_at`) move as new observations
arrive. They are a cursor over the observation rows, not data in their own
right, and no history is lost by maintaining them — the alternative is a
`MAX(observed_at)` scan on every lookup for a value that is cheap to maintain.

Everything else about a listing lives on the observation row.

## Why targets and comps share a table

`listing_observations.role` distinguishes them, but the row shape is identical.

A comp today is a target tomorrow. Splitting them would mean the same physical
listing has two histories depending on how it was encountered, and the §1
dataset would accumulate only from listings someone chose to evaluate rather
than from every listing seen. Unified, one click contributes 20–40 observations
instead of one.

The consequence to be aware of: comp rows are sparse. A search card carries
price, title, location and one subtitle, so `description`, `photo_count` and
`posted_at` are usually null on `role = 'comp'`. That is not degradation, and
the telemetry expectations are set per-scope to reflect it.

## `captures`

One row per click, and the join key that makes a capture reconstructible: which
listings were seen together, which search produced them, whether extraction was
healthy at the time.

`client_capture_id` is a client-generated UUID and the idempotency key. A retry
after a timeout that actually succeeded returns the original capture rather than
writing a second set of observations — two rows a second apart would otherwise
look like two genuine sightings.

`extraction_ok` is derived server-side from the report, never sent by a client.

### `comp_search_query`

A free-form JSON blob (`schemas.CaptureIn` types it as `dict`), because it
records how the extension went looking rather than anything the backend scores.
Nothing reads it at evaluation time except `location_scoped`. It exists so a bad
comp set can be diagnosed after the fact instead of inferred from city names —
and so the acquisition strategy can be changed against measurement rather than
against intuition. Current keys, beyond `query` / `derived_from` / `source`:

| key | why it is recorded |
|---|---|
| `location_scoped` | False means the comps came back scoped to the *user's* metro rather than the listing's. Invalidates a comp set rather than merely widening it. |
| `search_radius_km` | Not settable per request — Facebook holds it against the account — so recording it is the only way a comp set's geographic scope is knowable later. |
| `home_metro`, `home_metro_source` | Which market the peer list was drawn from, and whether it came from coordinates or from city names (`comps/metros.ts`). Distinguishes "the listing's market could not be identified" from "its peers were all searched", which both used to read as an empty `extra_metros_searched`. |
| `extra_metros_searched`, `extra_metros_unresolved` | Which peer markets were reached, and which slugs silently returned somebody else's metro. |
| `home_returned`, `home_usable` | The home search's own composition. A page that came back mostly same-model means Facebook still had inventory and merely chose which trims to show; a page padded out with other models means the radius is out of them. This is the signal that should eventually gate the trim query. |
| `trim_query`, `trim_query_returned`, `trim_query_new` | The trim-worded search (§4.3, `build-query.buildTrimSearch`), what it returned, and how much of that was new after dedup. Null when it did not fire. |
| `trim_matched_before`, `trim_matched_after` | Same-trim comp count either side of the trim query, so its yield per request is measurable against a peer metro's. |
| `usable_comp_estimate` | The extension's own loose count, for comparison against what the backend actually keeps. |

The trim-query keys are deliberately verbose for a feature that helped on one of
three hand-tested vehicles. It was shipped conditional and instrumented rather
than either skipped or trusted, and these columns are what will decide which it
should have been.

## `listings`

Identity only: `(source, source_listing_id)` unique, plus the two keys that
relisting detection will need.

- **`vin`** — the strong key. Set once recovered from any sighting and retained
  thereafter, because it is a fact about the vehicle rather than about the
  moment it was scraped.
- **`relisting_key`** — the fallback, computed at ingest by
  `services/relisting_key.py` as a hash of year, make, model, a 10k mileage
  bucket, and a city slug. Stored now; the matching logic that reads it is phase
  three. Mileage is bucketed because a relisted car accrues miles and sellers
  round odometer readings differently between posts. Returns null without a year
  and a model — a key that collides across unrelated vehicles is worse than no
  key, since the phase-three claim it would support ("this exact vehicle was
  listed in May at $15,000") is only compelling if it is true.

Spec §15 asks whether relisting detection can work without VINs. The schema does
not answer that; it makes the question answerable from data already collected.

## `sellers`

Five columns, and there is not meant to be a sixth: `id`, `seller_hash`,
`hash_version`, `first_seen_at`, `last_seen_at`. A test asserts exactly that set
so a "just for debugging" column fails CI.

Unique on `(seller_hash, hash_version)`, so a pepper rotation creates new rows
rather than colliding with the old ones. Rotating severs continuity with
everything observed under the previous version. That is the cost of rotation and
it should be an explicit decision.

## `listing_observations`

The §4.1 fields, plus the derived vehicle columns and two columns that are not
listing data.

### `trim_text` and the columns derived from it

`trim_text` is stored verbatim and is never rewritten. It is one free-text
column that encodes at least four separate facts — `2.0i Premium Sport Utility
4D` is trim level *Premium*, body *sport_utility*, engine *2.0i*, drivetrain
unstated — so `trim_level`, `body_style`, `engine_text` and `drivetrain` are
derived from it at ingest by `services/vehicle_facts.decompose`.

Comparing the whole string made a body-style mismatch indistinguishable from a
trim-level one: `EX-L Hatchback 4D` vs `EX Sedan 4D` failed as a single opaque
comparison, and `Premium Sport Utility 4D` vs `2.0i Premium Sport Utility 4D`
failed on an engine prefix alone (28 such pairs on one model in captured data).

Derived **server-side rather than in the extension** on purpose. `extract/
fields/vehicle.ts` keeps trim unnormalised because spec §4.2's VIN decode
(build step 6) replaces it with the vPIC value, and a normalisation applied at
capture time would have to be undone. Keeping `trim_text` untouched means step 6
can overwrite `trim_level` without destroying what the seller actually wrote —
and it is what made these columns backfillable for observations already
collected.

`trim_source` records which tier produced `trim_text`:

| value | meaning |
|---|---|
| `fb_catalog` | Facebook's own catalog string, after the `·` in the title or from `vehicle_trim_display_name`. Written identically every time. |
| `title_text` | Parsed out of a seller-typed title. `Touring 🤘 174160 Miles`, `grand touring awd - `. |
| `description` | Recovered from description prose by `detectTrimInText`. Rarest and least trusted. |

Two trims are not equally trustworthy just because both are populated, and until
this column existed the difference was unrecoverable once the row was stored.
66% of backfilled observations are `fb_catalog`, 19% `title_text`, 15%
unattributable because no raw title was retained.

### `seller_type` and `transmission`

Straight from the payload, and the reason a note in `pricing/comps.py` had to be
withdrawn. That module documented spec §4.3's dealer exclusion as impossible —
correctly observing that a comp card carries no description and no seller
listing count — but Facebook states the answer outright in
`vehicle_seller_type` (`PRIVATE_SELLER` / `DEALER`), and `FB_KEYS` was searching
for keys that do not exist (`vehicle_trim` rather than
`vehicle_trim_display_name`). Tier 1 of every vehicle cascade was dead code.

Both are **NULL on every observation captured before that fix**, and the
backfill deliberately does not invent them: nothing was ever stored to recover
them from. `DealerSignal.UNAVAILABLE` carries that distinction, so a pre-fix
comp set never reads as "checked, no dealers found".

### `owner_count`

Facebook's "About this vehicle" panel states this directly, the same way it
states `seller_type`: `vehicle_number_of_owners`, one of `ONE` / `TWO` /
`THREE_PLUS`. Target-only, like `title_status` — the search feed comps are
built from does not render it, so there is nothing to capture for a comp card,
and `pricing/comps.py` does not read it for matching.

The red-flags list only calls out `TWO` and `THREE_PLUS`; a one-owner car is
reassurance nobody asked for, the same reasoning as the seller-rating
threshold beside it.

### Not listing data

**`field_strategies`** — `{"price_cents": "json_payload", "mileage": "text_pattern"}`.
The most useful column in the schema for keeping this thing alive. A field
degrading from `json_payload` to `text_pattern` means Facebook has already
changed something, while the field is still populated and nothing looks wrong.
`GET /v1/telemetry/extraction-health` surfaces the distribution.

It is only as useful as its labels are honest, and for the vehicle fields they
were not. `fields/vehicle.ts` labelled *both* "read a structured payload key"
and "regex-split the title string" as `json_payload`, so 213 target and 6,917
comp trims reported `json_payload` while the structured tier had never once
fired — the exact silent degradation this column exists to catch, invisible
because the two tiers shared a name. Title-derived values now record
`title_text`, which is a genuine step down in trust even though the title itself
came out of the payload.

**`raw_extract`** — a small whitelist of the strings a value was parsed from
(title, price text, mileage text, posted text). It exists so a parser fix can be
re-derived against observations already collected instead of needing a fresh
scrape of listings that may be gone. It is a whitelist and not a spread of the
payload, and a test enforces that: a spread would put the seller object and
profile links into the database.

`UNIQUE (listing_id, capture_id)` — one observation per listing per capture. A
search page routinely surfaces the same listing twice, and counting a comp twice
would quietly weight it double in step 3's regression.

## `extraction_reports`

Written even when the capture fails validation, because a capture that fails
validation is exactly the event worth knowing about.

Expectation levels exist because a null is not always a fault:

| level | meaning | flips `extraction_ok`? |
|---|---|---|
| `required` | absence means the scraper is broken; nothing else explains it | yes |
| `expected` | usually present, legitimately absent sometimes | no |
| `optional` | absence is normal | no |

Only the identifiers and the structural probe are `required`. Price is
`expected` — a listing with no price is real data, named in the step-2 success
criterion, and flagging it as breakage would make the signal fire constantly and
mean nothing. What you watch for an `expected` field is the *fill rate over
time*, which the telemetry endpoint computes from the observations themselves.

`page_signature` is a coarse structural fingerprint of the page, built from
counts and presence flags only. Two different listings rendered by the same
layout share one, so a spike in reports can be attributed to a specific Facebook
change rather than being an undifferentiated rise in failures.

## `ground_truth_labels`

The spec 9.1 validation set, and step 3's success criterion. Human verdicts
only — `good_deal` / `fair` / `overpriced` / `avoid`, entered via
`python -m app.cli.label`. Nothing in the codebase writes here automatically,
because a machine-generated label would make the agreement measurement circular.

The label attaches to an **observation, not a listing**. A listing's asking
price changes over time and a verdict is a verdict about a price, so a label
pinned to the listing would silently become a claim about a different offer
after the next price drop.

`(observation_id, labeler)` is unique: re-labelling updates in place. This table
is judgement, not time-series, so it is the one place outside `listings` where
an in-place update is correct. A second labeller can disagree with the first on
the same row, which is what keeps inter-rater disagreement separable from model
error.

## `known_issues_entries`

Spec 6.6's cached LLM answer, and the whole of its cost model.

The row is keyed by **vehicle, not listing** — `(model_year, make, model, trim,
mileage_band, llm_model, prompt_version)` — which is spec 10's instruction
verbatim: "cache known-issues text by year/make/model/trim/mileage-band, not per
listing. Every 2013 Focus at 90k miles gets the same answer." The per-evaluation
price of the feature is therefore the price of one completion *divided by how
many listings share the row*, and that ratio improves for as long as the product
runs. Keying by listing id would have made it a per-evaluation cost forever.

`llm_model` and `prompt_version` are part of the key rather than the payload
because changing either produces different text. A prompt revision then
invalidates the cache by *missing* it — no purge step, no migration — and the
superseded rows stay readable for cost comparison between versions.

`trim` is `NOT NULL` with an empty-string sentinel. NULLs do not compare equal
in a unique constraint, so a nullable column would let every no-trim listing
insert its own duplicate row on every evaluation.

**Cost instrumentation (spec 10).** `cost_microdollars` is what the generating
call cost; `served_count` is how many evaluations that one call has answered.
Cost per evaluation is `SUM(cost_microdollars) / SUM(served_count)` — both halves
have to be stored, because a cache hit is free and dividing by *calls* would
flatter the number by exactly the cache-hit rate, which is the bet spec 10 is
making. `python -m app.cli.cost` reports both.

`currency_items_dropped` counts bullets removed by `app/known_issues/guard.py`
for stating a money figure against spec 6.6's explicit prohibition. Non-zero
means the prompt is not holding on its own; the guard still is.

This table holds **no listing- or seller-derived data** — it describes a vehicle
model, not a car for sale — so it is deliberately outside the retention sweep
below.

## Retention

`app/retention.py` deletes observations past the window, then identity rows with
no observations left behind them. A `listings` row survives exactly as long as
any evidence that the listing existed, so retention never leaves orphaned
identifiers.

## Portability note

Models use `JSON().with_variant(JSONB(), "postgresql")` and portable column
types so the test suite runs on in-memory SQLite without a server. The Alembic
migration targets Postgres and is what production uses; `strategies_attempted`
is JSON rather than `text[]` for the same reason.

`GET /v1/telemetry/extraction-health` aggregates `field_strategies` in Python
over a capped window rather than with `jsonb_each_text`, for portability. That
is fine at step-2 volume and is the first thing to replace with a native query
if the window ever exceeds `STRATEGY_SCAN_LIMIT`.
