/**
 * Price (spec 4.1).
 *
 * Note what is *not* here: an absent price is returned as null and reported at
 * `expected`, not `required`. Listings with no price are real and are named in
 * the step-2 success criterion; treating them as scraper breakage would make
 * the health signal useless.
 */

import { amountToCents, parsePrice } from "../../shared/parse";
import type { StrategyName } from "../../shared/types";
import { FB_KEYS } from "../fb-keys";
import type { ExtractionRecorder } from "../self-check";
import { matchDeepest, PRICE_DROP_RE, PRICE_RE } from "../strategies/text-patterns";
import type { JsonObject } from "../strategies/json-payload";
import { pick, pickNumber, pickObject, pickString } from "../strategies/json-payload";

export interface ResolvedPrice {
  cents: number | null;
  currency: string | null;
  /** The displayed text, kept for re-derivation if this parser is later fixed. */
  text: string | null;
}

function fromPayload(node: JsonObject | null): number | null {
  const price = pickObject(node, FB_KEYS.price);
  if (!price) return null;

  const amount = pick(price, FB_KEYS.priceAmount);
  if (amount !== undefined) {
    const cents = amountToCents(amount);
    if (cents !== null) return cents;
  }

  // `amount_with_offset` is already in minor units.
  const offset = pickNumber(price, FB_KEYS.priceAmountOffset);
  if (offset !== null) return Math.round(offset);

  const text = pickString(price, FB_KEYS.priceText);
  return text ? (parsePrice(text)?.cents ?? null) : null;
}

export function resolvePrice(
  recorder: ExtractionRecorder,
  node: JsonObject | null,
  block: Element | null,
): ResolvedPrice {
  let displayed: string | null = null;

  const cents = recorder.resolve<number>("price_cents", [
    ["json_payload", () => fromPayload(node)],
    [
      "text_pattern",
      () => {
        if (!block) return null;
        displayed = matchDeepest(block, PRICE_RE);
        return displayed ? (parsePrice(displayed)?.cents ?? null) : null;
      },
    ],
  ]);

  const currency = recorder.resolve<string>("currency", [
    [
      "json_payload",
      () => pickString(pickObject(node, FB_KEYS.price), FB_KEYS.priceCurrency),
    ],
    ["text_pattern", () => (displayed ? (parsePrice(displayed)?.currency ?? null) : null)],
  ]);

  return { cents, currency, text: displayed };
}

/**
 * Whether the price has been changed since posting.
 *
 * Returns `true` or `null`, never `false`: Facebook renders a "price dropped"
 * marker when there has been a change and renders nothing at all when there has
 * not, so absence is genuinely ambiguous. Recording that as `false` would
 * manufacture a fact the page never stated, and step 4's negotiation signal
 * would be built on it.
 */
export function resolvePriceChanged(
  recorder: ExtractionRecorder,
  block: Element | null,
): boolean | null {
  const attempts: Array<readonly [StrategyName, () => boolean | null]> = [
    [
      "aria_dom",
      () => {
        if (!block) return null;
        // A struck-through previous price is the other rendering of a drop.
        return block.querySelector("s, del, [style*='line-through']") ? true : null;
      },
    ],
    [
      "text_pattern",
      () => {
        if (!block) return null;
        return PRICE_DROP_RE.test(block.textContent ?? "") ? true : null;
      },
    ],
  ];

  return recorder.resolve<boolean>("price_changed", attempts);
}
