/**
 * Photo count (spec 4.1).
 *
 * Worth more than it looks. Vision analysis is cut from the MVP (spec 11), but
 * photo *count* is metadata that needs no model call and carries a meaningful
 * share of the same signal — a two-photo listing on a $14k truck is one of the
 * scam-pattern inputs in 6.3.
 */

import { FB_KEYS } from "../fb-keys";
import type { ExtractionRecorder } from "../self-check";
import { ariaLabels, contentImageUrls } from "../strategies/aria-dom";
import type { JsonObject } from "../strategies/json-payload";
import { pickArray } from "../strategies/json-payload";
import { PHOTO_COUNT_RE } from "../strategies/text-patterns";

const MAX_PLAUSIBLE_PHOTOS = 200;

export function resolvePhotoCount(
  recorder: ExtractionRecorder,
  node: JsonObject | null,
  block: Element | null,
): number | null {
  return recorder.resolve<number>("photo_count", [
    [
      "json_payload",
      () => {
        const photos = pickArray(node, FB_KEYS.photos);
        return photos ? photos.length : null;
      },
    ],
    [
      "aria_dom",
      () => {
        // The carousel's accessible name states the total: "Photo 1 of 12".
        if (!block) return null;
        for (const label of ariaLabels(block)) {
          const match = label.match(PHOTO_COUNT_RE);
          if (match) {
            const total = Number(match[2]);
            if (Number.isFinite(total) && total > 0 && total <= MAX_PLAUSIBLE_PHOTOS) {
              return total;
            }
          }
        }
        return null;
      },
    ],
    [
      "aria_dom",
      () => {
        // Last resort: count the distinct CDN images in the header block. This
        // is a floor rather than a count — a carousel lazy-loads, so images the
        // user has not scrolled to are not in the DOM yet.
        if (!block) return null;
        const count = contentImageUrls(block).length;
        return count > 0 ? count : null;
      },
    ],
  ]);
}
