/**
 * Mileage (spec 4.1). Mandatory input to the step-3 regression, and one of the
 * fields most often absent, so its cascade runs deepest.
 */

import { normaliseMileageValue, parseMileage } from "../../shared/parse";
import type { MileageUnit } from "../../shared/types";
import { FB_KEYS } from "../fb-keys";
import type { ExtractionRecorder } from "../self-check";
import type { JsonObject } from "../strategies/json-payload";
import { pickArray, pickObject, pickString } from "../strategies/json-payload";
import { matchDeepest, MILEAGE_RE } from "../strategies/text-patterns";

export interface ResolvedMileage {
  value: number | null;
  unit: MileageUnit | null;
  text: string | null;
}

/** Search cards carry mileage in a subtitle string ("96K miles"). */
export function subtitleTexts(node: JsonObject | null): string[] {
  const subtitles = pickArray(node, FB_KEYS.subtitles);
  if (!subtitles) return [];

  const out: string[] = [];
  for (const entry of subtitles) {
    if (typeof entry === "string") {
      out.push(entry);
    } else if (typeof entry === "object" && entry !== null) {
      const text = pickString(entry as JsonObject, FB_KEYS.subtitleText);
      if (text) out.push(text);
    }
  }
  return out;
}

export function resolveMileage(
  recorder: ExtractionRecorder,
  node: JsonObject | null,
  block: Element | null,
  descBlock: Element | null = null,
): ResolvedMileage {
  let unit: MileageUnit | null = null;
  let text: string | null = null;

  const value = recorder.resolve<number>("mileage", [
    [
      "json_payload",
      () => {
        const odometer = pickObject(node, FB_KEYS.odometer);
        if (!odometer) return null;
        const raw = normaliseMileageValue(
          odometer["value"] ?? odometer["odometer_value"],
        );
        if (raw === null) return null;
        const rawUnit = pickString(odometer, FB_KEYS.odometerUnit);
        unit = rawUnit && /km|kilomet/i.test(rawUnit) ? "km" : "mi";
        return raw;
      },
    ],
    [
      "json_payload",
      () => {
        // Subtitle form, used on search cards and sometimes on listing pages.
        for (const subtitle of subtitleTexts(node)) {
          const parsed = parseMileage(subtitle);
          if (parsed) {
            unit = parsed.unit;
            text = subtitle;
            return parsed.value;
          }
        }
        return null;
      },
    ],
    [
      "text_pattern",
      () => {
        if (!block) return null;
        const matched = matchDeepest(block, MILEAGE_RE);
        if (!matched) return null;
        const parsed = parseMileage(matched);
        if (!parsed) return null;
        unit = parsed.unit;
        text = matched;
        return parsed.value;
      },
    ],
    [
      "text_pattern",
      () => {
        // Sellers who skip the structured odometer field routinely still type
        // it in prose ("Odometer: 7,444 mi (actual)"), which lives in the
        // description, not the header block the tier above checks.
        if (!descBlock) return null;
        const matched = matchDeepest(descBlock, MILEAGE_RE);
        if (!matched) return null;
        const parsed = parseMileage(matched);
        if (!parsed) return null;
        unit = parsed.unit;
        text = matched;
        return parsed.value;
      },
    ],
  ]);

  return { value, unit: value === null ? null : (unit ?? "mi"), text };
}
