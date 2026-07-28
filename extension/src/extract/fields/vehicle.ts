/**
 * Year, make, model, trim and title status (spec 4.1).
 *
 * Trim is the field the spec singles out as driving large price variance while
 * being frequently missing (4.3). It is returned as free text here and left
 * unnormalised on purpose: step 6 replaces it with the VIN-decoded value where
 * a VIN was recovered, and a normalisation applied now would have to be undone.
 */

import {
  detectTitleStatus,
  detectTrimInText,
  parseVehicleTitle,
  textOrNull,
} from "../../shared/parse";
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
  /** "fb_catalog" | "title_text" | "description". Null when trim is null. */
  trimSource: string | null;
  titleStatus: string | null;
  sellerType: string | null;
  transmission: string | null;
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

  // Every tier that reads a parsed TITLE is labelled `title_text`, not
  // `json_payload`. The title is itself pulled from the payload, so the old
  // labelling was defensible in isolation, but it made "Facebook gave us this
  // field" and "we regex-split a string" the same value in telemetry -- and
  // since the structured keys were wrong, every row in the database claimed
  // `json_payload` while the structured tier had never once fired.
  const year = recorder.resolve<number>("year", [
    ["json_payload", () => pickNumber(node, FB_KEYS.vehicleYear)],
    ["title_text", () => (title ? parsed.year : null)],
    ["meta_tag", () => (doc ? parseVehicleTitle(ogTitle(doc)).year : null)],
    ["aria_dom", () => (block ? parseVehicleTitle(headingText(block)).year : null)],
  ]);

  const make = recorder.resolve<string>("make", [
    ["json_payload", () => textOrNull(pickString(node, FB_KEYS.vehicleMake))],
    ["title_text", () => (title ? parsed.make : null)],
    ["meta_tag", () => (doc ? parseVehicleTitle(ogTitle(doc)).make : null)],
    ["aria_dom", () => (block ? parseVehicleTitle(headingText(block)).make : null)],
  ]);

  // MODEL IS THE ONE FIELD WHERE THE PAYLOAD IS NOT THE BEST SOURCE, and the
  // structured tier is deliberately ranked BELOW the title parse.
  //
  // `vehicle_model_display_name` is user-entered on Marketplace rather than
  // picked from a catalog, and across the captured fixtures it carries the
  // model alone ("Corolla", "CX-5", "Protege") only about half the time. The
  // rest jam in the trim or repeat the make: "911 carrera", "civic ex",
  // "q5 2.0t premium plus", "MAZDA MAZDA3". `parseVehicleTitle` already splits
  // model from trim and already drops a repeated make, so it produces the
  // cleaner value -- and a model that silently includes the trim would collapse
  // comp matching, since every trim variant would become its own model.
  //
  // Kept as a fallback below the title, where it can only help: it fires when
  // the title yielded nothing at all.
  const model = recorder.resolve<string>("model", [
    ["title_text", () => (title ? parsed.model : null)],
    ["json_payload", () => textOrNull(pickString(node, FB_KEYS.vehicleModel))],
    ["meta_tag", () => (doc ? parseVehicleTitle(ogTitle(doc)).model : null)],
    ["aria_dom", () => (block ? parseVehicleTitle(headingText(block)).model : null)],
  ]);

  // `trimSource` is tracked alongside the value because the tier that won is a
  // fact about the trim itself, not only about scraper health: the backend's
  // comp filter weighs a catalog trim differently from a seller-typed one, and
  // `field_strategies` is telemetry that no scoring path reads.
  let trimSource: string | null = null;
  const trim = recorder.resolve<string>("trim_text", [
    [
      "json_payload",
      () => {
        const stated = textOrNull(pickString(node, FB_KEYS.vehicleTrim));
        if (stated) trimSource = "fb_catalog";
        return stated;
      },
    ],
    [
      "title_text",
      () => {
        if (!title || parsed.trim === null) return null;
        // Distinguishes "2016 Mazda CX-5 · Sport SUV 4D" (catalog, after the
        // separator) from "2016 Mazda cx-5 gt" (whatever the seller typed).
        trimSource = parsed.trimSource;
        return parsed.trim;
      },
    ],
    // Spec 4.3: "otherwise extract from title and description text." The
    // title half is above; this is the description half, tried last and only
    // when the higher-trust sources found nothing -- see
    // `detectTrimInText`'s docstring for why it stays deliberately narrow.
    [
      "text_pattern",
      () => {
        const found = detectTrimInText(description);
        if (found) trimSource = "description";
        return found;
      },
    ],
  ]);

  // Spec 4.3's dealer exclusion, stated outright by Facebook. `comps.py`'s
  // `DealerSignal` documents this as unobtainable; it is one payload key.
  const sellerType = recorder.resolve<string>("seller_type", [
    ["json_payload", () => textOrNull(pickString(node, FB_KEYS.vehicleSellerType))],
  ]);

  const transmission = recorder.resolve<string>("transmission", [
    ["json_payload", () => textOrNull(pickString(node, FB_KEYS.vehicleTransmission))],
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

  return {
    year,
    make,
    model,
    trim,
    trimSource: trim === null ? null : trimSource,
    titleStatus,
    sellerType,
    transmission,
    title,
  };
}
