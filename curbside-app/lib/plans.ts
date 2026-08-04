/**
 * What Curbside charges. ONE DEFINITION, read by the landing page's pricing
 * strip, the /pricing table and the /account page.
 *
 * NOTHING HERE TALKS TO A PAYMENT PROCESSOR, and nothing here is a source of
 * truth the server agrees with. There is no billing code in the backend at all
 * — no Stripe, no products, no balance column, no webhook. This file exists so
 * the payments UI can be looked at and argued about before any of that is
 * built. When a processor is chosen, each plan below gains its price id and
 * `lib/billing.ts` gets deleted rather than adapted.
 *
 * Prices in CENTS, integers. A float dollar amount is a rounding bug waiting
 * for a discount code, and the API this eventually talks to will want cents.
 */

/** Free evaluations granted on install, before anything is charged. */
export const FREE_EVALUATIONS = 10;

export type PlanId = "pack-10" | "pack-20" | "unlimited-monthly";

export interface Plan {
  id: PlanId;
  name: string;
  /** One line, used on the landing page's strip where there is no room for more. */
  summary: string;
  priceCents: number;
  /** `null` for a one-time pack; `"month"` for the subscription. */
  interval: "month" | null;
  /** Evaluations bought. `null` means uncapped, which only the subscription is. */
  evaluations: number | null;
  /** The one plan the pricing table emphasises. Exactly one, or none. */
  featured: boolean;
  points: string[];
}

export const PLANS: Plan[] = [
  {
    id: "pack-10",
    name: "10 checks",
    summary: "One car-shopping weekend.",
    priceCents: 799,
    interval: null,
    evaluations: 10,
    featured: false,
    points: [
      "10 evaluations, used whenever you like",
      "They do not expire",
      "Saved evaluations included",
      "One-time payment, nothing recurring",
    ],
  },
  {
    id: "pack-20",
    name: "20 checks",
    summary: "Better per-check price.",
    priceCents: 1199,
    interval: null,
    evaluations: 20,
    featured: true,
    points: [
      "20 evaluations, used whenever you like",
      "They do not expire",
      "Saved evaluations included",
      "One-time payment, nothing recurring",
    ],
  },
  {
    id: "unlimited-monthly",
    name: "Unlimited",
    summary: "For the month you're actually shopping.",
    priceCents: 1699,
    interval: "month",
    evaluations: null,
    featured: false,
    points: [
      "Unlimited evaluations while it is active",
      "Saved evaluations included",
      "Cancel any time, from this site",
      "Runs out at the end of the period you paid for",
    ],
  },
];

export function planById(id: PlanId): Plan | undefined {
  return PLANS.find((plan) => plan.id === id);
}

/** `$7.99`, and `$8` for a whole-dollar amount rather than `$8.00`. */
export function formatPrice(cents: number): string {
  const dollars = cents / 100;
  return dollars % 1 === 0 ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

/**
 * Per-check price, for the packs only.
 *
 * Deliberately NOT computed for the subscription: "unlimited" has no honest
 * per-unit price, and inventing one by assuming a usage number would be the
 * same kind of confident fabrication the spec refuses everywhere else.
 */
export function perCheckPrice(plan: Plan): string | null {
  if (plan.evaluations === null || plan.evaluations === 0) return null;
  const cents = plan.priceCents / plan.evaluations;
  return `$${(cents / 100).toFixed(2)}`;
}
