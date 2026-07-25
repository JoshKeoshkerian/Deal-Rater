# Selector strategy

Spec §4.6: Facebook is a single-page app with obfuscated, frequently rotated
class names, selector-based scraping will break repeatedly, and ongoing
maintenance is a permanent cost of this product. The design goal is not to avoid
breaking. It is to break in a way you find out about, in one file, early.

## Four tiers

Every §4.1 field is a cascade. The first tier that produces a parseable value
wins, and **the tier that won is recorded** on the observation row.

### Tier 1 — embedded JSON payloads (`strategies/json-payload.ts`)

Facebook server-renders its initial data into `<script type="application/json">`
blobs. Best source available: values are already typed, the description is not
truncated the way the rendered DOM is, and key names are data model rather than
presentation.

Search is by key name over the whole parsed tree, which is deliberately
structure-agnostic — the nesting path changes constantly, the key names do not.

Bounded traversal (`MAX_NODES`, `MAX_DEPTH`): these payloads are large and the
user is waiting on a click.

Prefer `findObject` + `pick` over a bare `findValueByKey`. Locating the listing
object and then reading its siblings is accurate; pulling `amount` from anywhere
in the tree finds *a* price on a page that carries several listings. The
strongest disambiguator is the listing id from the URL, which is what
`findTargetListingNode` matches on first.

### Tier 2 — Open Graph and meta tags (`strategies/meta-tags.ts`)

Coarse: `og:title` carries the vehicle title, `og:description` a truncated
description, `link[rel=canonical]` the listing id. These exist because external
systems consume them, so Facebook has a reason not to churn them.

### Tier 3 — ARIA and semantic structure (`strategies/aria-dom.ts`)

Landmark roles (`main`, `heading`, `article`), `aria-label` text, and URL shape.
Accessibility semantics are load-bearing for Facebook, so they are more stable
than anything visual.

`a[href*="/marketplace/item/"]` is the single most stable anchor on the page: it
is routing rather than presentation, and it yields the listing id for free.

### Tier 4 — text pattern matching (`strategies/text-patterns.ts`)

The floor. Always scoped to a subtree that tier 3 located, never run over the
document — an unscoped `$[\d,]+` match reliably finds a price and unreliably
finds *this* price.

`matchDeepest` prefers the smallest element containing a match, because a
container's `textContent` includes everything below it and the outermost match
is almost never the value you want.

## Banned

No generated class selectors (`.x1i10hfl`). No positional `nth-child` chains
into the div soup. No index-based XPath. None appear anywhere in `src/`.

Blocks are located structurally instead: `listingHeaderBlock` walks up from the
page heading until the enclosing element also contains a price-shaped string,
and `sectionByHeading` walks up from a heading whose text matches a pattern.
Both are tests of content rather than of position, so they survive a re-nesting
that a fixed hop count would not.

## Where it will break, and what to edit

**`src/extract/fb-keys.ts` is the highest-value and most fragile file in the
project.** Every Facebook payload key name is there and nowhere else. When tier
1 stops working, that is the file to edit.

**These key names have not been verified against a live page.** Do that before
trusting the tier-1 path:

```js
// on a Marketplace listing page, in the console
[...document.querySelectorAll('script[type="application/json"]')]
  .map(s => { try { return JSON.parse(s.textContent) } catch { return null } })
  .filter(Boolean)
```

then search the parsed payloads for the values you expect. The key names in
`fb-keys.ts` are the best available guesses and every one of them has a DOM
fallback behind it, which is why the extractor still works if some are wrong —
but it will work at tier 3 or 4, and the telemetry will say so.

## The self-check

`src/extract/self-check.ts`. Two things per capture:

- **`field_strategies`** — the early warning. Watch
  `GET /v1/telemetry/extraction-health` for `strategy_mix` shifting. `price_cents`
  moving from `json_payload` to `text_pattern` means Facebook has already changed
  something, while the field is still populated and nothing looks broken.
- **`issues`** — fields no tier could produce, at `required` / `expected` /
  `optional`. Only `required` raises an alarm; see [schema.md](schema.md) for why.

`listing_payload` is a structural probe rather than a field: it fires at
`required` when no listing-shaped object exists on what is definitely a listing
page. That is the unambiguous "Facebook changed something fundamental" signal.

## Comp search

Primary path is a same-origin `fetch` of the search URL from the content script.
It already runs on facebook.com, so the request carries the user's own session
exactly as a navigation would. One request, on the click, no new tab, no extra
permission.

Fallback is a background tab driven by the service worker, used only when the
fetch returns a JavaScript shell with no rendered results. Distinguishing "shell"
from "genuinely zero comps" matters: the latter is what step 0 exists to measure
and must not be manufactured by a failed fetch.

## Verifying changes

```bash
cd extension && npm test
```

- `tests/helpers/build-page.ts` renders synthetic pages in three modes —
  `payload`, `dom`, `meta` — so each tier can be exercised in isolation.
- `tests/extract-listing.test.ts` runs 34 distinct listing shapes, including the
  edge cases the step-2 criterion names: missing mileage, empty description,
  single photo, no price.
- `tests/fixtures.test.ts` runs the same extractor against scrubbed real pages in
  `tests/fixtures/pages/`. Synthetic pages prove the cascades work; only a real
  page can tell you `fb-keys.ts` is still correct. See that directory's README
  for how to add one — and read the scrubbed file before committing it.
