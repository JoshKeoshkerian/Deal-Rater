export interface Settings {
  /** Where captures are posted. No default production host is baked in. */
  apiBaseUrl: string;
  /** Master off switch. When false the trigger button is not mounted at all. */
  enabled: boolean;
  /** Adds the fixture-snapshot control used to build the regression corpus. */
  devMode: boolean;
  /** Set once the user has read the disclosure in spec 8.3. */
  disclosureAcceptedAt: string | null;
  /**
   * Extra Marketplace place ids to search alongside the listing's own metro.
   *
   * Facebook's search radius is fixed at 40 miles and is NOT settable per
   * request -- changing it in the UI leaves the search URL byte-for-byte
   * identical, and every capture records the same 65 km. The only way to reach
   * a wider market is to search neighbouring metros as SEPARATE searches, which
   * is what these are.
   *
   * Each entry costs one extra HTTP request per capture, so this is deliberately
   * opt-in and deliberately a short list rather than a radius slider.
   *
   * Get an id by opening Marketplace, switching the location to that city, and
   * reading the number out of the URL:
   *   facebook.com/marketplace/<THIS NUMBER>/search?...
   */
  extraMetroIds: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  apiBaseUrl: "http://localhost:8000",
  enabled: true,
  devMode: false,
  disclosureAcceptedAt: null,
  // Empty by default: peers are now chosen automatically from the listing's own
  // metro (see comps/metros.ts), which adapts to wherever the user is shopping
  // rather than assuming St. Louis. Anything set here OVERRIDES that choice.
  extraMetroIds: [],
};

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...stored } as Settings;
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  await chrome.storage.sync.set(patch);
}
