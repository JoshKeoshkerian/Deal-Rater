/**
 * Synthetic Marketplace pages for testing the extraction cascades.
 *
 * Three render modes, matching the three ways a real page can present itself:
 *
 *   payload  server-rendered JSON present. The healthy case.
 *   dom      no payload; values readable only from rendered markup. What the
 *            extractor falls back to after Facebook changes its data shape.
 *   meta     no payload and almost no markup; only Open Graph tags. The floor.
 *
 * These are not a substitute for real pages — `tests/fixtures/pages/` is where
 * scrubbed real snapshots go, and `fixtures.test.ts` runs the same extractor
 * against them. What these do is let every branch of every cascade be exercised
 * deterministically, including combinations that are rare in the wild.
 */

export type RenderMode = "payload" | "dom" | "meta";

export interface ListingSpec {
  id: string;
  title?: string | null;
  priceAmount?: string | null;
  priceText?: string | null;
  currency?: string | null;
  mileage?: number | null;
  mileageUnit?: string;
  mileageText?: string | null;
  description?: string | null;
  photoCount?: number | null;
  photoUrls?: number;
  location?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  createdAtSeconds?: number | null;
  postedText?: string | null;
  sellerId?: string | null;
  sellerOtherListingIds?: string[];
  sellerListingCount?: number | null;
  /** The star-rating widget shown on the listing page itself, if any. */
  sellerRating?: { average: number; count: number } | null;
  priceDropped?: boolean;
  trim?: string | null;
  titleStatus?: string | null;
  /** Facebook's own "About this vehicle" VIN field, distinct from a VIN typed into the description. */
  vin?: string | null;
  /** Renders a page with no listing data at all, to test the structural probe. */
  broken?: boolean;
}

const CDN = "https://scontent.xx.fbcdn.net";

export function itemUrl(id: string): string {
  return `https://www.facebook.com/marketplace/item/${id}/`;
}

/** `</script>` inside a JSON blob would terminate the tag early. */
function embedJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function listingPayload(spec: ListingSpec): Record<string, unknown> {
  const node: Record<string, unknown> = {
    id: spec.id,
    marketplace_listing_title: spec.title ?? null,
  };

  if (spec.priceAmount !== undefined && spec.priceAmount !== null) {
    node["listing_price"] = {
      amount: spec.priceAmount,
      currency: spec.currency ?? "USD",
      formatted_amount: spec.priceText ?? `$${spec.priceAmount}`,
    };
  }

  if (spec.mileage !== undefined && spec.mileage !== null) {
    node["vehicle_odometer_data"] = {
      value: spec.mileage,
      unit: spec.mileageUnit ?? "MILES",
    };
  }

  if (spec.mileageText) {
    node["custom_sub_titles_with_rendering_flags"] = [{ subtitle: spec.mileageText }];
  }

  if (spec.description !== undefined && spec.description !== null) {
    node["redacted_description"] = { text: spec.description };
  }

  if (spec.photoCount !== undefined && spec.photoCount !== null) {
    node["listing_photos"] = Array.from({ length: spec.photoCount }, (_, i) => ({
      id: `photo-${i}`,
      image: { uri: `${CDN}/photo-${i}.jpg` },
    }));
  }

  if (spec.location !== undefined && spec.location !== null) {
    const [city, state] = spec.location.split(",").map((part) => part.trim());
    node["location"] = {
      latitude: spec.latitude ?? null,
      longitude: spec.longitude ?? null,
      reverse_geocode: { city, state, display_name: spec.location },
    };
  }

  if (spec.createdAtSeconds !== undefined && spec.createdAtSeconds !== null) {
    node["creation_time"] = spec.createdAtSeconds;
  }

  if (spec.sellerId !== undefined && spec.sellerId !== null) {
    const seller: Record<string, unknown> = { id: spec.sellerId };
    if (spec.sellerListingCount !== undefined && spec.sellerListingCount !== null) {
      seller["marketplace_listing_count"] = spec.sellerListingCount;
    }
    node["marketplace_listing_seller"] = seller;
  }

  if (spec.trim) node["vehicle_trim"] = spec.trim;
  if (spec.titleStatus) node["vehicle_title_status"] = spec.titleStatus;
  if (spec.vin) node["vehicle_identification_number"] = spec.vin;

  return node;
}

function headerMarkup(spec: ListingSpec, mode: RenderMode): string {
  if (mode === "meta") return "";

  const parts: string[] = [];
  parts.push(`<div class="a"><h1>${escapeHtml(spec.title ?? "")}</h1></div>`);

  if (mode === "dom") {
    if (spec.priceText) {
      const price = spec.priceDropped
        ? `<s>$15,900</s> <span>${escapeHtml(spec.priceText)}</span>`
        : `<span>${escapeHtml(spec.priceText)}</span>`;
      parts.push(`<div class="b">${price}</div>`);
    }
    const postedLine = [spec.postedText, spec.location ? `in ${spec.location}` : null]
      .filter(Boolean)
      .join(" ");
    if (postedLine) parts.push(`<div class="c"><span>${escapeHtml(postedLine)}</span></div>`);
    if (spec.mileageText) {
      parts.push(`<div class="d"><span>Driven ${escapeHtml(spec.mileageText)}</span></div>`);
    }
    if (spec.photoCount) {
      parts.push(`<div aria-label="Photo 1 of ${spec.photoCount}"></div>`);
    }
    const images = spec.photoUrls ?? 0;
    for (let i = 0; i < images; i += 1) {
      parts.push(`<img src="${CDN}/img-${i}.jpg?stp=size" alt="" />`);
    }
  } else if (spec.priceText) {
    // Payload mode still renders a price, so the cascade has something to fall
    // through to and tests can prove it did not.
    parts.push(`<div class="b"><span>${escapeHtml(spec.priceText)}</span></div>`);
  }

  return `<div id="header">${parts.join("")}</div>`;
}

function bodyMarkup(spec: ListingSpec, mode: RenderMode): string {
  const blocks: string[] = [headerMarkup(spec, mode)];

  if (mode === "dom" && spec.description) {
    blocks.push(
      `<div class="desc"><h2>Description</h2><div><span>${escapeHtml(
        spec.description,
      )}</span></div></div>`,
    );
  }

  if (spec.sellerId) {
    // Mirrors the real structure: a `role="img"` star widget carrying the
    // precise average in its aria-label, with the true review count sitting
    // in a plain sibling span reading "(N)" a few levels up -- not inside the
    // widget's own aria-label, which on a real captured page read "From one
    // review'" regardless of the actual count.
    const ratingMarkup = spec.sellerRating
      ? `<div class="ratingWrap"><div role="img" aria-label="${spec.sellerRating.average} out of 5 stars, From one review'"></div><span>(${spec.sellerRating.count})</span></div>`
      : "";
    blocks.push(
      `<div><a href="/marketplace/profile/${spec.sellerId}/">Seller</a>${ratingMarkup}</div>`,
    );
  }

  const others = spec.sellerOtherListingIds ?? [];
  if (others.length > 0) {
    const links = others
      .map((id) => `<a href="/marketplace/item/${id}/"><span>Another car</span></a>`)
      .join("");
    blocks.push(`<div class="others"><h2>Seller's other listings</h2>${links}</div>`);
  }

  return `<div role="main">${blocks.join("")}</div>`;
}

export function buildListingHtml(spec: ListingSpec, mode: RenderMode = "payload"): string {
  const scripts =
    mode === "payload" && !spec.broken
      ? `<script type="application/json">${embedJson({
          require: [["ScheduledServerJS", "handle", null, [{ listing: listingPayload(spec) }]]],
        })}</script>`
      : "";

  const meta = [
    spec.title ? `<meta property="og:title" content="${escapeHtml(spec.title)}" />` : "",
    spec.description
      ? `<meta property="og:description" content="${escapeHtml(spec.description)}" />`
      : "",
    `<meta property="og:url" content="${itemUrl(spec.id)}" />`,
    `<link rel="canonical" href="${itemUrl(spec.id)}" />`,
  ].join("");

  const body = spec.broken ? '<div role="main"></div>' : bodyMarkup(spec, mode);

  return `<!doctype html><html><head>${meta}${scripts}</head><body>${body}</body></html>`;
}

export function buildListingDocument(spec: ListingSpec, mode: RenderMode = "payload"): Document {
  return new DOMParser().parseFromString(buildListingHtml(spec, mode), "text/html");
}

/* -------------------------------------------------------------------------- */
/* search results                                                              */
/* -------------------------------------------------------------------------- */

export interface CompCardSpec {
  id: string;
  title: string;
  priceAmount?: string | null;
  priceText?: string | null;
  mileageText?: string | null;
  location?: string | null;
  sellerId?: string | null;
}

export function buildSearchHtml(cards: CompCardSpec[], mode: RenderMode = "payload"): string {
  const scripts =
    mode === "payload"
      ? `<script type="application/json">${embedJson({
          marketplace_search: {
            feed_units: {
              edges: cards.map((card) => ({
                node: {
                  listing: {
                    id: card.id,
                    marketplace_listing_title: card.title,
                    ...(card.priceAmount
                      ? { listing_price: { amount: card.priceAmount, currency: "USD" } }
                      : {}),
                    ...(card.mileageText
                      ? {
                          custom_sub_titles_with_rendering_flags: [
                            { subtitle: card.mileageText },
                          ],
                        }
                      : {}),
                    ...(card.location
                      ? {
                          location: {
                            reverse_geocode: { display_name: card.location },
                          },
                        }
                      : {}),
                    ...(card.sellerId
                      ? { marketplace_listing_seller: { id: card.sellerId } }
                      : {}),
                  },
                },
              })),
            },
          },
        })}</script>`
      : "";

  const markup = cards
    .map((card) => {
      const text = [card.priceText, card.title, card.location, card.mileageText]
        .filter(Boolean)
        .map((part) => `<span>${escapeHtml(String(part))}</span>`)
        .join("");
      return `<a href="/marketplace/item/${card.id}/">${text}</a>`;
    })
    .join("");

  return `<!doctype html><html><head>${scripts}</head><body><div role="main">${markup}</div></body></html>`;
}

export function buildSearchDocument(
  cards: CompCardSpec[],
  mode: RenderMode = "payload",
): Document {
  return new DOMParser().parseFromString(buildSearchHtml(cards, mode), "text/html");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
