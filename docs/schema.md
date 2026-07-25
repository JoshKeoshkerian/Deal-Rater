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

The §4.1 fields, plus two columns that are not listing data:

**`field_strategies`** — `{"price_cents": "json_payload", "mileage": "text_pattern"}`.
The most useful column in the schema for keeping this thing alive. A field
degrading from `json_payload` to `text_pattern` means Facebook has already
changed something, while the field is still populated and nothing looks wrong.
`GET /v1/telemetry/extraction-health` surfaces the distribution.

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
