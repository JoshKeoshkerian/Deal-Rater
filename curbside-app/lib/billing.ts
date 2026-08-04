/**
 * PLACEHOLDER BILLING STATE. NONE OF THIS IS REAL.
 *
 * Every figure in this file is written by hand so the account page can be
 * looked at. There is no billing anywhere in the backend — no processor, no
 * balance column, no subscription table, no webhook — and nothing here reads a
 * server or a browser store. A balance shown on /account is a drawing of a
 * balance.
 *
 * That is why `BILLING_IS_PREVIEW` exists and why /account renders a banner
 * from it: a fake balance that looks real is worse than no balance at all,
 * because it is indistinguishable from the working version and stops anyone
 * noticing the feature was never built.
 *
 * WHEN BILLING IS REAL, this file is deleted. The page moves to fetching the
 * same shape from the API; the three states below become the fixtures its tests
 * use. Keeping the shape honest now is the only part of this that has to
 * survive.
 */

import { FREE_EVALUATIONS, type PlanId } from "./plans";

export const BILLING_IS_PREVIEW = true;

export interface Purchase {
  id: string;
  /** ISO date. Rendered with `checkedOn` so it matches the saved cards. */
  at: string;
  description: string;
  amountCents: number;
  /** What a receipt link would point at. `null` while this is a mockup. */
  receiptUrl: string | null;
}

export interface BillingState {
  /** `null` means the free allowance, which is not a plan anyone bought. */
  plan: PlanId | null;
  /** Checks left. `null` when the active plan is uncapped. */
  evaluationsRemaining: number | null;
  /** How many of those came free, for the "x of your 10 free" line. */
  freeEvaluationsRemaining: number;
  /** ISO date the subscription next bills, or `null` if there isn't one. */
  renewsAt: string | null;
  /** Set when a subscription is cancelled but still paid up. */
  endsAt: string | null;
  purchases: Purchase[];
}

/** Somebody who installed the extension and has not paid for anything. */
export const PREVIEW_FREE: BillingState = {
  plan: null,
  evaluationsRemaining: 6,
  freeEvaluationsRemaining: 6,
  renewsAt: null,
  endsAt: null,
  purchases: [],
};

/** Somebody who used up the free checks and bought a pack. */
export const PREVIEW_PACK: BillingState = {
  plan: "pack-20",
  evaluationsRemaining: 14,
  freeEvaluationsRemaining: 0,
  renewsAt: null,
  endsAt: null,
  purchases: [
    {
      id: "pv-2",
      at: "2026-07-28T16:41:00Z",
      description: "20 checks",
      amountCents: 1199,
      receiptUrl: null,
    },
    {
      id: "pv-1",
      at: "2026-07-11T09:05:00Z",
      description: "10 checks",
      amountCents: 799,
      receiptUrl: null,
    },
  ],
};

/** Somebody mid-search on the monthly plan. */
export const PREVIEW_UNLIMITED: BillingState = {
  plan: "unlimited-monthly",
  evaluationsRemaining: null,
  freeEvaluationsRemaining: 0,
  renewsAt: "2026-08-24T00:00:00Z",
  endsAt: null,
  purchases: [
    {
      id: "pv-4",
      at: "2026-07-24T12:02:00Z",
      description: "Unlimited — monthly",
      amountCents: 1699,
      receiptUrl: null,
    },
    {
      id: "pv-3",
      at: "2026-06-24T12:02:00Z",
      description: "Unlimited — monthly",
      amountCents: 1699,
      receiptUrl: null,
    },
  ],
};

export const PREVIEW_STATES = [
  { id: "free", label: `Free (${PREVIEW_FREE.evaluationsRemaining} of ${FREE_EVALUATIONS} left)`, state: PREVIEW_FREE },
  { id: "pack", label: "Bought a pack", state: PREVIEW_PACK },
  { id: "unlimited", label: "Unlimited subscriber", state: PREVIEW_UNLIMITED },
] as const;

export type PreviewStateId = (typeof PREVIEW_STATES)[number]["id"];

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
