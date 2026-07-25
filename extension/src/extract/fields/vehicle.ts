/**
 * Year, make, model, trim and title status (spec 4.1).
 *
 * Trim is the field the spec singles out as driving large price variance while
 * being frequently missing (4.3). It is returned as free text here and left
 * unnormalised on purpose: step 6 replaces it with the VIN-decoded value where
 * a VIN was recovered, and a normalisation applied now would have to be undone.
 */

import { detectTitleStatus, parseVehicleTitle, textOrNull } from "../../shared/parse";
import { FB_KEYS } from "../fb-keys";
import type { ExtractionRecorder } from "../self-check";
import { headingText } from "../strategies/aria-dom";
import type { JsonObject } from "../strategies/json-payload";
import { pickNumber, pickString } from "../strategies/json-payload";
import { ogTitle } from "../strategies/meta-tags";

export interface ResolvedVehicle {
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  titleStatus: string | null;
  title: string | null;
}

export interface VehicleSources {
  node: JsonObject | null;
  doc: Document | null;
  block: Element | null;
  description: string | null;
}

export function resolveVehicle(
  recorder: ExtractionRecorder,
  sources: VehicleSources,
): ResolvedVehicle {
  const { node, doc, block, description } = sources;

  // The title string is the shared input to year/make/model, so it is resolved
  // once rather than re-derived inside each field's cascade.
  const title =
    pickString(node, FB_KEYS.listingTitle) ??
    (doc ? ogTitle(doc) : null) ??
    (block ? headingText(block) : null);

  const parsed = parseVehicleTitle(title);

  const year = recorder.resolve<number>("year", [
    ["json_payload", () => pickNumber(node, FB_KEYS.vehicleYear)],
    ["json_payload", () => (title ? parsed.year : null)],
    ["meta_tag", () => (doc ? parseVehicleTitle(ogTitle(doc)).year : null)],
    ["aria_dom", () => (block ? parseVehicleTitle(headingText(block)).year : null)],
  ]);

  const make = recorder.resolve<string>("make", [
    ["json_payload", () => textOrNull(pickString(node, FB_KEYS.vehicleMake))],
    ["json_payload", () => (title ? parsed.make : null)],
    ["meta_tag", () => (doc ? parseVehicleTitle(ogTitle(doc)).make : null)],
    ["aria_dom", () => (block ? parseVehicleTitle(headingText(block)).make : null)],
  ]);

  const model = recorder.resolve<string>("model", [
    ["json_payload", () => textOrNull(pickString(node, FB_KEYS.vehicleModel))],
    ["json_payload", () => (title ? parsed.model : null)],
    ["meta_tag", () => (doc ? parseVehicleTitle(ogTitle(doc)).model : null)],
    ["aria_dom", () => (block ? parseVehicleTitle(headingText(block)).model : null)],
  ]);

  const trim = recorder.resolve<string>("trim_text", [
    ["json_payload", () => textOrNull(pickString(node, FB_KEYS.vehicleTrim))],
    ["json_payload", () => (title ? parsed.trim : null)],
  ]);

  const titleStatus = recorder.resolve<string>("title_status", [
    [
      "json_payload",
      () => {
        const stated = pickString(node, FB_KEYS.vehicleCondition);
        return stated ? (detectTitleStatus(stated) ?? textOrNull(stated)) : null;
      },
    ],
    // Sellers state the title in prose far more often than in the structured
    // field, and "salvage" in a description is the same fact either way.
    ["text_pattern", () => detectTitleStatus(description, title)],
  ]);

  return { year, make, model, trim, titleStatus, title };
}
