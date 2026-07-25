/**
 * Tier 4: text pattern matching.
 *
 * The floor. Everything above this tier has failed, so we are reading rendered
 * text and matching shapes in it. Always scoped to a subtree located by tier 3
 * rather than run over the whole document — a bare `$[\d,]+` match across a
 * Facebook page will find a price, just not necessarily this listing's.
 */

import { collapseWhitespace } from "../../shared/parse";

export const PRICE_RE = /[$£€]\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?|\bfree\b/i;
export const MILEAGE_RE =
  /\b\d{1,3}(?:,\d{3})*(?:\.\d+)?\s*k?\s*(?:miles|mile|mi|km|kilometers|kilometres)\b/i;
export const POSTED_RE =
  /\b(?:just listed|listed\s+(?:about\s+)?(?:an?|\d+)\s*(?:minute|hour|day|week|month|year)s?\s+ago|(?:an?|\d+)\s*(?:minute|hour|day|week|month|year)s?\s+ago)/i;
export const PHOTO_COUNT_RE = /\b(\d+)\s+of\s+(\d+)\b/;
export const PRICE_DROP_RE = /\bprice\s*(?:drop|dropped|reduced|lowered)\b|\breduced\b/i;

/** First substring matching `pattern`, or null. */
export function matchIn(text: string, pattern: RegExp): string | null {
  const match = text.match(pattern);
  return match ? collapseWhitespace(match[0]) : null;
}

/**
 * Read the text of the element whose own text matches `pattern`, preferring
 * the smallest such element.
 *
 * Preferring the deepest match is what keeps this from returning half the page:
 * a container's textContent includes everything below it, so the outermost
 * match is almost never the value you want.
 */
export function matchDeepest(root: ParentNode, pattern: RegExp): string | null {
  const nodes = Array.from(root.querySelectorAll<HTMLElement>("*"));
  let best: string | null = null;
  let bestLength = Infinity;

  for (const node of nodes) {
    const text = collapseWhitespace(node.textContent ?? "");
    if (text === "" || text.length >= bestLength) continue;
    const match = text.match(pattern);
    if (!match) continue;
    best = collapseWhitespace(match[0]);
    bestLength = text.length;
  }

  return best;
}

/** Longest text block under `root`, used as a description fallback. */
export function longestTextBlock(root: ParentNode, minLength = 40): string | null {
  const candidates = Array.from(root.querySelectorAll<HTMLElement>("div, span, p"));
  let best: string | null = null;

  for (const node of candidates) {
    // Only consider leaf-ish nodes: a container's text is the sum of its
    // children and would swallow the whole page.
    if (node.querySelector("div, p, a, button")) continue;
    const text = collapseWhitespace(node.textContent ?? "");
    if (text.length < minLength) continue;
    if (best === null || text.length > best.length) best = text;
  }

  return best;
}
