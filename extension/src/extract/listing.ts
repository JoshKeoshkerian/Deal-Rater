/**
 * Target listing extraction (spec 4.1).
 *
 * Composes the per-field cascades into one observation plus a self-check
 * report. Every field goes through the recorder, so nothing is extracted
 * without its winning strategy being recorded.
 */

import { listingIdFromUrl } from "../shared/parse";
import type { ExtractionIssue, ObservationPayload } from "../shared/types";
import { ExtractionContext } from "./context";
import { descriptionBlock, listingHeaderBlock } from "./fields/dom-blocks";
import { findTargetListingNode } from "./fields/listing-node";
import { resolveMileage } from "./fields/odometer";
import { resolvePhotoCount } from "./fields/media";
import { resolvePlace } from "./fields/place";
import { resolvePrice, resolvePriceChanged } from "./fields/price";
import { resolveSeller } from "./fields/seller";
import { resolveDescription, resolveVin } from "./fields/text";
import { resolvePosting } from "./fields/timing";
import { resolveVehicle } from "./fields/vehicle";
import { ExtractionRecorder, TARGET_FIELD_EXPECTATIONS } from "./self-check";
import { canonicalUrl, ogUrl } from "./strategies/meta-tags";

export interface TargetExtraction {
  observation: ObservationPayload;
  issues: ExtractionIssue[];
  pageSignature: string;
  /** False when the listing could not be identified at all. */
  usable: boolean;
}

/** Canonical listing URL, rebuilt from the id so referral parameters are dropped. */
function canonicalListingUrl(listingId: string | null): string | null {
  return listingId ? `https://www.facebook.com/marketplace/item/${listingId}/` : null;
}

export async function extractTargetListing(
  doc: Document,
  url: string,
  now: Date = new Date(),
): Promise<TargetExtraction> {
  const ctx = new ExtractionContext(doc, url, now);
  const recorder = new ExtractionRecorder(
    "target",
    TARGET_FIELD_EXPECTATIONS,
    ctx.pageSignature,
  );

  // A structural probe, not a field: if no listing-shaped object exists on what
  // is definitely a listing page, Facebook has changed something fundamental
  // and every cascade below is running on its fallback tiers.
  const node = recorder.resolve("listing_payload", [
    ["json_payload", () => findTargetListingNode(ctx.payloads, ctx.listingId)],
  ]);

  const sourceListingId = recorder.resolve<string>("source_listing_id", [
    ["url_path", () => ctx.listingId],
    ["meta_tag", () => listingIdFromUrl(canonicalUrl(doc) ?? ogUrl(doc))],
  ]);

  const listingUrl = recorder.resolve<string>("listing_url", [
    ["url_path", () => canonicalListingUrl(sourceListingId)],
    ["meta_tag", () => canonicalUrl(doc) ?? ogUrl(doc)],
  ]);

  const main = ctx.main;
  const headerBlock = listingHeaderBlock(main);
  const descBlock = descriptionBlock(main);

  const price = resolvePrice(recorder, node, headerBlock);
  const priceChanged = resolvePriceChanged(recorder, headerBlock);
  const mileage = resolveMileage(recorder, node, headerBlock, descBlock);
  const description = resolveDescription(recorder, node, doc, descBlock);
  const vehicle = resolveVehicle(recorder, { node, doc, block: headerBlock, description });
  const vin = resolveVin(recorder, description, vehicle.title);
  const photoCount = resolvePhotoCount(recorder, node, headerBlock);
  const place = resolvePlace(recorder, node, headerBlock);
  const posting = resolvePosting(recorder, node, headerBlock, now);
  const seller = await resolveSeller(recorder, node, main, sourceListingId);

  const observation: ObservationPayload = {
    source: "facebook_marketplace",
    source_listing_id: sourceListingId ?? "",
    listing_url: listingUrl,
    role: "target",

    price_cents: price.cents,
    currency: price.currency,
    mileage: mileage.value,
    mileage_unit: mileage.unit,
    year: vehicle.year,
    make: vehicle.make,
    model: vehicle.model,
    trim_text: vehicle.trim,
    title_status: vehicle.titleStatus,
    description,
    photo_count: photoCount,
    posted_at: posting.postedAt ? posting.postedAt.toISOString() : null,
    posted_relative_text: posting.relativeText,
    price_changed: priceChanged,
    location_text: place.text,
    latitude: place.latitude,
    longitude: place.longitude,
    vin,

    seller,

    field_strategies: recorder.strategies,
    // Whitelisted, never a spread of the payload: the seller object and every
    // profile link must stay out of anything that crosses the network.
    raw_extract: {
      title: vehicle.title,
      price_text: price.text,
      mileage_text: mileage.text,
      posted_text: posting.relativeText,
      page_signature: ctx.pageSignature,
    },
  };

  return {
    observation,
    issues: recorder.issues,
    pageSignature: ctx.pageSignature,
    usable: sourceListingId !== null,
  };
}
