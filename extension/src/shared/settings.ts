import type { ThemePreference } from "../content/overlay/theme";

export interface Settings {
  /** Where captures are posted. Defaults to production; override for local dev. */
  apiBaseUrl: string;
  /**
   * Panel appearance. "auto" follows the operating system and is the default;
   * the two explicit values override it in both directions.
   */
  theme: ThemePreference;
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

/**
 * Hosts this extension used to talk to, and no longer has permission for.
 *
 * `options.ts` WRITES `apiBaseUrl` to `chrome.storage.sync` whenever the
 * options page is saved, so changing the default below does not reach anyone
 * who has ever opened it -- their stored value wins, and after the manifest's
 * `host_permissions` moved to api.curbsidescore.com, that stored value is a
 * host the extension can no longer reach. The symptom is every capture failing
 * with a network error, on the machines of the users most engaged with the
 * product, for a reason nothing in the UI explains.
 *
 * `loadSettings` rewrites them on read instead. Keyed on the host alone so a
 * stored URL with a trailing slash or a path is still matched.
 */
const RETIRED_API_HOSTS = ["deal-rater-production.up.railway.app"];

export const DEFAULT_SETTINGS: Settings = {
  apiBaseUrl: "https://api.curbsidescore.com",
  theme: "auto",
  enabled: true,
  devMode: false,
  disclosureAcceptedAt: null,
  // Empty by default: peers are now chosen automatically from the listing's own
  // metro (see comps/metros.ts), which adapts to wherever the user is shopping
  // rather than assuming St. Louis. Anything set here OVERRIDES that choice.
  extraMetroIds: [],
};

/** True when `url`'s host is one this extension can no longer reach. */
function isRetiredApiUrl(url: string): boolean {
  try {
    return RETIRED_API_HOSTS.includes(new URL(url).host);
  } catch {
    // Not a parseable URL, so not a retired host either. `apiBaseUrl` is
    // free text on the options page and can be anything.
    return false;
  }
}

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const settings = { ...DEFAULT_SETTINGS, ...stored } as Settings;

  if (isRetiredApiUrl(settings.apiBaseUrl)) {
    settings.apiBaseUrl = DEFAULT_SETTINGS.apiBaseUrl;
    // Written back, not just corrected in memory, so the options page shows
    // the URL actually in use rather than the dead one it would otherwise
    // keep displaying and re-saving.
    void chrome.storage.sync.set({ apiBaseUrl: settings.apiBaseUrl }).catch(() => undefined);
  }

  return settings;
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  await chrome.storage.sync.set(patch);
}
