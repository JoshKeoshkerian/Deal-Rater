/**
 * Every Facebook payload key name the extractor depends on, in one file.
 *
 * These are the highest-value and most fragile constants in the project. They
 * change less often than class names — they are data model, not presentation —
 * but they do change, and when they do this is the only file that should need
 * editing.
 *
 * Verify against a live listing page before trusting a new key: open a
 * Marketplace item, run `document.querySelectorAll('script[type="application/json"]')`
 * in the console, and search the parsed payloads for the value you expect.
 */

export const FB_KEYS = {
  /** Marks the object that describes a listing. */
  listingTitle: ["marketplace_listing_title", "custom_title"],
  listingId: ["id", "listing_id"],

  price: ["listing_price", "price", "formatted_price"],
  priceAmount: ["amount"],
  /** Price in minor units (cents), already offset. */
  priceAmountOffset: ["amount_with_offset"],
  priceCurrency: ["currency", "currency_code"],
  priceText: ["formatted_amount", "text"],

  odometer: ["vehicle_odometer_data", "odometer"],
  odometerValue: ["value", "odometer_value"],
  odometerUnit: ["unit", "odometer_unit"],

  /** Card subtitles carry mileage on search results ("96K miles"). */
  subtitles: ["custom_sub_titles_with_rendering_flags", "custom_sub_titles"],
  subtitleText: ["subtitle", "text"],

  description: ["redacted_description", "listing_description", "description"],
  descriptionText: ["text"],

  photos: ["listing_photos", "all_listing_photos", "listing_photo_ids"],

  location: ["location", "listing_location"],
  latitude: ["latitude"],
  longitude: ["longitude"],
  reverseGeocode: ["reverse_geocode", "reverse_geocode_detailed"],
  city: ["city"],
  state: ["state", "state_page"],
  displayName: ["display_name"],

  createdAt: ["creation_time", "created_time", "listing_creation_time"],

  seller: ["marketplace_listing_seller", "seller", "story_actor"],
  sellerId: ["id"],
  /** A count of the seller's other active listings, where the payload has one. */
  sellerListingCount: [
    "marketplace_listing_count",
    "active_listings_count",
    "listing_count",
  ],

  vehicleTrim: ["vehicle_trim", "trim"],
  vehicleMake: ["vehicle_make", "make", "make_display_name"],
  vehicleModel: ["vehicle_model", "model", "model_display_name"],
  vehicleYear: ["vehicle_year", "year"],
  vehicleCondition: ["vehicle_title_status", "title_status", "vehicle_condition"],
} as const;

/** Search-result feed containers, used to scope comp card discovery. */
export const FB_SEARCH_KEYS = {
  feed: ["marketplace_search", "feed_units", "search_results"],
  edges: ["edges"],
  node: ["node"],
  listing: ["listing"],
} as const;
