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
import { FB_KEYS } from "./fb-keys";
import { aboutVehicleBlock, descriptionBlock, listingHeaderBlock } from "./fields/dom-blocks";
import { findListingPhotosNode, findTargetListingNode } from "./fields/listing-node";
import { resolveMileage } from "./fields/odometer";
import { resolvePhotoCount } from "./fields/media";
import { readSearchRadiusKm, resolvePlace } from "./fields/place";
import { resolvePrice, resolvePriceChanged } from "./fields/price";
import { resolveSeller } from "./fields/seller";
import { resolveDescription, resolveVin } from "./fields/text";
import { resolvePosting } from "./fields/timing";
import { resolveVehicle } from "./fields/vehicle";
import { ExtractionRecorder, TARGET_FIELD_EXPECTATIONS } from "./self-check";
import { findValueByKey } from "./strategies/json-payload";
import { canonicalUrl, ogUrl } from "./strategies/meta-tags";

export interface TargetExtraction {
  observation: ObservationPayload;
  issues: ExtractionIssue[];
  pageSignature: string;
  /** False when the listing could not be identified at all. */
  usable: boolean;
  /**
   * Facebook place id for the listing's own location, used to scope the comp
   * search to the right metro. Deliberately NOT part of the observation: it is
   * a routing token for one search, not a fact about the vehicle.
   */
  locationId: string | null;
  /**
   * The account's Marketplace search radius in kilometres, when the page states
   * it. Recorded rather than used: it cannot be set per request, so this is the
   * only way the geographic scope of a comp set is ever knowable.
   */
  searchRadiusKm: number | null;
  /**
   * False when the page carried no JSON payload for THIS listing.
   *
   * Marketplace is a single-page app. The embedded payloads are written at full
   * page load; navigating listing-to-listing fetches the new data into
   * JavaScript memory without adding script tags. So after a click-through the
   * payloads describe the PREVIOUS listing, `findTargetListingNode` refuses
   * them, and every field falls to its weakest tier.
   *
   * That is why capturing used to need a manual refresh. The caller re-fetches
   * the listing URL when this is false, which gets server-rendered HTML with
   * the right payloads in it.
   */
  payloadMatched: boolean;
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
  const aboutBlock = aboutVehicleBlock(main);

  const price = resolvePrice(recorder, node, headerBlock);
  const priceChanged = resolvePriceChanged(recorder, headerBlock);
  const description = resolveDescription(recorder, node, doc, descBlock);
  const vehicle = resolveVehicle(recorder, { node, doc, block: headerBlock, description });
  // After the vehicle, so its title can serve as a mileage source of last
  // resort for sellers who type the odometer into the title instead.
  const mileage = resolveMileage(
    recorder,
    node,
    headerBlock,
    descBlock,
    vehicle.title,
    aboutBlock,
  );
  const vin = resolveVin(recorder, node, description, vehicle.title);
  // Only trust the id-less photos lookup once `node` has confirmed the payload
  // set is fresh for THIS listing (see `findListingPhotosNode`'s docstring) --
  // otherwise a stale page could attribute a previous listing's photos here.
  const photosNode = node ? findListingPhotosNode(ctx.payloads) : null;
  const photoCount = resolvePhotoCount(recorder, node, headerBlock, photosNode);
  const place = resolvePlace(recorder, node, headerBlock);
  const posting = resolvePosting(recorder, node, headerBlock, now);
  const seller = await resolveSeller(recorder, node, main, sourceListingId);

  // Routing token for the comp search, not a field of the observation. Read
  // from anywhere in the page payloads rather than from the listing node: it
  // sits on a sibling container, not on the listing object itself.
  // `findValueByKey` is safe here: "location_vanity_or_id" is specific enough
  // to be unambiguous, which is the condition its docstring sets.
  const rawLocationId = findValueByKey(ctx.payloads, FB_KEYS.locationVanityOrId);
  const searchRadiusKm = readSearchRadiusKm(ctx.payloads);
  const locationId =
    typeof rawLocationId === "string" && /^[A-Za-z0-9.-]{3,64}$/.test(rawLocationId)
      ? rawLocationId
      : null;

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
    trim_source: vehicle.trimSource,
    seller_type: vehicle.sellerType,
    transmission: vehicle.transmission,
    title_status: vehicle.titleStatus,
    owner_count: vehicle.ownerCount,
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
    locationId,
    searchRadiusKm,
    payloadMatched: node !== null,
  };
}
