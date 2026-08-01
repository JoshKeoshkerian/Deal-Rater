/**
 * Scoping helpers for the DOM tiers.
 *
 * Every tier-3 and tier-4 lookup is scoped to one of these blocks rather than
 * run over the document. A Marketplace listing page shows several other
 * listings (similar items, more from this seller), so an unscoped `$[\d,]+`
 * match reliably finds *a* price and unreliably finds *this* price.
 */

import { collapseWhitespace } from "../../shared/parse";
import { sectionByHeading } from "../strategies/aria-dom";

/**
 * The block containing the listing title, price, mileage and location.
 *
 * Found by walking up from the page heading until the enclosing element also
 * contains a price-shaped string — a structural test, so it survives markup
 * changes that a fixed number of hops would not.
 */
export function listingHeaderBlock(main: Element): Element {
  const heading =
    main.querySelector("h1") ??
    main.querySelector('[role="heading"][aria-level="1"]') ??
    main.querySelector('[role="heading"]');

  if (!heading) return main;

  let node: Element | null = heading.parentElement;
  let fallback: Element = heading.parentElement ?? main;

  for (let hops = 0; hops < 8 && node && node !== main; hops += 1) {
    const text = collapseWhitespace(node.textContent ?? "");
    if (/[$£€]\s?\d/.test(text)) return node;
    fallback = node;
    node = node.parentElement;
  }

  return fallback;
}

/** The "Seller's other listings" / "More from this seller" section, if shown. */
export function sellerListingsBlock(main: Element): Element | null {
  return sectionByHeading(
    main,
    /other listings|more from this seller|seller'?s other|more listings from/i,
  );
}

/**
 * The description block, identified by its heading rather than its position.
 *
 * "Seller's description" is tried first and on its own: on the current layout
 * it is the actual free-text seller writeup, but "About this vehicle" comes
 * *earlier* in the DOM and is a structured facts grid (Color/Interior/VIN/…),
 * not prose. `sectionByHeading` returns the first heading match in document
 * order, so combining both patterns in one regex silently preferred the facts
 * grid over the real description whenever a listing had both sections.
 */
export function descriptionBlock(main: Element): Element | null {
  return (
    sectionByHeading(main, /seller.?s\s*description/i) ??
    sectionByHeading(main, /^description$|^details$|about this vehicle/i)
  );
}

/**
 * The "About this vehicle" facts grid specifically, independent of whichever
 * section `descriptionBlock` picked.
 *
 * When a listing has both "Seller's description" and "About this vehicle",
 * `descriptionBlock` returns only the former (see above), so a fact typed
 * into the grid rather than filled into Facebook's structured fields --
 * mileage most commonly -- was never scanned by any text-pattern tier. This
 * gives those tiers a second, dedicated block to fall back to.
 */
export function aboutVehicleBlock(main: Element): Element | null {
  return sectionByHeading(main, /about this vehicle/i);
}
