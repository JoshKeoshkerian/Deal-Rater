/**
 * Seller signals (spec 4.1, 6.3, 8.2).
 *
 * This is the only module that touches a seller's real identifier, and it is
 * the boundary that identifier does not cross. The raw id is read, hashed, and
 * discarded inside `resolveSeller`. Nothing else in the extension can reach it,
 * and there is no field on the wire contract it could travel in.
 *
 * Deliberately not read, not derived, not transmitted: display name, profile
 * URL, profile photo, join date, account age, profile completeness. The profile
 * href is consulted only to recover the numeric id when the payload does not
 * carry it, and the href itself is never retained.
 *
 * The star rating (`findSellerRating`/`findReviewCount`) is a deliberate
 * exception to "nothing else about the seller is read": it is a reputation
 * NUMBER Marketplace already renders on the listing page itself, not
 * identity, and needs no profile visit. See `SellerPayload`'s docstring.
 */

import { collapseWhitespace } from "../../shared/parse";
import { HASH_VERSION, hashSellerId } from "../../seller/hash";
import type { SellerPayload } from "../../shared/types";
import { FB_KEYS } from "../fb-keys";
import type { ExtractionRecorder } from "../self-check";
import { linkedListingIds } from "../strategies/aria-dom";
import type { JsonObject } from "../strategies/json-payload";
import { pickNumber, pickObject, pickString } from "../strategies/json-payload";
import { sellerListingsBlock } from "./dom-blocks";

const PROFILE_HREF_RE = /\/marketplace\/profile\/(\d+)|profile\.php\?id=(\d+)/;

/** Read the raw identifier. Not exported: it must not leave this module. */
function findSellerId(node: JsonObject | null, main: Element | null): string | null {
  const seller = pickObject(node, FB_KEYS.seller);
  const fromPayload = pickString(seller, FB_KEYS.sellerId);
  if (fromPayload && /^\d+$/.test(fromPayload)) return fromPayload;

  if (!main) return null;
  for (const link of Array.from(main.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
    const match = link.getAttribute("href")?.match(PROFILE_HREF_RE);
    const id = match?.[1] ?? match?.[2];
    if (id) return id;
  }
  return null;
}

/**
 * Count the seller's active vehicle listings.
 *
 * Defined as the total *including* the listing being viewed, matching the field
 * name in spec 4.1. The DOM path counts the "seller's other listings" section
 * and adds one, so the flipper threshold in 6.3 ("three or more") should be
 * read against that definition and not be off by one.
 *
 * The result is a floor, not an exact count: that section is paginated and only
 * shows what has loaded. A floor is the right shape for a `>=` threshold, but
 * it means the value must never be treated as exact.
 */
function findListingCount(
  node: JsonObject | null,
  main: Element | null,
  targetListingId: string | null,
): number | null {
  const seller = pickObject(node, FB_KEYS.seller);
  const stated = pickNumber(seller, FB_KEYS.sellerListingCount);
  if (stated !== null && stated >= 0) return Math.round(stated);

  if (!main) return null;
  const block = sellerListingsBlock(main);
  if (!block) return null;

  const others = linkedListingIds(block).filter((id) => id !== targetListingId);
  return others.length + 1;
}

// Marketplace renders the star widget as a `role="img"` element carrying the
// PRECISE average in its own aria-label ("2.4 out of 5 stars, From one
// review'") -- a stable, semantic anchor per spec 4.6, unlike the generated
// class names around it. The visible stars round this to the nearest half
// star for display (2.4 draws as "2.5 stars"), so the aria-label is the
// number to read, not anything derived from counting filled star icons.
const RATING_ARIA_RE = /(\d+(?:\.\d+)?)\s*out of\s*5\s*stars?/i;

// The review-COUNT half of that same aria-label is not trustworthy: captured
// verbatim from a real listing, it read "From one review'" (stray trailing
// apostrophe and all) on a seller with 7 reviews -- a static/buggy string on
// Facebook's side, not a live count. The real count sits in a plain sibling
// span reading "(7)". A bare parenthesised integer is a distinctive enough
// shape elsewhere on a listing page (photo counts read "N of M", not "(N)")
// that this is safe to match without narrower scoping.
const REVIEW_COUNT_RE = /^\(\s*(\d+)\s*\)$/;

// How far up from the star widget to look for the review-count span. Mirrors
// `listingHeaderBlock`'s walk-up-with-a-structural-test approach rather than a
// fixed selector, so a wrapper div FB adds or removes does not break this --
// what matters is that the count sits somewhere in an ANCESTOR's subtree, not
// at a specific depth.
const MAX_RATING_ANCESTOR_HOPS = 8;

/** The seller's star-rating widget, wherever it sits on the page. */
function findRatingWidget(main: Element): Element | null {
  return main.querySelector('[role="img"][aria-label*="out of 5 star"]');
}

function findReviewCount(widget: Element): number | null {
  let ancestor: Element | null = widget.parentElement;
  for (let hops = 0; hops < MAX_RATING_ANCESTOR_HOPS && ancestor; hops += 1) {
    for (const node of Array.from(ancestor.querySelectorAll<HTMLElement>("span"))) {
      const text = collapseWhitespace(node.textContent ?? "");
      const match = text.match(REVIEW_COUNT_RE);
      if (match) return Number(match[1]);
    }
    ancestor = ancestor.parentElement;
  }
  return null;
}

/**
 * The seller's star rating, read straight off the listing page.
 *
 * Returns null rather than a fabricated 0 when the widget is absent, which is
 * the common case for a seller with no reviews yet -- "no rating exists" and
 * "rating is zero" are different facts and must not collapse into one. Also
 * null (not a partial result) rather than the average whenever the widget
 * itself is missing, so `ExtractionRecorder.resolve` records this field as
 * unresolved rather than as a hit that happened to carry nulls.
 */
function findSellerRating(
  main: Element | null,
): { average: number; count: number | null } | null {
  if (!main) return null;

  const widget = findRatingWidget(main);
  if (!widget) return null;

  const label = widget.getAttribute("aria-label") ?? "";
  const match = label.match(RATING_ARIA_RE);
  const average = match ? Number(match[1]) : null;
  if (average === null || !Number.isFinite(average) || average < 0 || average > 5) {
    return null;
  }

  return { average, count: findReviewCount(widget) };
}

/**
 * Produce the two seller fields that are permitted to leave the browser.
 *
 * Returns null when no identifier could be found — an unattributed count would
 * be useless, since every use of it in 4.3 and 6.3 is per-seller.
 */
export async function resolveSeller(
  recorder: ExtractionRecorder,
  node: JsonObject | null,
  main: Element | null,
  targetListingId: string | null,
): Promise<SellerPayload | null> {
  const rawId = recorder.resolve<string>("seller_hash", [
    ["json_payload", () => findSellerId(node, null)],
    ["url_path", () => findSellerId(null, main)],
  ]);

  if (rawId === null) return null;

  const count = recorder.resolve<number>("seller_listing_count", [
    ["json_payload", () => findListingCount(node, null, targetListingId)],
    ["aria_dom", () => findListingCount(null, main, targetListingId)],
  ]);

  const rating = recorder.resolve<{ average: number; count: number | null }>("seller_rating", [
    ["aria_dom", () => findSellerRating(main)],
  ]);

  return {
    seller_hash: await hashSellerId(rawId),
    hash_version: HASH_VERSION,
    active_vehicle_listing_count: count,
    rating_average: rating?.average ?? null,
    rating_count: rating?.count ?? null,
  };
}
