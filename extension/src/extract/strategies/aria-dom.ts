/**
 * Tier 3: ARIA roles and semantic structure.
 *
 * Facebook rotates generated class names constantly, so none appear here. What
 * this tier uses instead:
 *
 *   - landmark roles (`main`, `heading`, `article`) — accessibility semantics,
 *     which Facebook has a strong external reason to keep working
 *   - `aria-label` text, for the same reason
 *   - URL shape (`/marketplace/item/<id>`), which is routing rather than
 *     presentation and is the single most stable anchor on the page
 *
 * Explicitly banned in this file and everywhere else: generated class selectors
 * (`.x1i10hfl`), positional `nth-child` chains, and index-based XPath.
 */

import { collapseWhitespace } from "../../shared/parse";

export const MARKETPLACE_ITEM_HREF = 'a[href*="/marketplace/item/"]';

/**
 * Text that only appears inside a vehicle listing's own detail panel, used to
 * tell an item-view dialog apart from an unrelated one (chat popup, "read
 * more" description popup) that happens to also carry `role="dialog"`.
 */
const LISTING_DIALOG_SIGNAL = /seller.?s\s*description|about this vehicle|seller information/i;

export function headingText(root: ParentNode): string | null {
  const node =
    root.querySelector("h1") ??
    root.querySelector('[role="heading"][aria-level="1"]') ??
    root.querySelector('[role="heading"]');
  const text = node?.textContent;
  return text ? collapseWhitespace(text) || null : null;
}

/**
 * The main landmark, falling back to body when the page has no landmark.
 *
 * Reaching an item by clicking through (search results, "similar items")
 * opens it in a `role="dialog"` overlay stacked on top of whatever page was
 * already mounted -- Marketplace does not unmount the page behind it. A real
 * capture had exactly one `[role="main"]`, and it belonged to a PREVIOUS
 * listing's full page (its own conflicting heading, its own "Seller's
 * description") while the listing actually being viewed -- its title, VIN and
 * description -- existed only inside a dialog stacked on top.
 *
 * Only switches to the dialog when there is an actual conflict: `main` has
 * its own heading, the dialog has its own heading, and they disagree. A
 * dialog that matches the listing-content signal but carries no heading of
 * its own (a "read more" description popup, most often) is not a second
 * listing view and is left alone; so is a dialog that agrees with `main`
 * instead of contradicting it -- both patterns are common on ordinary,
 * correctly-loaded pages and are not the staleness this exists to catch.
 */
export function mainRegion(doc: Document): Element {
  const main = doc.querySelector('[role="main"]') ?? doc.querySelector("main") ?? doc.body;
  const mainHeading = headingText(main);

  if (mainHeading) {
    const dialogs = Array.from(doc.querySelectorAll('[role="dialog"]')).reverse();
    const listingDialog = dialogs.find((dialog) => {
      if (!LISTING_DIALOG_SIGNAL.test(dialog.textContent ?? "")) return false;
      const dialogHeading = headingText(dialog);
      if (!dialogHeading) return false;
      const a = mainHeading.toLowerCase();
      const b = dialogHeading.toLowerCase();
      return !a.includes(b) && !b.includes(a);
    });
    if (listingDialog) return listingDialog;
  }

  return main;
}

export function visibleText(root: ParentNode | null | undefined): string {
  if (!root) return "";
  const text = (root as HTMLElement).textContent ?? "";
  return collapseWhitespace(text);
}

/** All Marketplace item links under `root`, in document order. */
export function itemLinks(root: ParentNode): HTMLAnchorElement[] {
  return Array.from(root.querySelectorAll<HTMLAnchorElement>(MARKETPLACE_ITEM_HREF));
}

/** Distinct listing ids linked under `root`. */
export function linkedListingIds(root: ParentNode): string[] {
  const ids = new Set<string>();
  for (const link of itemLinks(root)) {
    const match = link.getAttribute("href")?.match(/\/marketplace\/item\/(\d+)/);
    if (match) ids.add(match[1]!);
  }
  return Array.from(ids);
}

/**
 * Find the block of the page introduced by a heading matching `pattern`.
 *
 * Used to scope a search to a named section ("Seller's other listings") without
 * knowing anything about how that section is nested. Walks up from the heading
 * until the enclosing element contains meaningfully more than the heading
 * itself, which is a structural test rather than a positional one.
 *
 * "Meaningfully more" is judged by text length, not child count: Facebook
 * wraps headings in several single-child style-only divs before the real
 * sibling content appears, and one of those wrappers routinely contains an
 * empty placeholder div alongside the heading -- `children.length > 1` was
 * true there while the node's text was still just the heading itself, so the
 * walk stopped short of any real content. The hop budget is raised to match:
 * a real "Seller's description" section on a captured listing needed 8-9
 * hops to reach text past the heading, well past the old limit of 6.
 */
export function sectionByHeading(root: ParentNode, pattern: RegExp): Element | null {
  const headings = Array.from(
    root.querySelectorAll('h1, h2, h3, h4, [role="heading"]'),
  );

  for (const heading of headings) {
    const headingText = collapseWhitespace(heading.textContent ?? "");
    if (!pattern.test(headingText)) continue;

    let node: Element | null = heading.parentElement;
    for (let hops = 0; hops < 12 && node; hops += 1) {
      const nodeText = collapseWhitespace(node.textContent ?? "");
      if (
        node.querySelector(MARKETPLACE_ITEM_HREF) ||
        nodeText.length > headingText.length + 20
      ) {
        return node;
      }
      node = node.parentElement;
    }
    return heading.parentElement;
  }

  return null;
}

/** First element whose aria-label matches, anywhere under `root`. */
export function byAriaLabel(root: ParentNode, pattern: RegExp): Element | null {
  for (const node of Array.from(root.querySelectorAll("[aria-label]"))) {
    const label = node.getAttribute("aria-label");
    if (label && pattern.test(label)) return node;
  }
  return null;
}

/** Every aria-label under `root`. Cheap way to text-match over accessible names. */
export function ariaLabels(root: ParentNode): string[] {
  return Array.from(root.querySelectorAll("[aria-label]"))
    .map((node) => node.getAttribute("aria-label") ?? "")
    .filter((label) => label !== "");
}

/** Distinct Facebook CDN image URLs under `root`, ignoring size variants. */
export function contentImageUrls(root: ParentNode): string[] {
  const urls = new Set<string>();
  for (const img of Array.from(root.querySelectorAll<HTMLImageElement>("img"))) {
    const src = img.getAttribute("src");
    if (!src) continue;
    if (!/scontent|fbcdn/i.test(src)) continue;
    // Strip the query string: the same photo is served at several sizes.
    urls.add(src.split("?")[0]!);
  }
  return Array.from(urls);
}
