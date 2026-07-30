/**
 * Description and VIN (spec 4.1, 4.2).
 *
 * The payload is strongly preferred for the description, and not only for
 * durability: the rendered DOM is truncated behind a "See more" control, so the
 * text tier returns a fragment. Since the VIN is recovered by scanning the
 * description, a truncated description means a silently missed VIN.
 */

import { textOrNull } from "../../shared/parse";
import { redactContactDetails } from "../../shared/redact";
import { findVin } from "../../shared/vin";
import { FB_KEYS } from "../fb-keys";
import type { ExtractionRecorder } from "../self-check";
import type { JsonObject } from "../strategies/json-payload";
import { pickObject, pickString } from "../strategies/json-payload";
import { ogDescription } from "../strategies/meta-tags";
import { longestTextBlock } from "../strategies/text-patterns";

const MAX_DESCRIPTION_LENGTH = 20_000;

export function resolveDescription(
  recorder: ExtractionRecorder,
  node: JsonObject | null,
  doc: Document | null,
  block: Element | null,
): string | null {
  const raw = recorder.resolve<string>("description", [
    [
      "json_payload",
      () => {
        const container = pickObject(node, FB_KEYS.description);
        if (container) return pickString(container, FB_KEYS.descriptionText);
        return pickString(node, FB_KEYS.description);
      },
    ],
    ["aria_dom", () => (block ? longestTextBlock(block) : null)],
    ["meta_tag", () => (doc ? ogDescription(doc) : null)],
  ]);

  if (raw === null) return null;

  // Redacted here, before it leaves the browser at all. The backend redacts
  // again on receipt because it cannot assume a well-behaved client.
  const redacted = redactContactDetails(raw.slice(0, MAX_DESCRIPTION_LENGTH));
  return textOrNull(redacted) === null ? "" : redacted;
}

/**
 * Recover a VIN from the listing (spec 4.2).
 *
 * Opportunistic — most listings will not contain one. The check digit is
 * validated in `findVin` before a candidate is accepted, so a mistyped VIN is
 * dropped rather than transmitted and wasted on a decode call in step 6.
 *
 * Facebook's own VIN field (`vehicle_identification_number`, shown in "About
 * this vehicle") is tried first: a seller who fills that field in rather than
 * typing the VIN into the description previously fell through both text
 * tiers entirely, since neither scans a field that was never read at all.
 *
 * Runs against the description *before* redaction would matter: the token
 * substitution only touches phone numbers and emails, neither of which can
 * collide with a 17-character VIN.
 */
export function resolveVin(
  recorder: ExtractionRecorder,
  node: JsonObject | null,
  description: string | null,
  title: string | null,
): string | null {
  return recorder.resolve<string>("vin", [
    ["json_payload", () => findVin(pickString(node, FB_KEYS.vehicleVin))],
    ["text_pattern", () => findVin(description)],
    ["text_pattern", () => findVin(title)],
  ]);
}
