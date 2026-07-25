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
 */

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

  return {
    seller_hash: await hashSellerId(rawId),
    hash_version: HASH_VERSION,
    active_vehicle_listing_count: count,
  };
}
