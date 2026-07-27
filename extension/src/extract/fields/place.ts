/**
 * Location (spec 4.1).
 *
 * Coordinates are taken when the payload offers them because step 3's fallback
 * widens the comp radius, and doing that on city strings alone is guesswork.
 * They describe the listing's approximate pickup area, which Facebook already
 * publishes on the page, not the user.
 */

import { cleanLocationText, textOrNull } from "../../shared/parse";
import { FB_KEYS } from "../fb-keys";
import { findValueByKey } from "../strategies/json-payload";
import type { ExtractionRecorder } from "../self-check";
import type { JsonObject } from "../strategies/json-payload";
import { pickNumber, pickObject, pickString } from "../strategies/json-payload";
import { matchDeepest } from "../strategies/text-patterns";

export interface ResolvedPlace {
  text: string | null;
  latitude: number | null;
  longitude: number | null;
}

const LOCATION_TEXT_RE = /\b(?:in\s+)?[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+)*,\s*[A-Z]{2}\b/;

function fromReverseGeocode(location: JsonObject | null): string | null {
  const geocode = pickObject(location, FB_KEYS.reverseGeocode);
  if (!geocode) return null;

  const display = pickString(geocode, FB_KEYS.displayName);
  if (display) return display;

  const city = pickString(geocode, FB_KEYS.city);
  const stateValue = geocode["state"];
  const state =
    typeof stateValue === "string"
      ? stateValue
      : pickString(pickObject(geocode, FB_KEYS.state), FB_KEYS.displayName);

  if (city && state) return `${city}, ${state}`;
  return city ?? null;
}

export function resolvePlace(
  recorder: ExtractionRecorder,
  node: JsonObject | null,
  block: Element | null,
): ResolvedPlace {
  const location = pickObject(node, FB_KEYS.location);

  const text = recorder.resolve<string>("location_text", [
    ["json_payload", () => textOrNull(fromReverseGeocode(location))],
    ["json_payload", () => textOrNull(pickString(location, FB_KEYS.displayName))],
    [
      "text_pattern",
      () => {
        if (!block) return null;
        // "Listed 3 weeks ago in Tulsa, OK" — strip the leading clause.
        return cleanLocationText(matchDeepest(block, LOCATION_TEXT_RE));
      },
    ],
  ]);

  const latitude = recorder.resolve<number>("latitude", [
    ["json_payload", () => pickNumber(location, FB_KEYS.latitude)],
  ]);

  const longitude =
    latitude === null ? null : pickNumber(location, FB_KEYS.longitude);

  return {
    text: text ? text.slice(0, 255) : null,
    latitude,
    longitude,
  };
}

/**
 * The account's Marketplace search radius, in kilometres.
 *
 * Facebook renders it as either kilometres (`"radius":65`) or metres
 * (`"radius":65000`); both occur in captured pages and both mean 40 miles. Any
 * value above 1,000 is therefore read as metres.
 *
 * Returns null rather than a default when absent. Guessing a radius would be
 * worse than admitting it is unknown, because the whole point of recording it
 * is to stop the scope of a comp set being assumed.
 */
export function readSearchRadiusKm(payloads: unknown[]): number | null {
  const raw = findValueByKey(payloads, FB_KEYS.searchRadius);
  const numeric = typeof raw === "string" ? Number(raw) : raw;
  if (typeof numeric !== "number" || !Number.isFinite(numeric) || numeric <= 0) return null;

  const km = numeric > 1000 ? numeric / 1000 : numeric;
  // A radius beyond this is not a setting, it is a parse error.
  return km > 5000 ? null : Math.round(km);
}
