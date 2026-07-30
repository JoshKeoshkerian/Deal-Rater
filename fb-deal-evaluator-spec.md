# FB Marketplace Car Deal Evaluator: Project Spec

**Positioning:** Carfax tells you what happened to the car. This tells you whether it is a good buy.

---

## 0. Step zero: validate the premise before writing code

**Do this before anything else. It is a one-day manual test that can save six weeks.**

The entire product rests on an untested assumption: that Facebook Marketplace has enough private-party listings to build a meaningful comparison set in your actual markets. That may not be true outside major metros.

**The test:** manually search 20 to 30 realistic vehicles (common models, 2010 to 2020, under $20k) across Tulsa and St. Louis. For each, count usable comps: same model, similar year range, similar mileage, private seller rather than dealer.

**Interpreting the result:**
- **15 or more usable comps typical:** the premise holds, build it
- **8 to 15:** viable, but the confidence model becomes essential rather than optional, and rural coverage will be poor
- **Under 8 typical:** the core differentiator does not work in these markets. Either restrict launch to large metros, widen the radius substantially and accept lower comp quality, or reconsider the approach

Record the numbers. They calibrate the minimum-comp threshold in section 4.3 and the regression viability in section 5.1.

---

## 1. What this is

A browser extension plus backend that evaluates a Facebook Marketplace vehicle listing and returns an expected-price assessment, separated risk ratings, and a negotiation brief the buyer can act on.

**First differentiator:** comps come from Facebook Marketplace private-party listings, not dealer sites. Dealer listings (CarGurus, Autotrader, Cars.com) carry reconditioning markup, warranty, and overhead, so benchmarking a private-party car against them makes nearly every FB listing look like a bargain. That is an accuracy problem, not just positioning, and it is what existing tools get wrong.

**The larger and more durable moat: accumulated marketplace history.** Six months after launch the product knows things no competitor can reconstruct, because history cannot be back-filled:
- This seller has listed eight vehicles and typically drops price around day 12
- This exact vehicle was listed in May at $15,000, disappeared, and returned today at $13,700
- It has been relisted three times

This is the Zillow, Carfax, and CamelCamelCamel pattern: the dataset compounds with usage and a competitor starting later cannot catch up by building better software. **Design for it from day one** (section 4.4) even though v1 barely uses it. The features that depend on it are sequenced in section 12.

**Target user: the first-time or infrequent private-party buyer.** A deliberate choice. The higher-revenue segment (flippers and small dealers paying $25/month for Swoopa or CarSnipe) wants speed and alerting, which conflicts directly with the user-initiated constraint in section 8.1. Serving them would require a different architecture and risk posture. Pick the buyer, build for the buyer.

## 2. What "a good deal" actually means

A low price is not automatically a good deal. In private-party used cars the cheapest listings are disproportionately the worst cars: salvage or rebuilt titles, failing transmissions, deferred maintenance, sellers with information the buyer lacks. This is textbook adverse selection.

**Implication:** the relationship between discount and quality is not linear. Roughly 10 to 15 percent under comparable listings is likely a genuine deal. Forty-five percent under is more likely to signal a problem. The pricing curve should rise, plateau, then fall as the discount becomes implausible, and an unexplained extreme discount should reduce confidence rather than inflate the score.

**Price and risk are different questions and must not be collapsed.** A car with a known transmission failure mode priced low for exactly that reason is a risky vehicle that is fairly priced. A clean car priced above comps is a safe vehicle that is a bad deal. A single composite number cannot express either situation honestly. Hence the separated dimensions in section 6.

## 3. Architecture

```
[Browser Extension: content script on FB Marketplace]
        |
        | user clicks "Evaluate" -> scrapes listing, comps, seller fields
        v
[Backend API: FastAPI]
        |
        +--> [Postgres: listings, observations (time-series), sellers, evaluations]
        |
        +--> [NHTSA vPIC: free VIN decode, no API key]
        +--> [NHTSA recalls + complaints: free]
        |
        +--> [Deterministic: expected-price regression, time-on-market,
        |     flags, seller rules, scam patterns]
        |
        +--> [LLM text call (cached): model-specific known issues, brief prose]
        v
[Expected price + risk ratings + alternatives + brief] --> [Extension overlay]
```

### Stack
- **Extension:** Manifest V3, TypeScript
- **Backend:** Python, FastAPI
- **Database:** Postgres
- **External data:** NHTSA vPIC and recall APIs (free, no key)
- **LLM:** one cached text call per evaluation. No vision in the MVP (section 11).

### Billing note
A Claude.ai subscription and Claude API access are separate products. The subscription covers Claude Code doing implementation; runtime calls require a separate Console account at standard API rates. Without vision the per-evaluation cost is small, but instrument it from day one (section 10).

## 4. Data acquisition

The extension runs as a content script while the user is on Marketplace, logged into their own account. All collection is user-initiated by an explicit click. No background crawling. Section 8.1 explains why this is binding.

### 4.1 Target listing fields
price, mileage, year, make, model, title status if stated, description text, photo count, **posted date and any price-change indicators**, location, hashed seller identifier, seller's active vehicle listing count

### 4.2 VIN extraction and decode

**Higher value than it first appears, and not primarily because of recalls.**

Sellers often include the VIN in the description. Extract via pattern match (17 characters, excluding I, O, Q), which is free and catches most cases.

**Primary value: VIN decode solves the comp-matching problem.** Trim and drivetrain ambiguity is the hardest accuracy problem here, because listings routinely omit them and a base 4-cylinder is not a comp for a loaded V6. NHTSA's vPIC API decodes a VIN into exact trim, engine, drivetrain, transmission, and body style, free, no key. Every VIN recovered from a comp tightens the comp set materially.

**Secondary value: free risk data.**
- Open recalls by VIN via NHTSA's recall API
- Complaint density by year/make/model (no VIN required)

**Design notes:**
- Opportunistic, not required. Most listings will not yield one. When recovered, raise confidence.
- Validate the check digit before querying, to avoid wasting calls on typos.
- Cache decodes by VIN indefinitely. VIN-to-specification mapping never changes.
- **A VIN omitted from an otherwise detailed listing is itself a mild signal** and feeds the scam pattern in section 6.3.

### 4.3 Comp set

Trigger a Marketplace search matching the target vehicle and scrape the result cards.

**Comp quality is the hardest technical problem in this project and deserves more attention than the scoring formula.**

- **Mileage adjustment is mandatory.** See section 5.1.
- **Trim and drivetrain drive large price variance** and are frequently missing. Use VIN decode where available; otherwise extract from title and description text. When trim cannot be determined for the target or most comps, widen the interval and lower confidence rather than pretending the comp set is clean.
  - **Trim is not one fact.** A stored trim string encodes trim level, body style, engine and sometimes drivetrain at once — `2.0i Premium Sport Utility 4D` — and comparing whole strings makes a body-style mismatch indistinguishable from a trim-level one. Store the parts separately (`docs/schema.md`), keeping the verbatim string as the audit trail so step 6 can overwrite the derived trim without destroying what the seller wrote.
  - **Record where a trim came from.** Facebook's catalog string (after the `·` in the title) is written identically every time; a seller-typed one is not (`Touring 🤘 174160 Miles`). Both landed in one column and were indistinguishable once stored. Roughly two thirds of captured comps carry the catalog form.
  - **The structured model field is not usable.** `vehicle_model_display_name` is user-entered rather than picked from a catalog: across captured fixtures it carries the model alone only about half the time, and otherwise jams in the trim or repeats the make (`911 carrera`, `civic ex`, `MAZDA MAZDA3`). Parsing the title beats it, and a model that silently includes the trim would collapse comp matching by making every trim variant its own model. Trim and make are clean; model is not.
- **Exclude dealer listings.** Dealers posting as private sellers pollute the baseline with retail pricing. Detect via multiple active vehicle listings on one profile, business page indicators, and dealer boilerplate.
  - **Correction, 2026-07-28.** None of those three signals was necessary, and the implementation spent months recording dealer exclusion as impossible on the strength of them: a comp card carries no description and no seller listing count, which is true, so the conclusion looked sound. Marketplace states the answer outright in `vehicle_seller_type` (`PRIVATE_SELLER` / `DEALER`) on the listing node. The extractor was not reading it because `FB_KEYS` searched for `vehicle_trim` / `vehicle_make` / `vehicle_model`, while the real keys are the `*_display_name` spellings — so tier 1 of every vehicle cascade was dead code and every stored vehicle fact came from parsing the title string. The lesson is narrower than "check the payload": a derived signal was designed before confirming the direct one was absent.
  - One field named here is genuinely not in the payload: **drivetrain**, which still has no key and remains a regex over trim text until VIN decode lands (§4.2, build step 6).
- **Weight recent listings higher.** A car sitting 60 days at a price is evidence about asking behavior, not market value. Marketplace does not reliably mark sold vehicles, so some comps are ghosts.
- **Minimum comp count.** Calibrate against section 0; roughly 8 as a floor. Below that, fall back progressively (widen radius, then year range) and report low confidence explicitly. Never silently score off 3 comps.
- **Retain the full comp set in the evaluation response.** It is needed for the alternatives feature in section 6.5, which is free once the comps are already loaded.

### 4.4 Longitudinal tracking (build the schema now, use it later)

Every listing the extension encounters is recorded as a **timestamped observation row**, never an update in place. This accumulates into the moat described in section 1: price history per listing, relisting detection, and price-drop behavior per seller.

Retrofitting time-series onto a flat listings table is painful. Build it correctly in step 2 even though the features that consume it are phase three.

**Relisting detection** deserves specific design attention: match on VIN where available, otherwise on a fuzzy key of year/make/model/mileage/location/photo similarity. A vehicle that has been listed three times across four months is a strong signal, and identifying it requires deliberate schema support rather than an afterthought.

### 4.5 Known limitation to state in the product

Marketplace exposes **asking prices, not transaction prices.** Everything this tool produces, including the expected price in section 5.1, is a statement about how similar vehicles are *advertised*, not what they *sell for*. This distinction is load-bearing and belongs in the UI, not the terms of service.

### 4.6 Scraping durability

Facebook is a single-page app with obfuscated, frequently rotated class names. Selector-based scraping will break repeatedly.

- Prefer stable anchors: ARIA roles, semantic structure, text pattern matching, and embedded JSON payloads over generated class names
- Build an extraction self-check that flags null expected fields and reports to the backend, so breakage surfaces via telemetry rather than user complaints
- Ongoing maintenance is a permanent cost of this product

## 5. The pricing model

### 5.1 Expected asking price, not a percentile

**Lead with expected value.** "Based on 37 comparable Marketplace listings, we would expect this vehicle to be advertised around $11,900. It is asking $12,600" is more interpretable than any score, and users reason about expected value naturally.

Implementation:
- Fit price against mileage across the filtered comp set (VIN-matched trim where available)
- Report the **prediction interval, not the point estimate.** People think in ranges, and the interval width honestly communicates comp quality: tight when comps are plentiful and well-matched, wide when they are not
- Compute the target's residual against the fitted line
- Map the residual to a pricing rating using the rise-plateau-decline curve from section 2

**Present four numbers:**

```
Current ask:      $14,900
Expected range:   $13,800 - $14,300
Strong offer:     $13,200
Walk away above:  $14,600
```

**Do not call this a Zestimate equivalent.** Zillow trains on recorded transactions. This trains on asking prices, which is a weaker and different claim (section 4.5). The framing is worth borrowing; the implied authority is not.

KBB is deliberately excluded: no public API, values skewed to a different market segment, and the FB comp set is the better baseline.

### 5.2 Composite deal score

A single 0 to 100 score is still worth producing as a headline, because users want one number and it drives engagement. But it is a **summary of the separated dimensions in section 6, not a replacement for them**, and the UI should always show the breakdown alongside it.

Starting weights, to be calibrated per section 9:
- Price residual: 50
- Information completeness: 10
- Vehicle risk: 25
- Seller and scam risk: 15

Vehicle risk raised from 12 to 20 (pre-rescale), taken from information
completeness, the thinnest of the four signals, to give safety-relevant
findings -- open recalls, complaint density, title branding -- more influence
on the headline number. The four weights were then rescaled from an 80-point
total to a 100-point one, preserving the same ratios, so the UI can show each
one verbatim as a percent next to its dimension.

**Reweighted, 2026-07-29.** Seller and scam risk raised from 10 to 15 and
price residual lowered from 56 to 50, with information completeness up from
9 to 10 and vehicle risk unchanged. Information completeness also dropped
photo count as one of its checks around the same time (section 4.1 lists
photo count as a collected field, but it no longer feeds this dimension):
nearly every listing has at least one photo, so the check was raising every
listing's completeness score by the same fixed amount rather than
distinguishing disclosed listings from sparse ones.

These are hypotheses. Section 9 exists to correct them.

**Time on market is not a weight here.** An earlier version of this section gave
it 20 points, which contradicted section 6.4 below: negotiation strength is
"genuinely orthogonal to deal quality," and folding it into the headline number
meant a fresh, excellent, correctly-priced listing lost up to a fifth of its
score for the sole reason that nobody had a chance to negotiate on it yet. Time
on market is real signal -- it just answers "how much room do I have," not "is
this a good deal," and section 6.4 is where it belongs.

## 6. Separated assessment dimensions

Four independent readings, each surfaced separately in the UI.

### 6.1 Pricing
Expected range, residual, and rating per section 5.1.

### 6.2 Vehicle risk
Distinct from pricing. Sources:
- Open unrepaired safety recalls (VIN required), surfaced prominently regardless of score weight
- Complaint density for the year/make/model relative to segment norms
- Known failure modes for this model at this mileage, from the cached LLM call (section 6.6)
- Title status flags from the description: salvage, rebuilt, branded, "no title," bill of sale only

### 6.3 Seller and scam risk

Two related but separate concerns, both deterministic.

**Seller type** (privacy-minimal, per section 8.2). Two fields only, derived in the extension: a hashed seller identifier and a count of other active vehicle listings. Three or more suggests a flipper or unlicensed dealer. Explicitly not collected: display name, profile URL, join date, account age, profile photo, profile completeness. The more valuable use of this signal is **comp hygiene**, filtering dealers out of the comp set, which matters more to accuracy than the trust penalty on the target listing.

**Scam pattern detection** is its own category and matters disproportionately for a first-time buyer, who is exactly the person this pattern targets. Flag the *combination*, not individual elements:
- Price far below the expected range with no explanation in the description
- Very few photos, or photos that appear to be stock images
- Minimal or templated description
- VIN omitted despite an otherwise detailed listing
- Cash-only or wire-transfer language, refusal to meet in person, shipping offers
- Price revised *upward*, which is unusual for a genuine private seller
- Seller account showing signs of being newly created

Any one of these is weak. Four together is a strong signal and should produce a distinct, prominent warning rather than a numerical deduction buried in a composite.

### 6.4 Negotiation strength

Genuinely orthogonal to deal quality: a slightly overpriced car that has sat 58 days is a weak deal and a strong negotiation. Surface this inside the brief rather than as a third headline number, since three headline metrics is too many for a consumer UI and confidence is a qualifier rather than a peer metric.

Inputs:
- **Days listed.** 30+ at unchanged price indicates a motivated seller and that the ask exceeds what the market will bear. Under 24 hours means competing with everyone else who saw it, so leverage is low regardless of price.
- **Price drop history** (phase three, section 12): the strongest version of this signal.
- **Seller language.** Description phrasing correlates with flexibility. Lift the full keyword set: "firm on price," "no lowballers," "need gone today," "moving," "inherited," "bought a new car," "wife says sell," "OBO," "must sell by [date]." Some signal rigidity, others signal motivation, and they should be scored in opposite directions.
- **Interaction with price.** Model the interaction explicitly rather than scoring price and time independently. A car at market price sitting 45 days is a better opportunity than the price residual alone suggests.

**Revision, 2026-07-29: the offer is a ladder, and it is not anchored only to the expected price.**

Four defects, three of them in the implementation and one in this spec.

*The spec's error.* Section 5.1 derives every actionable figure from the expected asking price, and section 5.2's `should_publish_anchors` correctly refuses to name a dollar figure when the comp interval is too wide to support one. Those two together withheld the suggested offer on roughly 95% of real evaluations (`docs/scoring-audit.md` finding #5), so the negotiation section shipped a leverage word and a day count and nothing to act on — almost always. The resolution is in this section's own opening claim: if negotiation strength is "genuinely orthogonal to deal quality", a figure derived from time on market and seller wording owes the comp set nothing. So the offer now has **two anchoring bases**, and which one is in use is part of the payload rather than left to be inferred:

- `comps` — "comparable listings support about $X". The stronger claim, available when pricing published its anchors.
- `ask` — "sellers in this position usually take about $X off". A weaker and different claim, always available, and it declines to name a walk-away figure because walking away is a statement about value and there is no value estimate underneath it.

*One number is not a negotiation.* "Suggested offer $13,200" does not say whether that is the opening move or the target, and a buyer who opens at their own target settles above it, because a seller who splits the difference splits it upward. Three figures now: **open at / expect to pay / walk away above**. Section 5.1's "strong offer" and "walk away above" stay in the pricing section as market benchmarks; the instruments a buyer acts on live here.

*A credibility floor, which this spec had no concept of.* An offer anchored purely to market price can land 40% under the ask. That does not read as aggressive, it reads as an insult, and it ends the conversation the brief exists to start. Openings are floored at roughly 15% under the ask. **The floor may only raise an opening toward the target — never the target itself.** The first version clamped both, which turned a $20,000 ask against a $13,900 market price into "offer $17,000": a figure a seller accepts on the spot while the buyer overpays by three thousand dollars. An offer that goes unanswered costs nothing; that one cost real money. When the floor sits above the defensible price the stance says so and recommends walking.

*Leverage was earned by default.* The old discount was `MAX_EXTRA_DISCOUNT × strength/100`, and `strength` starts at 30, so a listing posted an hour ago by a seller who wrote "firm, no lowballers" collected 1.8% off for leverage it had done nothing to earn. Discounts now scale by `leverage_fraction`, measured from the base rather than from zero, which is 0 for exactly that listing.

**One caveat, at the bottom.** The first pass at this shipped the hedging three times over, all of it wedged between the figures and the evidence for them: the ask-anchored qualification appeared in the offer's `reasoning` *and* as the panel's own restatement of the same point, and a missing posted date was explained inside `reasoning` *and* again beside the time-on-market graphic. `reasoning` is now actionable sentences only — each one explains a figure — and everything the figures do not claim is a single `caveat` field, rendered once as the last element in the section. Null when there is nothing to qualify: a comp-anchored offer on a listing with a posted date carries no asterisk, and section 4.5's asking-versus-sale-price point is already a standing notice on the whole evaluation.

**Also removed from the UI: the 0-100 strength meter.** `strength` starts at `BASE_STRENGTH` and tops out near 83, so "Negotiating room 62/100" was neither a percentage nor a measurement, while being the most authoritative-looking element in the section. Days listed is the underlying fact and it is observed rather than derived; drawn on an axis with the 14/30/75-day thresholds marked, it answers the same question honestly. `strength` stays on the wire for section 9's calibration pass.

### 6.5 Alternatives nearby

**The highest-value addition to this spec, and nearly free.** The comp set is already loaded in memory at evaluation time.

> There are four comparable Camrys within 40 miles priced below expected value. [links]

This reframes the product from "judge this listing" to "help me buy a car," which is a better product and a stronger reason to keep the extension installed. It also gracefully handles the common case where the answer is "this one is fine, but that one is better."

Show alternatives when the target scores average or worse and better-priced comps exist within a reasonable radius. Suppress when the target is already the best available, and say so, since that is also useful.

**Renamed and trim-restricted, 2026-07-30.** "Better alternatives" is now
"Alternatives" throughout the UI; the word "better" was carrying weight the
list did not actually enforce (see below). Two substantive changes went with
the rename:

1. **The list is now same-trim only.** A cheaper EX-L shown beside an Si
   target is not an alternative to it, it is a different car -- exactly the
   naive price-only comparison this section exists to avoid making. The
   residual comparison against the fitted line (unchanged) now only runs
   across comps `pricing/comps.py`'s `grade_trim` calls the same trim as the
   target. It also now admits comps that are *equalish*, not only ones
   meaningfully better, since a same-trim pool is often thin and a practical
   tie was previously indistinguishable from "no alternatives at all."

2. **A second, separate list for comps that are a different trim and
   meaningfully cheaper.** Deliberately not called "lower trim": there is no
   table anywhere in this system that ranks trim names against each other
   (is a Sport "lower" than an Si? that is a real question with no answer in
   the data this product has), so a "lower trim" label would assert an
   ordering nothing here can verify. It is titled **Different trim** and
   rendered as its own dropdown inside the Alternatives section instead.

### 6.7 The opening message, drafted

**Added 2026-07-29. Not in the original spec, and the same argument as 6.5: nearly free, because every fact in it is already computed.**

Section 7.5 stops at "suggested offer with reasoning", which leaves section 1's target user — the first-time private-party buyer — holding a number and no idea what to say. The expertise gap 6.6 identifies for mechanical faults exists just as sharply here: an experienced buyer knows the comparable prices go *before* the figure, and that is the difference between a negotiation and a lowball. A number nobody sends is worth nothing.

**Deterministic templating, not an LLM call.** Section 11 rejects "read this listing like an expert buyer" because a model's version produces "unfalsifiable output that cannot be debugged or validated against section 9". A drafted message fails the same test if a model writes it. Templated from figures the brief already stands behind, every clause traces to a fact, it is testable, and section 10's per-evaluation cost does not move.

Two rules:

1. **No claim the brief has not already made.** The draft may restate the offer, the expected range and the days listed. It may not characterise the vehicle or mention a fault — the buyer has not inspected it, and a message misrepresenting what they know can be quoted back at them.
2. **It never discloses leverage pointing the other way.** On a listing already asking below what the comps support, "similar ones are asking $16,700 and your $12,450 looks fair" is a true sentence that hands the seller the argument for raising their price, in a message this tool wrote *for the buyer*. The range is suppressed in that case.

Rendered as an editable field, not prose: a message the buyer cannot edit before sending is one they will not send.

### 6.6 Ownership cost context

Price is not value. A cheap BMW is not a cheap car.

Use the cached LLM call for **qualitative** known issues: what fails on this model at this mileage, what to inspect, what to ask about. This fills the real expertise gap for a first-time buyer who does not know a given model-year has a dual-clutch transmission problem.

**Do not attach dollar estimates.** An LLM asked for "expected maintenance $2,800 to $4,600" will produce a confident fabricated number. Real repair cost data requires licensing RepairPal or equivalent. Note where insurance or maintenance costs diverge sharply from segment norms in qualitative terms only. Revisit dollar figures if and when a licensed data source is in place.

## 7. Output structure

1. **Headline:** deal score, confidence, and the expected price comparison
2. **Pricing:** the four-number range from section 5.1
3. **Vehicle risk:** known issues, recalls, title flags
4. **Seller and scam risk:** only when there is something to say
5. **Negotiation:** leverage, days listed, the three-figure offer with reasoning, and the drafted message (sections 6.4, 6.7)
6. **Alternatives:** per section 6.5
7. **What to check on this specific car:** the qualitative expertise gap

Example:

> **74 / 100, medium confidence.** Comparable listings suggest an expected range of $8,700 to $9,100. This asks $9,400.
>
> **Negotiation: strong.** Listed 38 days with one price drop. Description says "moving, need gone." Suggested offer $8,300.
>
> **Check on this car:** 2013 Focus models of this generation had widespread dual-clutch transmission failures. Ask for service records and watch for shuddering at low speed.
>
> **Two better-priced options within 40 miles.** [links]
>
> VIN not provided, so trim matching is approximate.

**Liability framing:** informational analysis of a listing, not a purchase recommendation, and never a substitute for a pre-purchase inspection or vehicle history report. In the UI, not just the terms.

## 8. Privacy and legal

### 8.1 Chrome Web Store is the biggest distribution risk

An extension whose stated purpose involves scraping Meta properties can be rejected at review or removed after publication. Removal ends distribution regardless of product quality.

**Decision: target the Chrome Web Store and design around its constraints.** Direct install is not viable for a consumer tool; Chrome requires developer mode for unpacked extensions and repeatedly prompts users to disable them.

**Binding constraints:**

1. **All collection is user-initiated.** No background crawling, polling, monitoring while idle, or scheduled jobs. Comp search fires only on an explicit click on a listing the user already opened. An extension that acts only when asked behaves as a user agent; one that crawls continuously behaves as a scraper. **Resist adding a "monitor this search" feature later. It would undo the entire rationale for store distribution.**
2. **Narrowly scoped permissions.** Host permissions limited to Marketplace paths. No `<all_urls>`, no tabs permission without functional justification. Over-requesting is a common rejection trigger independent of the scraping question.
3. **Data handling proportionate to stated purpose,** per 6.3 and 8.2.
4. **Distribution fallback built in.** The backend is independent of the extension, so a paste-a-URL web client can replace it if the extension is pulled. Keep that boundary clean. Firefox is secondary.

Read current Chrome Web Store developer program policies before writing the manifest, not after.

### 8.2 Third-party personal data

Seller names, profiles, and photographs belong to people who never agreed to this. **Decision: minimize to near nil.** Only a hashed identifier and an integer count leave the browser.

- Never store or transmit display names, profile URLs, photos, or join dates. Hash client-side.
- Derive seller signals in the extension; transmit derived values only.
- Set a retention window and enforce it programmatically.
- Note the tension with section 4.4: longitudinal seller behavior requires a stable hashed identifier over time, which is fine, but resist the pull toward storing more identity to make that easier.

### 8.3 Facebook Terms of Service

Automated collection violates Meta's terms regardless of whose session performs it. The extension approach avoids centralized scraping infrastructure and its CFAA exposure profile, but does not make the activity compliant, and it places account-suspension risk on the user. Disclose plainly before install. A user discovering their Marketplace account was restricted because of your tool is a trust failure that ends the product.

## 9. Validation: how you know any of this means anything

Without this, an uncalibrated formula produces a confident-looking number with no evidence behind it.

1. **Manual ground truth set.** Evaluate 50 to 100 listings by hand as an experienced buyer would (good deal / fair / overpriced / avoid). Score with the engine and measure agreement. Disagreements locate the wrong weights.
2. **Component ablation.** Run with each dimension disabled. If removing seller signals changes almost nothing, the weight is too high or the signal is not real.
3. **Track listing outcomes.** Recheck scored listings at 7, 14, and 30 days. Fast disappearance at asking price indicates attractive pricing; sitting and dropping indicates the opposite. Imperfect but free, and it uses the same infrastructure as section 4.4.
4. **Calibrate the discount curve.** The plateau and decline thresholds in section 2 are guesses until the ground truth set locates them.
5. **Validate the prediction interval.** Check that roughly the stated proportion of held-out listings fall inside it. An interval that is systematically too narrow is worse than no interval, because it manufactures false confidence.

Until step 1 is done, present output as a beta signal, not an authoritative rating.

## 10. Cost control

Without vision, per-evaluation cost is dominated by one small text call. Keep it that way.

- **Cache known-issues text by year/make/model/trim/mileage-band,** not per listing. Every 2013 Focus at 90k miles gets the same answer, so most calls collapse into cache hits almost immediately.
- **Cache VIN decodes indefinitely,** recall lookups for 30 days.
- **Gate the LLM call behind deterministic checks.** If pricing is disqualifying or the description contains a hard disqualifier (salvage, "for parts"), return the verdict without a model call.
- **Cache evaluations by listing ID.** Two users evaluating the same listing trigger one set of external calls.
- **Instrument cost per evaluation from day one.** This number determines whether the product can be free, freemium, or paid.

## 11. Deliberately deferred

### Vision / photo analysis
**Cut from the MVP.** Most expensive and most fragile component, and it does less work than time-on-market, which is free. Facebook photos are compressed and uncontrolled, which makes the most impressive-sounding claims (repainted panels, tire tread) unreliable in practice.

Revisit only after the deterministic model is validated. If revisited, scope to what is actually detectable (obvious body damage, heavy rust, general interior condition, stock-photo detection, presence of an odometer shot), cap at 5 to 8 photos, downscale aggressively, cache by listing ID, and gate behind deterministic checks. Photo **count** is available as metadata today with no model call and captures a meaningful share of the signal.

### Holistic "read this listing like an expert buyer"
An appealing idea that quietly reverses the vision decision, since half of what it would notice requires photo analysis. The deeper problem: an LLM asked to find inconsistencies in a listing will find them whether or not they exist, producing unfalsifiable output that cannot be debugged or validated against section 9. Deferred until there is a way to measure whether it is right.

### Repair cost dollar estimates
Requires a licensed data source (RepairPal or equivalent). Qualitative version ships in the MVP per section 6.6.

### Background monitoring and alerts
Conflicts directly with 8.1. Serving the flipper segment needs a different architecture and risk posture. Not a v2 feature; a different product.

### KBB integration
No public API, wrong market segment, and the FB comp set is the better baseline.

## 12. Phase three: features that require accumulated history

**These are the moat (section 1), and none of them work on day one.** They all need months of collected observations. Sequencing them explicitly prevents a build plan that stalls waiting for data.

Gate each on a data-volume threshold rather than a date, and ship each when its threshold is met:

- **Price drop prediction.** Directional only ("sellers of similar vehicles typically reduce price around day 12"). **Do not present a specific probability** such as "68% chance of a drop within 7 days" until there is validated held-out accuracy behind it. A precise percentage implies a calibration that does not exist, which is exactly what section 9 exists to prevent.
- **Likelihood of selling soon.** Requires observed disappearance rates for comparable vehicles. Useful for telling a buyer whether to negotiate patiently or drive over immediately.
- **Market heat.** Supply, median days listed, average price reduction, by model and region.
- **Seller behavior profiles.** Typical days to first price cut, average reduction size, relisting frequency.
- **Relisting history.** "This vehicle was listed in May at $15,000, withdrawn, and relisted today at $13,700." Possibly the single most compelling output the product can eventually produce, and completely impossible to fake or back-fill.

## 13. Build order

1. **Step zero (section 0).** Manual comp density test. No code.
2. **Extraction only.** Extension scrapes a listing plus comp search; backend validates and persists as timestamped observations. No scoring. Success criterion: reliable extraction across 30+ varied listings including edge cases (missing mileage, empty description, single photo, no price).
3. **Expected price model.** Mileage-adjusted regression, prediction interval, comp filtering, minimum-comp fallback. Success criterion: agreement with manual assessment on the ground truth set.
4. **Time on market and negotiation strength.** Cheap, high-value, differentiating.
5. **Flags and completeness.** Description patterns, seller language keywords, photo count, title status, scam pattern detection.
6. **VIN decode and recalls.** NHTSA integration; feed decoded trim back into comp matching.
7. **Alternatives** (section 6.5). Nearly free once comps are retained.
8. **Composite score, separated dimensions, overlay UI, negotiation brief.**
9. **Calibration pass** (section 9), then adjust weights.

## 14. Decisions made

- **Premise validated first** via manual comp density test before any code
- **Target user: first-time private-party buyer,** not flippers
- **Lead with expected asking price and a range,** not a percentile; composite score is a summary, not a replacement
- **Pricing, vehicle risk, seller/scam risk, and negotiation are separated,** never collapsed into one number
- **Distribution: Chrome Web Store,** with user-initiated collection as a binding constraint
- **Seller data: privacy-minimal,** hashed identifier plus listing count only
- **Comps: FB private-party listings,** not dealer sites; KBB excluded
- **Vision: cut from MVP,** deferred indefinitely
- **VIN: included,** primarily for comp accuracy via free NHTSA decode
- **LLM usage: one cached text call,** qualitative output only, no fabricated dollar figures
- **History-dependent features sequenced to phase three,** gated on data volume

## 15. Still open

- Free, freemium, or paid? Cannot be answered until cost per evaluation is measured (section 10).
- Where the discount curve plateaus and declines (section 2). Empirical, answered by section 9.
- Data-volume thresholds that gate each phase-three feature (section 12).
- Whether relisting detection can work reliably without VINs, given how few listings include one.
