/**
 * The real billing contract, read from `GET /v1/billing/me`
 * (`backend/app/api/billing.py`, `BillingMeOut`).
 *
 * THIS FILE USED TO BE A FIXTURE. Every field below now names exactly what
 * the backend returns -- snake_case, matching every other response on this
 * API (`User`, `SavedEvaluation`) -- rather than the camelCase shape a
 * hand-written mockup used before there was a server to match. `lib/api.ts`
 * holds the fetch functions; this file keeps the types and the one date
 * formatter `/account` needs.
 */

import type { PlanId } from "./plans";

export interface Purchase {
  id: number;
  /** ISO date. Rendered with `checkedOn` so it matches the saved cards. */
  at: string;
  description: string;
  amount_cents: number;
}

export interface BillingState {
  /** `null` means the free allowance, which is not a plan anyone bought. */
  plan: PlanId | null;
  /** Checks left. `null` when the active plan is uncapped. */
  evaluations_remaining: number | null;
  /** How many of those came free. Zero once anything has ever been bought --
   * see `BillingMeOut`'s docstring on the backend for why the two pools stop
   * being a meaningful distinction at that point. */
  free_evaluations_remaining: number;
  /** ISO date the subscription next bills, or `null` if there isn't one. */
  renews_at: string | null;
  /** Set when a subscription is cancelled but still paid up. */
  ends_at: string | null;
  purchases: Purchase[];
}

/**
 * A date a person reads.
 *
 * FORMATTED IN UTC, unlike `checkedOn` in `lib/format.ts`. A renewal date is a
 * calendar date, not a moment: rendering midnight UTC in the viewer's local
 * zone moves it to the day before for anyone west of Greenwich, which is how
 * "renews on the 24th" became "renews August 23" the first time this rendered.
 */
export function billingDate(iso: string, style: "long" | "short" = "long"): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "an unknown date";
  return date.toLocaleDateString("en-US", {
    month: style === "long" ? "long" : "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
