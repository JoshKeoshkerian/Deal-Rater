/**
 * Locates Facebook's own "Send" button in the message-the-seller composer, so
 * the Evaluate dock can float just above it instead of sitting wherever the
 * viewport corner happens to put it.
 *
 * WHY THIS MATTERS ENOUGH TO ANCHOR TO: the dock's original fixed position
 * (bottom-right corner) sat in the same neighbourhood as Marketplace's own
 * Send button. A misclick there does not just fail to evaluate a listing --
 * it sends a half-written message to a stranger. Floating a fixed gap above
 * whatever Send button is actually on screen removes the overlap regardless
 * of how Facebook's own layout shifts the composer around.
 *
 * Aria-label first, then visible text on a leaf-ish node -- same tier order
 * `extract/strategies/aria-dom.ts` uses everywhere else, and for the same
 * reason: an accessible name is something Facebook has an external reason to
 * keep working, a generated class name is not. No page content is read here
 * beyond locating an element to float near, so this carries none of spec
 * 8.1's collection concerns.
 */

import { mainRegion } from "../extract/strategies/aria-dom";
import { collapseWhitespace } from "../shared/parse";

const SEND_LABEL = /^send$/i;

/**
 * A page this size carries more than one thing matching "Send" -- a hidden
 * template, an off-screen a11y-only label, a collapsed row in an unopened
 * panel. `getBoundingClientRect` on any of those returns a degenerate,
 * all-zero rect, and `trigger-button.ts` treats that rect as gospel: it
 * happened to compute `right: <viewport width>px; bottom: <viewport
 * height>px`, which reads as "off past the top-left corner", i.e. the dock
 * flashing and vanishing that this filter exists to prevent.
 *
 * `offsetParent === null` catches `display:none` and its ancestors; the
 * explicit width/height check catches everything laid out at zero size
 * (collapsed rows, empty wrappers) that `offsetParent` alone would not.
 */
function isRenderedOnScreen(node: HTMLElement): boolean {
  if (node.offsetParent === null) return false;
  const rect = node.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

export function findSendButtonAnchor(doc: Document = document): Element | null {
  const main = mainRegion(doc);
  const candidates = Array.from(
    main.querySelectorAll<HTMLElement>('[role="button"], button, [aria-label]'),
  ).filter(isRenderedOnScreen);

  for (const node of candidates) {
    const label = node.getAttribute("aria-label");
    if (label && SEND_LABEL.test(collapseWhitespace(label))) return node;
  }

  for (const node of candidates) {
    // Leaf-ish: a container whose accessible text merely INCLUDES "Send"
    // among other content (a whole composer wrapping "Send" and a photo
    // icon, say) is not the button itself.
    if (node.querySelector('[role="button"], button')) continue;
    if (SEND_LABEL.test(collapseWhitespace(node.textContent ?? ""))) return node;
  }

  return null;
}
