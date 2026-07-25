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

/** The main landmark, falling back to body when the page has no landmark. */
export function mainRegion(doc: Document): Element {
  return doc.querySelector('[role="main"]') ?? doc.querySelector("main") ?? doc.body;
}

export function headingText(root: ParentNode): string | null {
  const node =
    root.querySelector("h1") ??
    root.querySelector('[role="heading"][aria-level="1"]') ??
    root.querySelector('[role="heading"]');
  const text = node?.textContent;
  return text ? collapseWhitespace(text) || null : null;
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
 */
export function sectionByHeading(root: ParentNode, pattern: RegExp): Element | null {
  const headings = Array.from(
    root.querySelectorAll('h1, h2, h3, h4, [role="heading"]'),
  );

  for (const heading of headings) {
    const text = collapseWhitespace(heading.textContent ?? "");
    if (!pattern.test(text)) continue;

    let node: Element | null = heading.parentElement;
    for (let hops = 0; hops < 6 && node; hops += 1) {
      if (node.querySelector(MARKETPLACE_ITEM_HREF) || node.children.length > 1) {
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
