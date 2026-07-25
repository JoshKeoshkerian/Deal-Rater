# Saved page fixtures

Scrubbed real Marketplace pages, used by `tests/fixtures.test.ts` as the
regression suite for extraction against markup Facebook actually ships.

The synthetic pages in `tests/helpers/build-page.ts` cover every branch of every
cascade and run without any of this. They cannot tell you that the Facebook key
names in `src/extract/fb-keys.ts` are still correct. Only a real page can.

## Adding one

1. Options page → developer mode → **Save fixture** on the listing.
2. `npm run scrub-fixture -- ~/Downloads/fb-item-….html`
3. **Read the scrubbed file.** The scrubber works from a denylist and a denylist
   is never complete. This step is not optional.
4. Move it into this directory and write `<name>.expected.json` beside it.

## Expectation file

```json
{
  "kind": "item",
  "url": "https://www.facebook.com/marketplace/item/123456789/",
  "expect": {
    "price_cents": 1290000,
    "year": 2014,
    "make": "Toyota",
    "model": "Camry"
  },
  "requirePresent": ["mileage", "location_text", "photo_count"]
}
```

For a search page:

```json
{
  "kind": "search",
  "url": "https://www.facebook.com/marketplace/search/?query=2014%20Toyota%20Camry",
  "minCards": 12
}
```

A fixture without an expectation file fails the suite rather than passing: a
fixture that asserts nothing would stay green however badly extraction broke.

## Coverage to aim for

Per the step-2 success criterion, 30+ varied listings including: missing
mileage, empty description, single photo, no price. Also worth capturing when
you see them — salvage/rebuilt titles, a VIN in the description, a seller with
several active listings, a price-drop marker, and a listing posted within the
hour.

Unscrubbed downloads belong in `tests/fixtures/raw/`, which is gitignored.
