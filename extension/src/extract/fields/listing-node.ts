/**
 * Locating the JSON object that describes a listing.
 *
 * Getting this right matters more than any individual field cascade. Once the
 * correct object is in hand, every field is a sibling lookup on it, which is
 * both accurate and cheap. Pulling values by bare key name across the whole
 * payload is the alternative, and it silently mixes data from unrelated
 * listings — a Marketplace page carries several.
 *
 * The strongest disambiguator available is the listing id in the URL. It is
 * routing rather than presentation, so it does not rotate, and it uniquely
 * identifies which of the many listing objects on the page is the one the user
 * is actually looking at.
 */

import { FB_KEYS } from "../fb-keys";
import type { JsonObject } from "../strategies/json-payload";
import { findObject, findObjects, pick } from "../strategies/json-payload";

function hasAny(node: JsonObject, keys: readonly string[]): boolean {
  return keys.some((key) => node[key] !== undefined && node[key] !== null);
}

function nodeId(node: JsonObject): string | null {
  const value = pick(node, FB_KEYS.listingId);
  if (typeof value === "string" && /^\d+$/.test(value)) return value;
  if (typeof value === "number") return String(value);
  return null;
}

/** True when the object looks like a listing rather than an arbitrary map. */
export function isListingNode(node: JsonObject): boolean {
  return hasAny(node, FB_KEYS.listingTitle);
}

/**
 * The listing object for the page being viewed.
 *
 * Matching on the URL's listing id is what keeps this from returning a "similar
 * listings" card or, worse, the listing the user was looking at a moment ago.
 *
 * WHEN THE ID IS KNOWN AND NOTHING MATCHES IT, THIS RETURNS NULL.
 *
 * It used to fall back to the first listing-shaped object on the page. That
 * silently corrupted identity, and captured data proves it: two captures share
 * listing id 2061074687826390 while describing completely different cars, a 2010
 * Mercedes C-Class and a 2017 Infiniti Q50. Marketplace is a single-page app, so
 * clicking from one listing to another changes the URL immediately while the new
 * listing's payload is still in flight. Evaluating in that window paired the new
 * URL's id with the old listing's data.
 *
 * That is the worst possible failure for this project. Spec 4.4 builds a
 * per-listing time series keyed on exactly this id, so a mismatch does not just
 * produce one bad row -- it attributes one car's price history to another, and
 * nothing downstream can detect it.
 *
 * No data beats wrong data here. The remaining cascades read the rendered DOM,
 * which does match the URL, so fields still resolve; they simply resolve from a
 * weaker tier, which the self-check already records.
 */
export function findTargetListingNode(
  payloads: unknown[],
  listingId: string | null,
): JsonObject | null {
  if (listingId) {
    return findObject(payloads, (node) => isListingNode(node) && nodeId(node) === listingId);
  }

  // No id to match against -- an unusual route rather than a stale page. The
  // first listing-shaped object is a guess, but there is nothing to contradict.
  return findObject(payloads, isListingNode);
}

/**
 * The photo array for the page's listing, when Facebook has split the listing's
 * identity across two objects.
 *
 * `findTargetListingNode` requires a title key so an id collision can never
 * attribute one listing's data to another (see its docstring). But the detail
 * page's photo carousel is rendered from a *different* object -- a
 * `GroupCommerceProductItem` under `marketplace_product_details_page.target`
 * that carries `listing_photos` but no title field at all, so it fails
 * `isListingNode` and `findTargetListingNode` never returns it.
 *
 * That object's `id` is not even the listing id -- confirmed against captured
 * pages, it is some other internal identifier, so it cannot be matched the same
 * way `findTargetListingNode` matches. Instead this is called ONLY after the
 * caller has confirmed `findTargetListingNode` succeeded (`payloadMatched`):
 * once that has matched the current URL's listing id against a title-bearing
 * node, the payload set is known fresh for this page, and search-result and
 * feed cards for other listings carry only `primary_listing_photo`, never a
 * full `listing_photos` array -- so on a fresh page this key is unique to the
 * listing being viewed. Without that precondition a stale page (see
 * `findTargetListingNode`'s docstring) could attribute a previous listing's
 * photos to the current one, since there would be nothing left to check this
 * object's identity against.
 */
export function findListingPhotosNode(payloads: unknown[]): JsonObject | null {
  return findObject(payloads, (node) => hasAny(node, FB_KEYS.photos));
}

/**
 * Every distinct listing object in a search result payload.
 *
 * Deduplicated by id: Facebook's feed structure repeats the same listing across
 * the wrapper and the node itself, and counting a comp twice would quietly
 * weight it double in step 3's regression.
 */
export function findCompListingNodes(
  payloads: unknown[],
  limit = 200,
): Array<{ id: string; node: JsonObject }> {
  const nodes = findObjects(payloads, isListingNode, limit * 4);
  const byId = new Map<string, JsonObject>();

  for (const node of nodes) {
    const id = nodeId(node);
    if (!id) continue;
    const existing = byId.get(id);
    // Prefer the richer of two objects describing the same listing.
    if (!existing || Object.keys(node).length > Object.keys(existing).length) {
      byId.set(id, node);
    }
    if (byId.size >= limit) break;
  }

  return Array.from(byId, ([id, node]) => ({ id, node }));
}
