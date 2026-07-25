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
 * Matching on the URL's listing id first is what keeps this from returning a
 * "similar listings" card. Only when that fails does it fall back to the first
 * listing-shaped object, which is a guess and is treated as one.
 */
export function findTargetListingNode(
  payloads: unknown[],
  listingId: string | null,
): JsonObject | null {
  if (listingId) {
    const exact = findObject(
      payloads,
      (node) => isListingNode(node) && nodeId(node) === listingId,
    );
    if (exact) return exact;
  }

  return findObject(payloads, isListingNode);
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
