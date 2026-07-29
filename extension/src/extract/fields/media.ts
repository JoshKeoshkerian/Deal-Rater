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
  photosNode: JsonObject | null = null,
): number | null {
  return recorder.resolve<number>("photo_count", [
    [
      "aria_dom",
      () => {
        // Checked first because it is the only source that states a definitive
        // total rather than counting what happens to be visible: "Photo 1 of 12".
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
      "json_payload",
      () => {
        // Neither remaining source is reliably complete, so take the higher of
        // the two rather than picking one and discarding the other.
        //
        // `photosNode` (found by id, not title -- see `findListingPhotosNode`)
        // carries the full array; the title-matched `node` only ever has
        // `primary_listing_photo`, a single photo, so it is checked second. But
        // even `photosNode`'s array can itself be a truncated preview page for
        // a large gallery: one capture had a 6-item array against a carousel of
        // 36, confirmed by the DOM count below landing on the true total.
        const photos = pickArray(photosNode, FB_KEYS.photos) ?? pickArray(node, FB_KEYS.photos);
        // A floor, not a count — a carousel lazy-loads, so images the user has
        // not scrolled to are not in the DOM yet.
        const domCount = block ? contentImageUrls(block).length : 0;
        // `photos` distinguishes "confirmed zero" (an empty array was actually
        // found) from "no signal" (neither source found anything) -- a listing
        // with zero photos is itself a scam-pattern input (spec 6.3) and must
        // not collapse into the same null as "photo count not captured".
        if (photos === null && domCount === 0) return null;
        return Math.max(photos?.length ?? 0, domCount);
      },
    ],
  ]);
}
