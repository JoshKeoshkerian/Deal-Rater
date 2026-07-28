/**
 * Extraction self-check (spec 4.6): breakage should surface in telemetry, not
 * as user complaints.
 *
 * Two things are recorded per capture:
 *
 *   field_strategies   which tier produced each field. This is the early
 *                      warning. A field degrading from `json_payload` to
 *                      `text_pattern` means Facebook has already changed
 *                      something, while the field is still populated and
 *                      nothing looks wrong yet.
 *
 *   issues             fields that no tier could produce.
 *
 * Expectation levels exist because a null is not always a fault. A listing with
 * no price is real — the step-2 success criterion names it explicitly — and
 * flagging it as breakage would drown the signal. So:
 *
 *   required   absence means the scraper is broken. Nothing else explains it.
 *              Only the identifiers qualify. These flip `extraction_ok`.
 *   expected   usually present, legitimately absent sometimes. Reported so the
 *              *rate* can be watched; a single one is noise, 40% is breakage.
 *   optional   absence is normal. Recorded, never alarming.
 */

import type { Expectation, ExtractionIssue, Scope, StrategyName } from "../shared/types";

export const TARGET_FIELD_EXPECTATIONS: Record<string, Expectation> = {
  // Without these the observation cannot be attributed to a listing at all.
  source_listing_id: "required",
  listing_url: "required",
  // A structural probe rather than a field: reported when no tier could find
  // any listing data on what is definitely a listing page.
  listing_payload: "required",

  price_cents: "expected",
  year: "expected",
  make: "expected",
  model: "expected",
  mileage: "expected",
  location_text: "expected",
  photo_count: "expected",
  posted_at: "expected",
  seller_hash: "expected",

  description: "optional",
  trim_text: "optional",
  // Follows `trim_text`: a listing that states no trim has no trim source
  // either, and that is normal rather than breakage.
  trim_source: "optional",
  title_status: "optional",
  vin: "optional",
  price_changed: "optional",
  seller_listing_count: "optional",
  latitude: "optional",
  currency: "optional",
  // `expected`, not `optional`: Facebook states this on the listing node for
  // essentially every vehicle (13 of 16 captured fixtures, and the three
  // without it carried no vehicle payload at all). If its fill rate falls, the
  // dealer exclusion in spec 4.3 has quietly stopped working, which is exactly
  // the case an `expected` field exists to make visible.
  seller_type: "expected",
  transmission: "optional",
};

/** A search card shows far less than a listing page, so most fields drop a level. */
export const COMP_FIELD_EXPECTATIONS: Record<string, Expectation> = {
  source_listing_id: "required",
  listing_url: "required",

  price_cents: "expected",
  year: "expected",
  make: "expected",
  model: "expected",

  mileage: "optional",
  location_text: "optional",
  photo_count: "optional",
  posted_at: "optional",
  seller_hash: "optional",
  description: "optional",
  trim_text: "optional",
  trim_source: "optional",
  title_status: "optional",
  vin: "optional",
  // Optional on a card, unlike on a target: a search result carries only the
  // fields Marketplace renders into the feed, and `docs/schema.md` sets comp
  // expectations per-scope for exactly this reason.
  seller_type: "optional",
  transmission: "optional",
};

export type Attempt<T> = readonly [StrategyName, () => T | null | undefined];

/**
 * Runs a field's strategy cascade and records what happened.
 *
 * One recorder per observation. The cascade stops at the first tier that
 * produces a value, and the tier that won is what gets recorded.
 */
export class ExtractionRecorder {
  readonly strategies: Record<string, StrategyName> = {};
  readonly issues: ExtractionIssue[] = [];

  private readonly scope: Scope;
  private readonly expectations: Record<string, Expectation>;
  private readonly pageSignature: string | null;

  constructor(
    scope: Scope,
    expectations: Record<string, Expectation>,
    pageSignature: string | null,
  ) {
    this.scope = scope;
    this.expectations = expectations;
    this.pageSignature = pageSignature;
  }

  /**
   * Resolve one field.
   *
   * A strategy that throws is treated as a miss rather than being allowed to
   * abort the capture: the whole point of a cascade is that a broken tier falls
   * through to the next one.
   */
  resolve<T>(field: string, attempts: Array<Attempt<T>>): T | null {
    const attempted: StrategyName[] = [];

    for (const [strategy, run] of attempts) {
      attempted.push(strategy);
      let value: T | null | undefined;
      try {
        value = run();
      } catch {
        continue;
      }
      if (value !== null && value !== undefined) {
        this.strategies[field] = strategy;
        return value;
      }
    }

    this.report(field, "missing", attempted);
    return null;
  }

  /** Record a field that was found but could not be parsed into a usable value. */
  reportUnparsed(field: string, attempted: StrategyName[] = []): void {
    this.report(field, "unparsed", attempted);
  }

  /** Record a value that parsed but looks wrong — a price of $1 on a truck. */
  reportSuspect(field: string, attempted: StrategyName[] = []): void {
    this.report(field, "suspect", attempted);
  }

  private report(
    field: string,
    status: ExtractionIssue["status"],
    attempted: StrategyName[],
  ): void {
    const expectation = this.expectations[field];
    // A field with no declared expectation is not tracked. Registering it in
    // the table above is what opts it into telemetry.
    if (expectation === undefined) return;

    this.issues.push({
      scope: this.scope,
      field_name: field,
      status,
      expectation,
      strategies_attempted: attempted,
      page_signature: this.pageSignature,
    });
  }
}

/**
 * Roll several recorders into one report.
 *
 * Comp cards are collapsed rather than reported individually: forty cards each
 * missing a mileage produce forty identical rows that say one thing. The count
 * that matters is the fill rate, which the backend computes from the
 * observations themselves.
 */
export function collapseIssues(issues: ExtractionIssue[]): ExtractionIssue[] {
  const seen = new Map<string, ExtractionIssue>();
  for (const issue of issues) {
    const key = `${issue.scope}|${issue.field_name}|${issue.status}`;
    if (!seen.has(key)) seen.set(key, issue);
  }
  return Array.from(seen.values());
}
