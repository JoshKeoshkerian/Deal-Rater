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
  /**
   * Facebook's own place id for the listing's location, e.g. "105517276147313".
   * Marketplace scopes a search by PATH SEGMENT -- /marketplace/<id>/search/ --
   * not by latitude/longitude query parameters. Confirmed against captured
   * listing pages, each of which carries exactly one of these matching its own
   * city.
   */
  locationVanityOrId: ["location_vanity_or_id"],
  /**
   * The account's Marketplace search radius, as rendered into the page.
   *
   * Confirmed as `"location":{"radius":65}` across captured pages, alongside
   * `"radius":65000` elsewhere -- 65 km and 65,000 m are the same 40 miles,
   * which matches the account setting those captures were taken under.
   *
   * This is NOT settable per request. Changing the radius in Marketplace's UI
   * leaves the search URL byte-for-byte identical, so Facebook holds it against
   * the account. Extracting it does not let the extension widen anything; it
   * makes the radius VISIBLE, so a comp set's geographic scope is recorded
   * rather than being an invisible global that silently differs between users
   * and between one week and the next.
   */
  searchRadius: ["radius"],
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

  // The `*_display_name` spellings are FIRST because they are the keys
  // Marketplace actually uses, and for a long time they were absent here
  // entirely. `pick` is an EXACT key lookup, so the old arrays
  // (["vehicle_trim", "trim"]) matched nothing on any real page: none of the 16
  // captured page fixtures contains a bare `vehicle_trim`, `vehicle_make` or
  // `vehicle_model` key. Tier 1 of every vehicle cascade was therefore dead
  // code, and year/make/model/trim came from `parseVehicleTitle` on every row
  // in the database while `field_strategies` still reported `json_payload`.
  //
  // The shorter spellings are kept as trailing fallbacks: they cost one failed
  // property read each and cover payload variants this project has not seen.
  vehicleTrim: ["vehicle_trim_display_name", "vehicle_trim", "trim"],
  vehicleMake: ["vehicle_make_display_name", "vehicle_make", "make"],
  vehicleModel: ["vehicle_model_display_name", "vehicle_model", "model"],
  vehicleYear: ["vehicle_year", "year"],

  /**
   * Marketplace's own PRIVATE_SELLER / DEALER classification.
   *
   * Spec 4.3 requires excluding dealer listings and names three signals for
   * detecting them, none of which a search card carries. This field is a fourth
   * that the spec did not anticipate: Facebook states it outright, on the
   * listing node, non-null on 13 of 16 captured fixtures. It is what lets
   * `DealerSignal` stop being a permanent `UNAVAILABLE` placeholder.
   */
  vehicleSellerType: ["vehicle_seller_type", "seller_type"],
  /**
   * "AUTOMATIC" / "MANUAL". `pricing/comps.py` records transmission as
   * "parseable on 0% of captured comps" because it was only ever recovered by
   * regex over trim text; it is a plain payload field.
   */
  vehicleTransmission: ["vehicle_transmission_type", "vehicle_transmission"],
  // "vehicle_condition" is deliberately not a fallback here: it is Facebook's
  // physical/wear condition rating (e.g. "GOOD", "FAIR"), a different field
  // from legal title branding. A 2016 Audi Q3 fixture had vehicle_title_status
  // explicitly null and no title_status key, and this array's old third entry
  // silently passed vehicle_condition's "GOOD" through as if it were the title
  // status — a false "clean-sounding" signal on a listing with none stated,
  // which matters more here than most fields since title status is a risk
  // signal the product is built around.
  vehicleCondition: ["vehicle_title_status", "title_status"],
  /**
   * "ONE" / "TWO" / "THREE_PLUS". Facebook's "About this vehicle" panel shows
   * this as one of its headline vehicle facts, alongside title status and
   * mileage -- a plain payload field, like `vehicleSellerType`.
   */
  vehicleNumberOfOwners: ["vehicle_number_of_owners"],
} as const;

/** Search-result feed containers, used to scope comp card discovery. */
export const FB_SEARCH_KEYS = {
  feed: ["marketplace_search", "feed_units", "search_results"],
  edges: ["edges"],
  node: ["node"],
  listing: ["listing"],
} as const;
