/**
 * Comp card extraction from a Marketplace search result page (spec 4.3).
 *
 * A card shows far less than a listing page — typically price, title, location
 * and one subtitle line — so most fields drop to `optional` in the self-check.
 * That is expected, not degradation.
 *
 * Two paths, tried in order. The payload path is preferred and generally
 * returns every card in the response; the DOM path is a genuine fallback that
 * reads whatever cards actually rendered.
 */

import { collapseWhitespace, listingIdFromUrl, parsePrice, parseMileage, parseVehicleTitle } from "../shared/parse";
import type { ExtractionIssue, ObservationPayload } from "../shared/types";
import { ExtractionContext } from "./context";
import { findCompListingNodes } from "./fields/listing-node";
import { resolveMileage, subtitleTexts } from "./fields/odometer";
import { resolvePlace } from "./fields/place";
import { resolvePrice } from "./fields/price";
import { resolveSeller } from "./fields/seller";
import { resolveVehicle } from "./fields/vehicle";
import { COMP_FIELD_EXPECTATIONS, collapseIssues, ExtractionRecorder } from "./self-check";
import { itemLinks } from "./strategies/aria-dom";
import { PRICE_RE } from "./strategies/text-patterns";

export interface CompExtraction {
  observations: ObservationPayload[];
  issues: ExtractionIssue[];
}

const DEFAULT_LIMIT = 120;

function emptyObservation(id: string): ObservationPayload {
  return {
    source: "facebook_marketplace",
    source_listing_id: id,
    listing_url: `https://www.facebook.com/marketplace/item/${id}/`,
    role: "comp",
    price_cents: null,
    currency: null,
    mileage: null,
    mileage_unit: null,
    year: null,
    make: null,
    model: null,
    trim_text: null,
    title_status: null,
    description: null,
    photo_count: null,
    posted_at: null,
    posted_relative_text: null,
    price_changed: null,
    location_text: null,
    latitude: null,
    longitude: null,
    vin: null,
    seller: null,
    field_strategies: {},
    raw_extract: null,
  };
}

async function fromPayloads(
  ctx: ExtractionContext,
  limit: number,
): Promise<{ observations: ObservationPayload[]; issues: ExtractionIssue[] }> {
  const found = findCompListingNodes(ctx.payloads, limit);
  const observations: ObservationPayload[] = [];
  const issues: ExtractionIssue[] = [];

  for (const { id, node } of found) {
    const recorder = new ExtractionRecorder(
      "comp_card",
      COMP_FIELD_EXPECTATIONS,
      ctx.pageSignature,
    );

    recorder.strategies["source_listing_id"] = "json_payload";
    recorder.strategies["listing_url"] = "url_path";

    const price = resolvePrice(recorder, node, null);
    const mileage = resolveMileage(recorder, node, null);
    const vehicle = resolveVehicle(recorder, {
      node,
      doc: null,
      block: null,
      description: null,
    });
    const place = resolvePlace(recorder, node, null);
    const seller = await resolveSeller(recorder, node, null, id);

    const observation = emptyObservation(id);
    observation.price_cents = price.cents;
    observation.currency = price.currency;
    observation.mileage = mileage.value;
    observation.mileage_unit = mileage.unit;
    observation.year = vehicle.year;
    observation.make = vehicle.make;
    observation.model = vehicle.model;
    observation.trim_text = vehicle.trim;
    observation.title_status = vehicle.titleStatus;
    observation.location_text = place.text;
    observation.latitude = place.latitude;
    observation.longitude = place.longitude;
    observation.seller = seller;
    observation.field_strategies = recorder.strategies;
    observation.raw_extract = {
      title: vehicle.title,
      subtitles: subtitleTexts(node).slice(0, 4),
    };

    observations.push(observation);
    issues.push(...recorder.issues);
  }

  return { observations, issues };
}

/**
 * Read cards straight from the rendered DOM.
 *
 * Anchored on `a[href*="/marketplace/item/"]`: the card's link is the one part
 * of it that is routing rather than presentation. Everything else is recovered
 * by pattern-matching the anchor's own text, which on a search card is a short,
 * predictable string ("$12,900 · 2014 Toyota Camry · Tulsa, OK · 96K miles").
 */
function fromDom(
  ctx: ExtractionContext,
  limit: number,
): { observations: ObservationPayload[]; issues: ExtractionIssue[] } {
  const observations: ObservationPayload[] = [];
  const issues: ExtractionIssue[] = [];
  const seen = new Set<string>();

  for (const link of itemLinks(ctx.main)) {
    if (observations.length >= limit) break;

    const id = listingIdFromUrl(link.getAttribute("href"));
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const recorder = new ExtractionRecorder(
      "comp_card",
      COMP_FIELD_EXPECTATIONS,
      ctx.pageSignature,
    );
    recorder.strategies["source_listing_id"] = "url_path";
    recorder.strategies["listing_url"] = "url_path";

    const text = collapseWhitespace(link.textContent ?? "");
    const observation = emptyObservation(id);

    const priceText = text.match(PRICE_RE)?.[0] ?? null;
    const price = priceText ? parsePrice(priceText) : null;
    if (price) {
      observation.price_cents = price.cents;
      observation.currency = price.currency;
      recorder.strategies["price_cents"] = "text_pattern";
    } else {
      recorder.reportUnparsed("price_cents", ["text_pattern"]);
    }

    const mileage = parseMileage(text);
    if (mileage) {
      observation.mileage = mileage.value;
      observation.mileage_unit = mileage.unit;
      recorder.strategies["mileage"] = "text_pattern";
    }

    // Strip the price before parsing the title, so a leading "$12,900" is not
    // mistaken for part of the vehicle description.
    const withoutPrice = priceText ? text.replace(priceText, " ") : text;
    const vehicle = parseVehicleTitle(withoutPrice);
    observation.year = vehicle.year;
    observation.make = vehicle.make;
    observation.model = vehicle.model;
    observation.trim_text = vehicle.trim;
    if (vehicle.year !== null) recorder.strategies["year"] = "text_pattern";
    if (vehicle.make !== null) recorder.strategies["make"] = "text_pattern";
    if (vehicle.model !== null) recorder.strategies["model"] = "text_pattern";

    observation.field_strategies = recorder.strategies;
    observation.raw_extract = { card_text: text.slice(0, 300) };

    observations.push(observation);
    issues.push(...recorder.issues);
  }

  return { observations, issues };
}

export async function extractCompCards(
  doc: Document,
  url: string,
  now: Date = new Date(),
  limit: number = DEFAULT_LIMIT,
): Promise<CompExtraction> {
  const ctx = new ExtractionContext(doc, url, now);

  const payloadResult = await fromPayloads(ctx, limit);
  if (payloadResult.observations.length > 0) {
    return {
      observations: payloadResult.observations,
      issues: collapseIssues(payloadResult.issues),
    };
  }

  const domResult = fromDom(ctx, limit);
  return {
    observations: domResult.observations,
    issues: collapseIssues(domResult.issues),
  };
}
