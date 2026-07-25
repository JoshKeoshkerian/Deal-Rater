/**
 * Posted date (spec 4.1), which becomes days-on-market in step 4.
 *
 * Two values are produced and both are kept: an absolute timestamp, and the
 * relative phrase exactly as Facebook rendered it. The phrase is not redundant.
 * "Listed 3 weeks ago" resolved to a timestamp looks precise to a day, and step
 * 4 draws a real distinction at 30 days. Keeping the original text means the
 * approximation stays visible instead of being laundered into false precision.
 */

import { epochSecondsToDate, parseRelativePostedDate } from "../../shared/parse";
import { FB_KEYS } from "../fb-keys";
import type { ExtractionRecorder } from "../self-check";
import type { JsonObject } from "../strategies/json-payload";
import { pick } from "../strategies/json-payload";
import { matchDeepest, POSTED_RE } from "../strategies/text-patterns";

export interface ResolvedPosting {
  postedAt: Date | null;
  relativeText: string | null;
}

export function resolvePosting(
  recorder: ExtractionRecorder,
  node: JsonObject | null,
  block: Element | null,
  now: Date,
): ResolvedPosting {
  let relativeText: string | null = null;

  const postedAt = recorder.resolve<Date>("posted_at", [
    ["json_payload", () => epochSecondsToDate(pick(node, FB_KEYS.createdAt))],
    [
      "text_pattern",
      () => {
        if (!block) return null;
        const matched = matchDeepest(block, POSTED_RE);
        if (!matched) return null;
        const parsed = parseRelativePostedDate(matched, now);
        if (!parsed) return null;
        relativeText = parsed.relativeText;
        return parsed.postedAt;
      },
    ],
  ]);

  return { postedAt, relativeText };
}
