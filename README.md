# Deal Rater

Extension plus backend that captures a Facebook Marketplace vehicle listing and
its comparable listings, evaluates it (expected price, negotiation strength,
flags, NHTSA recalls, better alternatives, qualitative known issues), and shows
the result in an overlay -- per [the spec](fb-deal-evaluator-spec.md)'s build
order (§13), steps 1 through 8.

**What's not done yet: §13 step 9, calibration.** The pricing curve's
plateau/decline breakpoints are still the spec's illustrative guesses, never
fitted to a ground truth set -- `is_calibrated()` is hardcoded `False` and the
overlay's beta badge reflects that. This is deliberate, not just outstanding:
see [docs/calibration-pass-1.md](docs/calibration-pass-1.md) for why the price
curve is validated against `backtest`/`outcomes` rather than the hand-labelled
set. See [spec §9](fb-deal-evaluator-spec.md) and the CLIs in
`backend/app/cli/`: `label` and `agreement` build and score a hand-labelled
set, `ablation` checks whether each dimension's weight is doing real work,
`backtest` is leave-one-out cross-validation of the expected-price regression,
`confidence_report` tracks the confidence/anchor threshold distribution,
`outcomes` tracks price movement on rechecked listings, `audit` catches
identity-corrupted captures, `cost` reports the known-issues call's real
cost-per-evaluation.

## Layout

```
extension/   Manifest V3, TypeScript. Scrapes, derives seller fields, posts.
backend/     FastAPI + Postgres. Validates and persists timestamped observations.
contract/    One example capture payload, checked from both sides.
docs/        Schema and selector strategy, in more depth than this file.
```

## Running it

```bash
# database
docker compose up -d

# backend
cd backend
python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"
cp ../.env.example .env          # then set DEAL_RATER_CORS_ORIGINS
.venv/bin/alembic upgrade head
.venv/bin/uvicorn app.main:app --reload

# extension
cd extension
npm install
npm run build                     # -> extension/dist
```

Load `extension/dist` at `chrome://extensions` with developer mode on. Copy the
extension id it prints into `DEAL_RATER_CORS_ORIGINS` as
`chrome-extension://<id>`, restart the backend, then open the extension's
options page and set the backend URL.

Open a Marketplace vehicle listing and click **Capture listing**.

```bash
cd backend && .venv/bin/python -m pytest      # 510 tests
cd extension && npm test && npm run typecheck # 317 tests (1 skipped)
```

## How a capture works

1. You click. Nothing happens before that, and nothing happens after it returns.
2. The listing you have open is extracted (spec §4.1).
3. One Marketplace search runs for that vehicle, and its result cards are read.
4. The seller's identifier is hashed in the browser; their active listing count
   is derived. Nothing else about them is read.
5. Both go to `POST /v1/captures`, which writes one timestamped observation row
   per listing.

## Constraints this build holds to

**Everything is user-initiated** (spec §8.1). There are no timers, no alarms, no
scheduled jobs, and no background crawling anywhere in the extension. The
service worker acts only on a message from a content script, and a content
script sends one only on a click. One click is one listing plus one search, with
no pagination and no auto-scroll. There is no "monitor this search" feature and
adding one would undo the rationale for store distribution.

**Permissions are narrow** (spec §8.1.2). `storage`, plus host permissions for
Marketplace paths and your API host. No `<all_urls>`. No `tabs` — the
background-tab fallback for the comp search needs `chrome.tabs.create` and
`chrome.tabs.remove`, neither of which requires it, and nothing reads a tab's URL
or title.

The content script matches `/marketplace/*` rather than `/marketplace/item/*`.
This is deliberate: Facebook is a single-page app, so a user who lands on the
Marketplace home page and clicks into a listing never triggers a fresh injection
under the narrower pattern. The button is still mounted only on item pages.

**Seller data is two fields** (spec §8.2). An irreversible hash and an integer.
Display names, profile URLs, profile photos and join dates are not read, not
derived, and have no field on the wire contract to travel in. Phone numbers and
email addresses in descriptions are replaced with `[PHONE]` and `[EMAIL]` before
the description leaves the browser, and again on the server.

The hash is a *pseudonym, not an anonymisation*. The pepper is shipped in the
extension bundle and is therefore not secret; anyone with the bundle and a
candidate id can confirm a match. It has to be stable across users and over time
or the longitudinal features in §4.4 do not work. `hash_version` exists so it
can be rotated, at the cost of severing continuity with everything observed
before.

**The backend does not know the extension exists** (spec §8.1.4). The payload
carries a `client: {name, version}` block and nothing branches on it. A
paste-a-URL web client posts the identical shape.

**Every observation is a new row** (spec §4.4). Nothing volatile is updated in
place. See [docs/schema.md](docs/schema.md).

## Known limitations

- `active_vehicle_listing_count` is a **floor**, not an exact count: the DOM path
  counts a paginated section. It is the right shape for the `>= 3` threshold in
  §6.3 but must never be treated as exact. It counts the listing being viewed,
  so read that threshold accordingly.
- `price_changed` is `true` or `null`, never `false`. Facebook renders a marker
  when a price has changed and renders nothing when it has not, so absence is
  genuinely ambiguous and recording it as `false` would invent a fact.
- `posted_at` derived from "listed 3 weeks ago" is approximate to the week. The
  original phrasing is kept in `posted_relative_text` so the approximation stays
  visible rather than being laundered into a precise-looking timestamp.
- Comp search sends only `query`. Radius and year-range parameters exist on that
  route but their names are not stable enough to rely on unverified, and a wrong
  parameter returns zero results silently. Progressive widening belongs with
  step 3's minimum-comp fallback, where there is a result count to verify against.
- The Facebook payload key names in `extension/src/extract/fb-keys.ts` are the
  most fragile constants here and have not been verified against a live page.
  Do that first — see [docs/selector-strategy.md](docs/selector-strategy.md).
- No real page fixtures are committed yet, so only synthetic pages have been
  verified. `extension/tests/fixtures.test.ts` says so out loud rather than
  passing silently.

## Retention

`backend/app/retention.py` enforces the window in `DEAL_RATER_RETENTION_DAYS`.
It is not scheduled for you — spec §8.2 asks for programmatic enforcement, and
running it is your call:

```bash
.venv/bin/python -m app.retention --dry-run
.venv/bin/python -m app.retention
```

## Known-issues LLM call (spec §6.6)

The only per-call API cost in the product: a cached Claude call for qualitative
"what to check on this specific car" text. Toggle it with
`DEAL_RATER_KNOWN_ISSUES_ENABLED` in `.env` (defaults to `true`). When it's
`false`, or when `DEAL_RATER_ANTHROPIC_API_KEY` / `ANTHROPIC_API_KEY` is unset,
zero Anthropic API calls are made — the check happens before the SDK is even
imported — and the rest of the evaluation is unaffected; the section just
explains its own absence. The backend logs the effective state
(`ENABLED`/`DISABLED`, and why) once at startup. See
`backend/app/known_issues/` and spec §10 for the cost gate and cache behind it.

## Before shipping

Read the current Chrome Web Store developer program policies before the manifest
is final, not after (spec §8.1). The disclosure in §8.3 is in the options page;
it needs to be on the store listing too.
